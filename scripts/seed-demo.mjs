/**
 * Demo data: one Indian company and one Philippine company.
 *
 *   docker exec ledgerflow-ledgerflow-1 node scripts/seed-demo.mjs
 *
 * Idempotent. If either company already exists by name, that company is
 * skipped and the existing rows are left alone, so re-running never
 * duplicates data. Use --reset to remove those companies first (this
 * cascades to their ledgers, vouchers, assets, taxes, orders and receipts).
 *
 * Everything is written in one transaction per company: if a single insert
 * fails the whole company is rolled back rather than leaving a half-built
 * ledger behind.
 */
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || '/app/data/accounting.db';
const RESET = process.argv.includes('--reset');

const IN = {
  name: 'Sundar Textiles Private Limited',
  gstin: '27AABCU9603R1ZM',
  address: 'Plot 14, MIDC Industrial Area, Pune, Maharashtra 411019',
  currency_symbol: '₹',
};

const PH = {
  name: 'Manila Ledger Works Inc.',
  gstin: '000-123-456-00000',
  address: '123 Makati Avenue, Makati City, Metro Manila 1200',
  // U+20B1 PESO SIGN. Not U+20BF, which is the Bitcoin sign and was an easy
  // slip to make since the two glyphs are nearly identical.
  currency_symbol: '₱',
};

// --- Ledger groups ---------------------------------------------------------
//
// The P&L derives income and expense from the income and expense group names,
// so a typo here would silently move a ledger out of the profit and loss
// statement. Balance-sheet accounts get their own groups: cash, bank and
// receivables are assets, payables are liabilities, and none of them belong in
// a P&L total. A voucher like "Bank Dr / Receivables Cr" is a collection, and
// must leave profit untouched.
const INCOME = 'Direct Incomes';
const DIRECT_EXP = 'Direct Expenses';
const INDIRECT_EXP = 'Indirect Expenses';
const ASSETS = 'Assets';
const LIABILITIES = 'Liabilities';

function monthsBack(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const LEDGERS = {
  IN: [
    { name: 'Cash in Hand', group_name: ASSETS, opening_balance: 85000 },
    { name: 'HDFC Current Account', group_name: ASSETS, opening_balance: 1250000 },
    { name: 'Trade Receivables', group_name: ASSETS, opening_balance: 640000 },
    { name: 'Textile Sales', group_name: INCOME, opening_balance: 0 },
    { name: 'Job Work Income', group_name: INCOME, opening_balance: 0 },
    { name: 'Fabric Purchases', group_name: DIRECT_EXP, opening_balance: 0 },
    { name: 'Factory Rent', group_name: INDIRECT_EXP, opening_balance: 0 },
    { name: 'Employee Salaries', group_name: INDIRECT_EXP, opening_balance: 0 },
    { name: 'Power and Water', group_name: INDIRECT_EXP, opening_balance: 0 },
    { name: 'Freight and Logistics', group_name: DIRECT_EXP, opening_balance: 0 },
    { name: 'Trade Payables', group_name: LIABILITIES, opening_balance: 0 },
  ],
  PH: [
    { name: 'Cash on Hand', group_name: ASSETS, opening_balance: 185000 },
    { name: 'BDO Checking Account', group_name: ASSETS, opening_balance: 940000 },
    { name: 'Accounts Receivable', group_name: ASSETS, opening_balance: 312000 },
    { name: 'Service Revenue', group_name: INCOME, opening_balance: 0 },
    { name: 'Retail Sales', group_name: INCOME, opening_balance: 0 },
    { name: 'Supplies and Materials', group_name: DIRECT_EXP, opening_balance: 0 },
    { name: 'Office Rent', group_name: INDIRECT_EXP, opening_balance: 0 },
    { name: 'Staff Salaries', group_name: INDIRECT_EXP, opening_balance: 0 },
    { name: 'Utilities', group_name: INDIRECT_EXP, opening_balance: 0 },
    { name: 'Professional Fees', group_name: INDIRECT_EXP, opening_balance: 0 },
  ],
};

const TAXES = {
  // India: GST is split across slabs, and anything above ₹1 crore needs a
  // reverse charge on purchases, which is why there is an RCG line here.
  IN: [
    { name: 'CGST 9%', rate: 9 },
    { name: 'SGST 9%', rate: 9 },
    { name: 'IGST 18%', rate: 18 },
    { name: 'IGST 5%', rate: 5 },
  ],
  // Philippines: 12% is the standard VAT. 6% applies to tourism and some
  // services, 2% is the special rate, and 1% is the withholding on
  // compensation paid to individual contractors.
  PH: [
    { name: 'VAT 12%', rate: 12 },
    { name: 'VAT 6%', rate: 6 },
    { name: 'VAT 2%', rate: 2 },
    { name: 'Exempt', rate: 0 },
  ],
};

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// The schema is created by the server on first boot, not by this script, so a
// fresh database has no tables. Say that plainly instead of failing on
// "no such table: companies" four lines later.
const hasSchema = db
  .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'companies'")
  .get().n;
if (!hasSchema) {
  console.error(`[seed] ${DB_PATH} has no schema yet. Start the app once to create it, then re-run.`);
  process.exit(1);
}

const companyExists = db.prepare('SELECT id FROM companies WHERE name = ?');

function log(msg) {
  console.log(`[seed] ${msg}`);
}

function existing(name) {
  return companyExists.get(name);
}

function build(company, kind) {
  const inserted = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO companies (name, address, gstin, currency_symbol) VALUES (?, ?, ?, ?)')
      .run(company.name, company.address, company.gstin, company.currency_symbol);
    const cid = Number(res.lastInsertRowid);

    const ledgerId = new Map();
    const insLedger = db.prepare(
      'INSERT INTO ledgers (company_id, name, group_name, opening_balance) VALUES (?, ?, ?, ?)',
    );
    for (const l of LEDGERS[kind]) {
      const r = insLedger.run(cid, l.name, l.group_name, l.opening_balance);
      ledgerId.set(l.name, Number(r.lastInsertRowid));
    }

    const taxId = new Map();
    const insTax = db.prepare('INSERT INTO taxes (company_id, name, rate) VALUES (?, ?, ?)');
    for (const t of TAXES[kind]) {
      const r = insTax.run(cid, t.name, t.rate);
      taxId.set(t.name, Number(r.lastInsertRowid));
    }

    return { cid, ledgerId, taxId };
  })();

  return inserted;
}

function addVouchers(cid, L, T, rows) {
  const ins = db.prepare(
    `INSERT INTO transactions
       (company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    for (const v of rows) {
      // The server rejects a voucher whose two ledgers match, so assert it
      // here rather than letting the whole seed fail on one bad row.
      if (v.dr === v.cr) throw new Error(`demo voucher balances against itself: ${v.narration}`);
      ins.run(cid, v.date, L.get(v.dr), L.get(v.cr), v.amount, v.tax ? T.get(v.tax) : null, v.taxAmount ?? 0, v.narration);
    }
  });
  run();
}

function addAssets(cid, rows) {
  const ins = db.prepare(
    'INSERT INTO assets (company_id, name, value, purchase_date, depreciation_rate) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const a of rows) ins.run(cid, a.name, a.value, a.purchase_date, a.rate);
  })();
}

function items(rows) {
  return JSON.stringify(rows.map(([description, quantity, rate]) => ({
    description,
    quantity,
    rate,
    amount: Math.round(quantity * rate * 100) / 100,
  })));
}

function addPOs(cid, rows) {
  const ins = db.prepare(
    `INSERT INTO purchase_orders (company_id, type, po_number, date, supplier, total_amount, status, items)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    for (const p of rows) {
      ins.run(cid, p.type, p.number, p.date, p.supplier, p.total, p.status, items(p.items));
    }
  });
  run();
  return db.prepare('SELECT id, po_number FROM purchase_orders WHERE company_id = ? ORDER BY id').all(cid);
}

function addGRNs(cid, rows, poIds) {
  const ins = db.prepare(
    `INSERT INTO grns (company_id, grn_number, date, po_id, supplier, total_amount, status, items)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    for (const g of rows) {
      ins.run(cid, g.number, g.date, poIds ?? null, g.supplier, g.total, g.status, items(g.items));
    }
  });
  run();
}

// ---------------------------------------------------------------------------

function seedIndia() {
  if (RESET) {
    const found = existing(IN.name);
    if (found) {
      const wipe = db.transaction(() => {
        for (const t of ['transactions', 'ledgers', 'assets', 'grns', 'purchase_orders', 'taxes']) {
          db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(found.id);
        }
        db.prepare('DELETE FROM companies WHERE id = ?').run(found.id);
      });
      wipe();
      log(`reset ${IN.name}`);
    }
  } else if (existing(IN.name)) {
    log(`${IN.name} already exists, skipping`);
    return;
  }

  const { cid, ledgerId: L, taxId: T } = build(IN, 'IN');
  log(`created ${IN.name} (id ${cid})`);

  addVouchers(cid, L, T, [
    // Opening receivables collected
    { date: monthsBack(5), dr: 'HDFC Current Account', cr: 'Trade Receivables', amount: 412000, narration: 'Collections against FY opening receivables' },
    { date: monthsBack(5), dr: 'Trade Receivables', cr: 'Textile Sales', amount: 685000, narration: 'B2B fabric supply, Surat order' },
    { date: monthsBack(5), dr: 'Fabric Purchases', cr: 'HDFC Current Account', amount: 298000, narration: 'Raw cotton purchase, Gujarat' },
    { date: monthsBack(5), dr: 'Freight and Logistics', cr: 'HDFC Current Account', amount: 18400, narration: 'Inbound freight' },
    { date: monthsBack(5), dr: 'Factory Rent', cr: 'HDFC Current Account', amount: 85000, narration: 'Factory shed rent' },
    { date: monthsBack(5), dr: 'Employee Salaries', cr: 'HDFC Current Account', amount: 214000, narration: 'Shop floor payroll' },
    { date: monthsBack(5), dr: 'Power and Water', cr: 'HDFC Current Account', amount: 42800, narration: 'MSEDCL electricity' },

    { date: monthsBack(4), dr: 'Trade Receivables', cr: 'Textile Sales', amount: 742000, narration: 'Export order, Dubai' },
    { date: monthsBack(4), dr: 'Trade Receivables', cr: 'Job Work Income', amount: 186000, narration: 'Job work for Malpani Textiles' },
    { date: monthsBack(4), dr: 'Fabric Purchases', cr: 'HDFC Current Account', amount: 344000, narration: 'Processed fabric, Ichalkaranji' },
    { date: monthsBack(4), dr: 'Freight and Logistics', cr: 'HDFC Current Account', amount: 21200, narration: 'Outbound to JNPT port' },
    { date: monthsBack(4), dr: 'Employee Salaries', cr: 'HDFC Current Account', amount: 221000, narration: 'Shop floor payroll' },
    { date: monthsBack(4), dr: 'Power and Water', cr: 'HDFC Current Account', amount: 46100, narration: 'MSEDCL electricity' },

    { date: monthsBack(3), dr: 'Trade Receivables', cr: 'Textile Sales', amount: 826000, narration: 'Domestic wholesale, multiple lots', tax: 'CGST 9%', taxAmount: 37170 },
    { date: monthsBack(3), dr: 'Trade Receivables', cr: 'Job Work Income', amount: 242000, narration: 'Job work, Kutch cluster' },
    { date: monthsBack(3), dr: 'Fabric Purchases', cr: 'HDFC Current Account', amount: 389000, narration: 'Yarn purchase, Ahmedabad' },
    { date: monthsBack(3), dr: 'Factory Rent', cr: 'HDFC Current Account', amount: 85000, narration: 'Factory shed rent' },
    { date: monthsBack(3), dr: 'Employee Salaries', cr: 'HDFC Current Account', amount: 228000, narration: 'Shop floor payroll' },
    { date: monthsBack(3), dr: 'Power and Water', cr: 'HDFC Current Account', amount: 48900, narration: 'MSEDCL electricity' },

    { date: monthsBack(2), dr: 'Trade Receivables', cr: 'Textile Sales', amount: 903000, narration: 'Bulk order, Chennai', tax: 'IGST 18%', taxAmount: 68818.5 },
    { date: monthsBack(2), dr: 'Trade Receivables', cr: 'Job Work Income', amount: 198000, narration: 'Job work, Ludhiana' },
    { date: monthsBack(2), dr: 'Fabric Purchases', cr: 'HDFC Current Account', amount: 412000, narration: 'Grey fabric purchase' },
    { date: monthsBack(2), dr: 'Freight and Logistics', cr: 'HDFC Current Account', amount: 24900, narration: 'Outbound logistics' },
    { date: monthsBack(2), dr: 'Employee Salaries', cr: 'HDFC Current Account', amount: 235000, narration: 'Shop floor payroll' },

    { date: monthsBack(1), dr: 'Trade Receivables', cr: 'Textile Sales', amount: 968000, narration: 'Domestic wholesale, quarterly lot', tax: 'IGST 18%', taxAmount: 73852.8 },
    { date: monthsBack(1), dr: 'Trade Receivables', cr: 'Job Work Income', amount: 214000, narration: 'Job work, Tiruppur' },
    { date: monthsBack(1), dr: 'Fabric Purchases', cr: 'HDFC Current Account', amount: 438000, narration: 'Finished fabric, Coimbatore' },
    { date: monthsBack(1), dr: 'Factory Rent', cr: 'HDFC Current Account', amount: 85000, narration: 'Factory shed rent' },
    { date: monthsBack(1), dr: 'Employee Salaries', cr: 'HDFC Current Account', amount: 241000, narration: 'Shop floor payroll' },
    { date: monthsBack(1), dr: 'Power and Water', cr: 'HDFC Current Account', amount: 51400, narration: 'MSEDCL electricity' },

    // Receivable collection clears the asset side
    { date: daysAgo(12), dr: 'HDFC Current Account', cr: 'Trade Receivables', amount: 520000, narration: 'Realised receivables, bank transfer' },
    // Supplier credit
    { date: daysAgo(6), dr: 'Trade Payables', cr: 'Trade Receivables', amount: 120000, narration: 'Set off against supplier credit note' },
  ]);

  addAssets(cid, [
    { name: 'Power loom line (24 spindles)', value: 1850000, purchase_date: '2021-06-14', rate: 10 },
    { name: 'Delivery fleet, 3 trucks', value: 2400000, purchase_date: '2022-11-02', rate: 12.5 },
    { name: 'Steam boiler', value: 940000, purchase_date: '2020-02-20', rate: 8 },
    { name: 'Office and admin block', value: 3100000, purchase_date: '2018-09-30', rate: 4 },
  ]);

  const pos = addPOs(cid, [
    { type: 'IPO', number: 'IPO-2026-0001', date: daysAgo(48), supplier: 'Surat Cotton Mills', total: 528000, status: 'Received', items: [['Ring spun yarn 30s', 2400, 145], ['Open end yarn 20s', 1200, 170]] },
    { type: 'LPO', number: 'LPO-2026-0002', date: daysAgo(30), supplier: 'Ichalkaranji Fabrics Pvt Ltd', total: 312000, status: 'Ordered', items: [['Processed cotton fabric', 800, 390]] },
    { type: 'IPO', number: 'IPO-2026-0003', date: daysAgo(16), supplier: 'Ludhiana Woollen Traders', total: 246000, status: 'Pending', items: [['Wool blend fabric', 400, 460], ['Lining material', 600, 90]] },
    { type: 'LPO', number: 'LPO-2026-0004', date: daysAgo(5), supplier: 'Pune Chemical Supplies', total: 96500, status: 'Approved', items: [['Dyeing chemicals', 1, 42000], ['Sizing agents', 1, 54500]] },
  ]);

  addGRNs(cid, [
    { number: 'GRN-2026-0001', date: daysAgo(44), supplier: 'Surat Cotton Mills', total: 528000, status: 'Received', items: [['Ring spun yarn 30s', 2400, 145], ['Open end yarn 20s', 1200, 170]] },
  ], pos[0]?.id);

  log(`${IN.name}: 11 ledgers, 4 taxes, 24 vouchers, 4 assets, 4 POs, 1 GRN`);
}

function seedPhilippines() {
  if (RESET) {
    const found = existing(PH.name);
    if (found) {
      const wipe = db.transaction(() => {
        for (const t of ['transactions', 'ledgers', 'assets', 'grns', 'purchase_orders', 'taxes']) {
          db.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(found.id);
        }
        db.prepare('DELETE FROM companies WHERE id = ?').run(found.id);
      });
      wipe();
      log(`reset ${PH.name}`);
    }
  } else if (existing(PH.name)) {
    log(`${PH.name} already exists, skipping`);
    return;
  }

  const { cid, ledgerId: L, taxId: T } = build(PH, 'PH');
  log(`created ${PH.name} (id ${cid})`);

  addVouchers(cid, L, T, [
    { date: monthsBack(5), dr: 'BDO Checking Account', cr: 'Accounts Receivable', amount: 268000, narration: 'Collection of opening receivables' },
    { date: monthsBack(5), dr: 'Accounts Receivable', cr: 'Service Revenue', amount: 342000, narration: 'Bookkeeping retainer, 12 clients', tax: 'VAT 12%', taxAmount: 41040 },
    { date: monthsBack(5), dr: 'Cash on Hand', cr: 'Retail Sales', amount: 128400, narration: 'Walk-in supply sales' },
    { date: monthsBack(5), dr: 'Supplies and Materials', cr: 'BDO Checking Account', amount: 96500, narration: 'Paper and printing supplies' },
    { date: monthsBack(5), dr: 'Office Rent', cr: 'BDO Checking Account', amount: 78000, narration: 'Unit 8B lease, monthly' },
    { date: monthsBack(5), dr: 'Staff Salaries', cr: 'BDO Checking Account', amount: 186000, narration: 'Payroll for 6 staff' },
    { date: monthsBack(5), dr: 'Utilities', cr: 'BDO Checking Account', amount: 24300, narration: 'Meralco and water' },

    { date: monthsBack(4), dr: 'Accounts Receivable', cr: 'Service Revenue', amount: 388000, narration: 'Payroll processing engagement', tax: 'VAT 12%', taxAmount: 46560 },
    { date: monthsBack(4), dr: 'Cash on Hand', cr: 'Retail Sales', amount: 142600, narration: 'Walk-in supply sales' },
    { date: monthsBack(4), dr: 'Professional Fees', cr: 'BDO Checking Account', amount: 45000, narration: 'CPAs, quarterly engagement' },
    { date: monthsBack(4), dr: 'Supplies and Materials', cr: 'BDO Checking Account', amount: 88200, narration: 'Consumables restock' },
    { date: monthsBack(4), dr: 'Staff Salaries', cr: 'BDO Checking Account', amount: 192000, narration: 'Payroll for 6 staff' },
    { date: monthsBack(4), dr: 'Utilities', cr: 'BDO Checking Account', amount: 25900, narration: 'Meralco and water' },

    { date: monthsBack(3), dr: 'Accounts Receivable', cr: 'Service Revenue', amount: 412000, narration: 'BIR compliance filings, 18 clients', tax: 'VAT 12%', taxAmount: 49440 },
    { date: monthsBack(3), dr: 'Cash on Hand', cr: 'Retail Sales', amount: 151200, narration: 'Walk-in supply sales' },
    { date: monthsBack(3), dr: 'Supplies and Materials', cr: 'BDO Checking Account', amount: 101400, narration: 'Consumables restock' },
    { date: monthsBack(3), dr: 'Office Rent', cr: 'BDO Checking Account', amount: 78000, narration: 'Unit 8B lease, monthly' },
    { date: monthsBack(3), dr: 'Staff Salaries', cr: 'BDO Checking Account', amount: 196000, narration: 'Payroll for 6 staff' },
    { date: monthsBack(3), dr: 'Utilities', cr: 'BDO Checking Account', amount: 27100, narration: 'Meralco and water' },

    { date: monthsBack(2), dr: 'Accounts Receivable', cr: 'Service Revenue', amount: 468000, narration: 'Audit prep and advisory', tax: 'VAT 12%', taxAmount: 56160 },
    { date: monthsBack(2), dr: 'Cash on Hand', cr: 'Retail Sales', amount: 163800, narration: 'Walk-in supply sales' },
    { date: monthsBack(2), dr: 'Professional Fees', cr: 'BDO Checking Account', amount: 45000, narration: 'CPAs, quarterly engagement' },
    { date: monthsBack(2), dr: 'Supplies and Materials', cr: 'BDO Checking Account', amount: 94200, narration: 'Consumables restock' },
    { date: monthsBack(2), dr: 'Staff Salaries', cr: 'BDO Checking Account', amount: 199500, narration: 'Payroll for 6 staff, 13th month' },
    { date: monthsBack(2), dr: 'Utilities', cr: 'BDO Checking Account', amount: 28400, narration: 'Meralco and water' },

    { date: monthsBack(1), dr: 'Accounts Receivable', cr: 'Service Revenue', amount: 502000, narration: 'Year-end audit assistance', tax: 'VAT 12%', taxAmount: 60240 },
    { date: monthsBack(1), dr: 'Cash on Hand', cr: 'Retail Sales', amount: 171400, narration: 'Walk-in supply sales' },
    { date: monthsBack(1), dr: 'Supplies and Materials', cr: 'BDO Checking Account', amount: 108600, narration: 'Consumables restock' },
    { date: monthsBack(1), dr: 'Office Rent', cr: 'BDO Checking Account', amount: 78000, narration: 'Unit 8B lease, monthly' },
    { date: monthsBack(1), dr: 'Staff Salaries', cr: 'BDO Checking Account', amount: 203000, narration: 'Payroll for 6 staff' },
    { date: monthsBack(1), dr: 'Utilities', cr: 'BDO Checking Account', amount: 29600, narration: 'Meralco and water' },

    { date: daysAgo(14), dr: 'BDO Checking Account', cr: 'Accounts Receivable', amount: 348000, narration: 'BIR e-invoicing receipts remitted' },
  ]);

  addAssets(cid, [
    { name: 'Laptops and workstations (6)', value: 486000, purchase_date: '2023-03-14', rate: 20 },
    { name: 'Air conditioning units', value: 214000, purchase_date: '2022-08-08', rate: 10 },
    { name: 'Office furniture and fit-out', value: 372000, purchase_date: '2021-05-20', rate: 5 },
    { name: 'Backup server and NAS', value: 148000, purchase_date: '2024-01-30', rate: 15 },
    { name: 'Company vehicle', value: 890000, purchase_date: '2022-12-02', rate: 12 },
  ]);

  const pos = addPOs(cid, [
    { type: 'LPO', number: 'LPO-2026-0001', date: daysAgo(40), supplier: 'Metro Manila Stationery Supply', total: 86400, status: 'Received', items: [['Bond paper, 80gsm', 240, 180], ['Ballpoint pens, boxed', 120, 120], ['Archival folders', 200, 96]] },
    { type: 'IPO', number: 'IPO-2026-0002', date: daysAgo(24), supplier: 'Laguna Tech Trading', total: 148500, status: 'Ordered', items: [['Desktop workstations', 6, 24750]] },
    { type: 'LPO', number: 'LPO-2026-0003', date: daysAgo(11), supplier: 'Cebu Print Solutions', total: 63200, status: 'Pending', items: [['Tarpaulin and signage', 4, 9800], ['Digital printing', 1, 24000]] },
  ]);

  addGRNs(cid, [
    { number: 'GRN-2026-0001', date: daysAgo(36), supplier: 'Metro Manila Stationery Supply', total: 86400, status: 'Received', items: [['Bond paper, 80gsm', 240, 180], ['Ballpoint pens, boxed', 120, 120], ['Archival folders', 200, 96]] },
  ], pos[0]?.id);

  log(`${PH.name}: 10 ledgers, 4 taxes, 26 vouchers, 5 assets, 3 POs, 1 GRN`);
}

// ---------------------------------------------------------------------------

try {
  log(RESET ? 'seeding demo data (--reset: existing demo companies are replaced)' : 'seeding demo data');
  seedIndia();
  seedPhilippines();

  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM companies)  AS companies,
         (SELECT COUNT(*) FROM ledgers)    AS ledgers,
         (SELECT COUNT(*) FROM transactions) AS vouchers,
         (SELECT COUNT(*) FROM assets)     AS assets,
         (SELECT COUNT(*) FROM purchase_orders) AS pos,
         (SELECT COUNT(*) FROM grns)       AS grns`,
    )
    .get();
  log(`database now holds ${JSON.stringify(totals)}`);
  log('done');
} catch (err) {
  console.error('[seed] FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  db.close();
}
