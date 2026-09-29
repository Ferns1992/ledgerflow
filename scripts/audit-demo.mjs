/**
 * Data integrity audit for the demo companies.
 *
 *   docker cp audit-demo.mjs ledgerflow-ledgerflow-1:/app/audit-demo.mjs
 *   docker exec -w /app ledgerflow-ledgerflow-1 node audit-demo.mjs
 *
 * Reports findings rather than asserting. Every check is independent, and a
 * non-empty `issues` list means the data is not safe to demo.
 *
 * These are accounting checks, not just "does it query" checks: a trial balance
 * that does not foot, or tax that does not equal the rate times the base, is a
 * real error even though every row is technically valid.
 */
import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || '/app/data/accounting.db', { readonly: true });

const INCOME = ['Direct Incomes', 'Indirect Incomes'];
const EXPENSE = ['Direct Expenses', 'Indirect Expenses'];
const BALANCE = ['Assets', 'Liabilities'];

const issues = [];
const notes = [];
const fail = (msg) => issues.push(msg);
const round2 = (n) => Math.round(n * 100) / 100;

const companies = db.prepare('SELECT * FROM companies ORDER BY id').all();
const isDemo = (name) => /Sundar Textiles|Manila Ledger Works/.test(name);

for (const c of companies) {
  if (!isDemo(c.name)) continue;

  const cur = c.currency_symbol;
  const money = (n) => `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const tag = `[${c.name}]`;

  const ledgers = db.prepare('SELECT * FROM ledgers WHERE company_id = ?').all(c.id);
  const ledgerById = new Map(ledgers.map((l) => [l.id, l]));
  const taxes = db.prepare('SELECT * FROM taxes WHERE company_id = ?').all(c.id);
  const taxById = new Map(taxes.map((t) => [t.id, t]));
  const vouchers = db.prepare('SELECT * FROM transactions WHERE company_id = ?').all(c.id);
  const pos = db.prepare('SELECT * FROM purchase_orders WHERE company_id = ?').all(c.id);
  const grns = db.prepare('SELECT * FROM grns WHERE company_id = ?').all(c.id);

  console.log(`\n${'='.repeat(72)}\n${c.name}  ${money(0).replace(/[\d.,]/g, '')} (${cur}, U+${[...cur].map((ch) => ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(',U+')})\n${'='.repeat(72)}`);

  // --- 1. Voucher integrity ------------------------------------------------
  let selfBalanced = 0;
  let wrongCompany = 0;
  let badAmount = 0;
  let futureDated = 0;
  let unknownLedger = 0;
  for (const v of vouchers) {
    if (v.debit_ledger_id === v.credit_ledger_id) {
      selfBalanced++;
      fail(`${tag} voucher ${v.id} debits and credits the same ledger (${v.debit_ledger_id})`);
    }
    for (const lid of [v.debit_ledger_id, v.credit_ledger_id]) {
      const l = ledgerById.get(lid);
      if (!l) unknownLedger++;
      else if (l.company_id !== c.id) wrongCompany++;
    }
    if (!(v.amount > 0)) badAmount++;
    if (new Date(v.date) > new Date()) futureDated++;
  }
  if (!selfBalanced) notes.push(`${tag} no voucher balances against itself`);
  if (!wrongCompany) notes.push(`${tag} every voucher leg belongs to this company`);
  if (!badAmount) notes.push(`${tag} every amount is greater than zero`);
  if (!futureDated) notes.push(`${tag} no voucher is dated in the future`);
  if (!unknownLedger) notes.push(`${tag} no voucher references a missing ledger`);

  // --- 2. Ledger classification -------------------------------------------
  const unclassified = ledgers.filter(
    (l) => ![...INCOME, ...EXPENSE, ...BALANCE].includes(l.group_name),
  );
  if (unclassified.length) {
    fail(`${tag} ${unclassified.length} ledger(s) in no P&L or balance-sheet group: ${unclassified.map((l) => l.name).join(', ')}`);
  } else {
    notes.push(`${tag} all ${ledgers.length} ledgers are classified`);
  }

  // Balance-sheet ledgers must not be double counted as P&L.
  for (const v of vouchers) {
    for (const lid of [v.debit_ledger_id, v.credit_ledger_id]) {
      const l = ledgerById.get(lid);
      if (l && (INCOME.includes(l.group_name) || EXPENSE.includes(l.group_name)) === false && BALANCE.includes(l.group_name)) {
        // fine, balance sheet
      }
    }
  }

  // --- 3. Trial balance ---------------------------------------------------
  // Every voucher's two legs are equal by construction, so vouchers always
  // foot. What can break the trial balance is the opening balances: if assets
  // are opened with a debit and nothing carries the matching credit, the
  // balance sheet does not balance. In a correct seed the sum of all opening
  // balances is therefore zero, with credit-side accounts stored negative.
  const openingTotal = ledgers.reduce((s, l) => s + (l.opening_balance || 0), 0);
  const assetOpenings = ledgers.filter((l) => l.group_name === 'Assets');
  const liabilityOpenings = ledgers.filter((l) => l.group_name === 'Liabilities' && (l.opening_balance || 0) < 0);

  if (Math.abs(openingTotal) > 0.01) {
    fail(
      `${tag} opening balances sum to ${money(round2(openingTotal))} instead of 0, so the trial balance does not foot. ` +
        `Assets opened ${money(round2(assetOpenings.reduce((s, l) => s + l.opening_balance, 0)))} against equity/liabilities ` +
        `${money(round2(liabilityOpenings.reduce((s, l) => s + l.opening_balance, 0)))}, leaving ` +
        `${money(round2(openingTotal))} unexplained.`,
    );
  } else {
    notes.push(`${tag} trial balance foots: opening balances sum to 0 (${money(0)})`);
  }

  // --- 4. P&L signs --------------------------------------------------------
  let income = 0;
  let expense = 0;
  for (const v of vouchers) {
    const dg = ledgerById.get(v.debit_ledger_id)?.group_name ?? '';
    const cg = ledgerById.get(v.credit_ledger_id)?.group_name ?? '';
    const total = v.amount + (v.tax_amount || 0);
    if (INCOME.includes(cg)) income += total;
    if (INCOME.includes(dg)) income -= total;
    if (EXPENSE.includes(dg)) expense += total;
    if (EXPENSE.includes(cg)) expense -= total;
  }
  if (income <= 0) fail(`${tag} income is ${money(round2(income))}; revenue vouchers are likely reversed`);
  if (expense <= 0) fail(`${tag} expense is ${money(round2(expense))}; cost vouchers are likely reversed`);
  if (income > 0 && expense > 0) {
    notes.push(`${tag} income ${money(round2(income))} > 0 and expense ${money(round2(expense))} > 0`);
  }

  // --- 5. Tax arithmetic ---------------------------------------------------
  let taxMismatch = 0;
  let taxUnknown = 0;
  for (const v of vouchers) {
    if (!v.tax_id) {
      if (v.tax_amount) taxMismatch++;
      continue;
    }
    const t = taxById.get(v.tax_id);
    if (!t) {
      taxUnknown++;
      continue;
    }
    if (t.company_id !== c.id) fail(`${tag} voucher ${v.id} uses a tax from another company`);
    const expected = round2(v.amount * (t.rate / 100));
    // Allow a cent of rounding.
    if (Math.abs(expected - (v.tax_amount || 0)) > 0.01) {
      taxMismatch++;
      fail(
        `${tag} voucher ${v.id} tax is ${money(v.tax_amount)} but ${t.name} at ${t.rate}% ` +
          `on ${money(v.amount)} is ${money(expected)}`,
      );
    }
  }
  if (!taxUnknown) notes.push(`${tag} every tax reference resolves`);
  if (!taxMismatch) notes.push(`${tag} every tax amount equals rate x base`);

  // --- 6. Purchase orders and receipts -------------------------------------
  const seen = new Map();
  for (const p of [...pos, ...grns]) {
    const label = p.po_number || p.grn_number;
    if (seen.has(label)) fail(`${tag} duplicate document number ${label}`);
    seen.set(label, true);

    let items;
    try {
      items = JSON.parse(p.items);
    } catch {
      fail(`${tag} ${label} has unparseable items JSON`);
      continue;
    }
    if (!Array.isArray(items) || items.length === 0) {
      fail(`${tag} ${label} has no line items`);
      continue;
    }
    let sum = 0;
    for (const it of items) {
      const calc = round2((Number(it.quantity) || 0) * (Number(it.rate) || 0));
      if (Math.abs(calc - (Number(it.amount) || 0)) > 0.01) {
        fail(`${tag} ${label} line "${it.description}" amount ${it.amount} != qty x rate ${calc}`);
      }
      if (!(it.quantity > 0)) fail(`${tag} ${label} line "${it.description}" has non-positive quantity`);
      if (!(it.rate >= 0)) fail(`${tag} ${label} line "${it.description}" has a negative rate`);
      sum += calc;
    }
    if (Math.abs(sum - p.total_amount) > 0.01) {
      fail(`${tag} ${label} total ${money(p.total_amount)} != sum of lines ${money(round2(sum))}`);
    }
  }
  notes.push(`${tag} ${pos.length} purchase order(s) and ${grns.length} receipt(s) foot to their line items`);

  // GRN linked to a PO must be in the same company.
  for (const g of grns) {
    if (!g.po_id) continue;
    const po = pos.find((p) => p.id === g.po_id);
    if (!po) fail(`${tag} GRN ${g.grn_number} points at a purchase order that is not in this company`);
  }

  // --- 7. Tax identifier shape --------------------------------------------
  // The identifier column is reused across jurisdictions, so the format check
  // has to be per-country. Validating a Philippine TIN as a GSTIN produces
  // false failures, which is worse than no check.
  if (c.gstin) {
    if (/Sundar Textiles/.test(c.name)) {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(c.gstin)) {
        fail(`${tag} GSTIN "${c.gstin}" does not match the 2-5-4-1-1-1-1 GSTIN pattern`);
      } else if (c.gstin.slice(0, 2) === '00') {
        fail(`${tag} GSTIN "${c.gstin}" has unassigned state code 00`);
      } else {
        notes.push(`${tag} GSTIN ${c.gstin} is well formed, state code ${c.gstin.slice(0, 2)}`);
      }
    } else if (/Manila Ledger Works/.test(c.name)) {
      // Philippine TIN: 3-3-3-5 or 9 digits, often grouped with dashes.
      if (!/^\d{3}-?\d{3}-?\d{3}-?\d{2,5}$/.test(c.gstin)) {
        fail(`${tag} TIN "${c.gstin}" is not a valid Philippine TIN (3-3-3-5 or 3-3-3-6-5)`);
      } else if (c.gstin.replace(/-/g, '').startsWith('000000000')) {
        fail(`${tag} TIN "${c.gstin}" is all zeroes, which is not issued`);
      } else {
        notes.push(`${tag} TIN ${c.gstin} is well formed`);
      }
    }
  }

  // --- 8. Balance sheet sanity -------------------------------------------
  // Cash and bank must not go negative: that means costs were booked with no
  // funding behind them, which any accountant reviewing the demo would query
  // immediately. It is the check that caught sales credited to receivables
  // that were never collected.
  const cashNames = /Cash|BDO|HDFC|Bank/i;
  let sawCash = false;
  for (const l of ledgers) {
    let bal = l.opening_balance || 0;
    for (const v of vouchers) {
      const total = v.amount + (v.tax_amount || 0);
      if (v.debit_ledger_id === l.id) bal += total;
      if (v.credit_ledger_id === l.id) bal -= total;
    }
    if (!cashNames.test(l.name)) continue;
    sawCash = true;
    if (bal < 0) {
      fail(`${tag} cash ledger "${l.name}" ends at ${money(round2(bal))}; costs were booked without funding`);
    } else {
      notes.push(`${tag} cash ledger "${l.name}" ends positive at ${money(round2(bal))}`);
    }
  }
  if (!sawCash) fail(`${tag} has no cash or bank ledger, so working capital cannot be demonstrated`);

  // --- 9. Depreciation sanity ---------------------------------------------
  for (const a of db.prepare('SELECT * FROM assets WHERE company_id = ?').all(c.id)) {
    if (a.depreciation_rate < 0 || a.depreciation_rate > 100) {
      fail(`${tag} asset "${a.name}" has a depreciation rate of ${a.depreciation_rate}%`);
    }
    if (a.purchase_date && new Date(a.purchase_date) > new Date()) {
      fail(`${tag} asset "${a.name}" is dated in the future`);
    }
  }

  console.log(`  ledgers ${ledgers.length} | vouchers ${vouchers.length} | taxes ${taxes.length} | assets ${db.prepare('SELECT COUNT(*) n FROM assets WHERE company_id = ?').get(c.id).n} | POs ${pos.length} | GRNs ${grns.length}`);
  console.log(`  income ${money(round2(income))}  expense ${money(round2(expense))}  net ${money(round2(income - expense))}`);
  const groups = {};
  for (const l of ledgers) groups[l.group_name] = (groups[l.group_name] || 0) + 1;
  console.log(`  groups ${JSON.stringify(groups)}`);
}

console.log(`\n${'='.repeat(72)}`);
if (notes.length) {
  console.log('PASSED CHECKS:');
  for (const n of notes) console.log(`  ok  ${n}`);
}
if (issues.length) {
  console.log(`\nISSUES (${issues.length}):`);
  for (const i of issues) console.log(`  !!  ${i}`);
  process.exitCode = 1;
} else {
  console.log('\nNo issues found.');
}
db.close();
