import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Landmark, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useApp } from '../store';
import { Button, Card, EmptyState, PageHeader, Td, Th } from '../components/ui';
import { EXPENSE_GROUPS, INCOME_GROUPS } from '../types';
import { formatMoney, isValidDate, round2 } from '../lib/format';
import { format, isAfter, startOfMonth, subMonths } from 'date-fns';

export function DashboardView() {
  const { ledgers, transactions, assets, currentCompany, user, canWrite, isAdmin } = useApp();

  const currency = currentCompany?.currency_symbol ?? '₹';
  const groupOf = useMemo(() => new Map(ledgers.map((l) => [l.id, l.group_name])), [ledgers]);

  const report = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      const debitGroup = groupOf.get(t.debit_ledger_id) ?? '';
      const creditGroup = groupOf.get(t.credit_ledger_id) ?? '';
      const total = t.amount + (t.tax_amount || 0);

      // Double entry gives the sign, so no halving is needed.
      //
      // A credit to an income ledger is revenue; a debit to one is a refund or
      // reversal, so it subtracts. A debit to an expense is a cost; a credit to
      // one reverses it.
      //
      // This matters because a voucher usually has only one P&L leg. "Sales Dr
      // / Receivables Cr" is revenue with no expense anywhere, and an earlier
      // version that counted both legs and halved the total would have booked
      // half the revenue as an expense. Balance-sheet ledgers (assets,
      // liabilities) contribute nothing here, which is correct.
      if ((INCOME_GROUPS as readonly string[]).includes(creditGroup)) income += total;
      if ((INCOME_GROUPS as readonly string[]).includes(debitGroup)) income -= total;
      if ((EXPENSE_GROUPS as readonly string[]).includes(debitGroup)) expense += total;
      if ((EXPENSE_GROUPS as readonly string[]).includes(creditGroup)) expense -= total;
    }
    income = round2(income);
    expense = round2(expense);
    return { income, expense, profit: round2(income - expense) };
  }, [transactions, groupOf]);

  const balanceByLedger = useMemo(() => {
    const balances = new Map<number, number>();
    for (const ledger of ledgers) {
      balances.set(ledger.id, round2(ledger.opening_balance || 0));
    }
    for (const t of transactions) {
      balances.set(
        t.debit_ledger_id,
        round2((balances.get(t.debit_ledger_id) ?? 0) + t.amount + (t.tax_amount || 0)),
      );
      balances.set(
        t.credit_ledger_id,
        round2((balances.get(t.credit_ledger_id) ?? 0) - t.amount - (t.tax_amount || 0)),
      );
    }
    return balances;
  }, [ledgers, transactions]);

  const topLedgers = useMemo(
    () =>
      [...ledgers]
        .map((ledger) => ({ ledger, balance: balanceByLedger.get(ledger.id) ?? 0 }))
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .slice(0, 6),
    [ledgers, balanceByLedger],
  );

  const monthly = useMemo(() => {
    const now = new Date();
    const buckets: { label: string; income: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      buckets.push({ label: format(d, 'MMM'), income: 0, expense: 0 });
    }
    for (const t of transactions) {
      if (!isValidDate(t.date)) continue;
      const d = parseDate(t.date);
      const index = buckets.findIndex((b) => b.label === format(d, 'MMM'));
      if (index === -1) continue;
      const total = t.amount + (t.tax_amount || 0);
      const debitGroup = groupOf.get(t.debit_ledger_id) ?? '';
      const creditGroup = groupOf.get(t.credit_ledger_id) ?? '';
      // Same sign convention as the headline P&L: credit an income ledger adds
      // revenue, debit an expense ledger adds cost.
      if ((INCOME_GROUPS as readonly string[]).includes(creditGroup)) buckets[index].income += total;
      if ((INCOME_GROUPS as readonly string[]).includes(debitGroup)) buckets[index].income -= total;
      if ((EXPENSE_GROUPS as readonly string[]).includes(debitGroup)) buckets[index].expense += total;
      if ((EXPENSE_GROUPS as readonly string[]).includes(creditGroup)) buckets[index].expense -= total;
    }
    return buckets.map((b) => ({ ...b, income: round2(b.income), expense: round2(b.expense) }));
  }, [transactions, groupOf]);

  const assetTotal = round2(assets.reduce((s, a) => s + (a.value || 0), 0));

  const upcoming = useMemo(() => {
    const cutoff = new Date();
    const since = startOfMonth(cutoff);
    return transactions.filter((t) => {
      if (!isValidDate(t.date)) return false;
      const d = parseDate(t.date);
      return !isAfter(d, cutoff) && isAfter(d, since);
    }).length;
  }, [transactions]);

  if (!currentCompany) {
    return (
      <EmptyState
        title="No company selected"
        hint="Create a company to start recording vouchers, or ask an admin to assign you to one."
        action={canWrite ? <Link to="/companies"><Button>Set up a company</Button></Link> : undefined}
      />
    );
  }

  const maxBar = Math.max(...monthly.map((m) => Math.max(m.income, m.expense)), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good to see you, ${user?.full_name || user?.username}`}
        description={`Snapshot for ${currentCompany.name}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Income"
          value={formatMoney(report.income, currency)}
          icon={TrendingUp}
          tone="green"
        />
        <MetricCard
          label="Expenses"
          value={formatMoney(report.expense, currency)}
          icon={TrendingDown}
          tone="red"
        />
        <MetricCard
          label="Net profit"
          value={formatMoney(report.profit, currency)}
          icon={Wallet}
          tone={report.profit >= 0 ? 'green' : 'red'}
        />
        <MetricCard
          label="Asset cost"
          value={formatMoney(assetTotal, currency)}
          icon={Landmark}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Income vs expenses</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Last six months</p>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Income
              </span>
              <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> Expenses
              </span>
            </div>
          </div>
          {monthly.every((m) => m.income === 0 && m.expense === 0) ? (
            <EmptyState title="Nothing to chart yet" hint="Record a few vouchers and the trend will appear here." />
          ) : (
            <div className="flex items-end gap-3 h-48">
              {monthly.map((m) => (
                <div key={m.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    <div
                      className="w-1/2 bg-emerald-500/80 hover:bg-emerald-500 rounded-t transition-all min-h-[2px]"
                      style={{ height: `${(m.income / maxBar) * 100}%` }}
                      title={`Income ${formatMoney(m.income, currency)}`}
                    />
                    <div
                      className="w-1/2 bg-red-400/80 hover:bg-red-400 rounded-t transition-all min-h-[2px]"
                      style={{ height: `${(m.expense / maxBar) * 100}%` }}
                      title={`Expenses ${formatMoney(m.expense, currency)}`}
                    />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white">This month</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 mb-4">{format(new Date(), 'MMMM yyyy')}</p>
          <div className="space-y-3">
            <QuickStat
              icon={Receipt}
              label="Vouchers posted"
              value={String(upcoming)}
              to="/vouchers"
            />
            <QuickStat icon={Landmark} label="Ledgers" value={String(ledgers.length)} to="/ledgers" />
            <QuickStat icon={Wallet} label="Assets tracked" value={String(assets.length)} to="/assets" />
            <QuickStat
              icon={Landmark}
              label="Companies"
              value={String(isAdmin ? 'all access' : 'assigned')}
              to="/companies"
            />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Largest ledger balances</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Opening balance plus all postings</p>
          </div>
          <Link to="/ledgers" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:underline flex items-center gap-1">
            All ledgers <ArrowRight size={13} />
          </Link>
        </div>
        {topLedgers.length === 0 ? (
          <EmptyState title="No ledgers yet" hint="Create ledgers to see balances roll up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[520px]">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50">
                  <Th>Ledger</Th>
                  <Th>Group</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {topLedgers.map(({ ledger, balance }) => (
                  <tr key={ledger.id}>
                    <Td className="font-medium text-zinc-900 dark:text-white">{ledger.name}</Td>
                    <Td className="text-zinc-500 dark:text-zinc-400 text-xs">{ledger.group_name}</Td>
                    <Td
                      className={`text-right font-mono font-semibold ${
                        balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-white'
                      }`}
                    >
                      {formatMoney(balance, currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  tone: 'green' | 'red' | 'neutral';
}) {
  const tones = {
    green: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
    neutral: 'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800',
  };
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
        <span className={`p-1.5 rounded-lg ${tones[tone]}`}>
          <Icon size={15} />
        </span>
      </div>
      <p className="text-2xl font-bold mt-2 font-mono text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}

function QuickStat({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof Receipt;
  label: string;
  value: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
    >
      <span className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
        <Icon size={15} />
      </span>
      <span className="flex-1 text-sm text-zinc-600 dark:text-zinc-300">{label}</span>
      <span className="text-sm font-semibold text-zinc-900 dark:text-white">{value}</span>
    </Link>
  );
}
