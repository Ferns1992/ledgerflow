import { useMemo, useState } from 'react';
import { ArrowRightLeft, Check, Sparkles } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Button, Card, EmptyState, Modal, PageHeader, Select, Td, Th } from '../components/ui';
import type { Asset, Ledger, Transaction } from '../types';
import { formatMoney, isValidDate, round2 } from '../lib/format';
import { format } from 'date-fns';

type TransferKind = 'ledger' | 'voucher' | 'asset';

interface Target {
  kind: TransferKind;
  id: number;
  label: string;
  detail: string;
}

export function TransferView() {
  const { companies, currentCompany, isAdmin, notify, confirm, refreshCompany } = useApp();
  const [selected, setSelected] = useState<Target | null>(null);
  const [target, setTarget] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<TransferKind>('ledger');

  const candidates = useAppCandidates();

  const run = async () => {
    if (!selected || !target) return;
    const destination = companies.find((c) => c.id === target);
    const ok = await confirm(
      'Move to another company',
      `Move "${selected.label}" from ${currentCompany?.name} to ${destination?.name}?${
        filter === 'voucher'
          ? '\n\nAny ledger used only by this voucher moves with it. If a ledger is shared with other vouchers staying behind, the move is refused.'
          : filter === 'ledger'
            ? '\n\nEvery voucher posting against this ledger moves with it.'
            : ''
      }`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const key = filter === 'voucher' ? 'voucher_id' : filter === 'asset' ? 'asset_id' : 'ledger_id';
      await api(`/api/transfers/${filter}`, {
        method: 'POST',
        body: { [key]: selected.id, target_company_id: target },
      });
      notify(`Moved to ${destination?.name}`);
      setSelected(null);
      setTarget('');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Transfer failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Select a company to move records between them." />;
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admins only"
        hint="Moving records between companies changes who can see them, so it is restricted to administrators."
      />
    );
  }

  if (companies.length < 2) {
    return (
      <EmptyState
        title="You need a second company"
        hint="Transfers move a record from this company into another one. Create a second company first."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inter-company Transfers"
        description="Move a ledger, voucher or asset into another company. Everything moves together, or nothing does."
      />

      <div className="flex gap-2">
        {(['ledger', 'voucher', 'asset'] as TransferKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => {
              setFilter(kind);
              setSelected(null);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors capitalize ${
              filter === kind
                ? 'border-zinc-900 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
            }`}
          >
            {kind === 'ledger' ? 'Ledgers' : filter === 'voucher' ? 'Vouchers' : 'Assets'}
          </button>
        ))}
      </div>

      {candidates[filter].length === 0 ? (
        <Card>
          <EmptyState title={`No ${filter}s to move`} hint="Create one in this company first." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50">
                  <Th>Record</Th>
                  <Th>Detail</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {candidates[filter].map((row) => (
                  <tr key={`${filter}-${row.id}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <Td className="font-medium text-zinc-900 dark:text-white">{row.label}</Td>
                    <Td className="text-zinc-500 dark:text-zinc-400 text-xs">{row.detail}</Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          className="px-2 py-1"
                          onClick={() => {
                            setSelected(row);
                            setTarget('');
                          }}
                        >
                          <ArrowRightLeft size={14} /> Move
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title={`Move ${filter}`}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">
          Choose which company receives <strong>{selected?.label}</strong>.
        </p>
        <Select
          label="Destination company"
          value={target}
          onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}
          options={companies
            .filter((c) => c.id !== currentCompany.id)
            .map((c) => ({ value: c.id, label: c.name }))}
        />
        {filter === 'voucher' && (
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500 flex items-start gap-1.5">
            <Sparkles size={13} className="shrink-0 mt-0.5" />
            Ledgers used only by this voucher travel with it. A shared ledger blocks the move rather than being
            duplicated.
          </p>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={() => setSelected(null)}>
            Cancel
          </Button>
          <Button disabled={!target || busy} onClick={() => void run()}>
            {busy ? 'Moving…' : (
              <>
                <Check size={15} /> Move record
              </>
            )}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function useAppCandidates() {
  const { ledgers, transactions, assets, currentCompany } = useApp();
  const currency = currentCompany?.currency_symbol ?? '₹';

  return useMemo(() => {
    const ledgerRows: Target[] = ledgers.map((l: Ledger) => ({
      kind: 'ledger',
      id: l.id,
      label: l.name,
      detail: `${l.group_name || 'Ungrouped'} · opening ${formatMoney(l.opening_balance, currency)}`,
    }));

    const voucherRows: Target[] = transactions.map((t: Transaction) => ({
      kind: 'voucher',
      id: t.id,
      label: `${t.debit_ledger_name ?? 'Dr'} → ${t.credit_ledger_name ?? 'Cr'}`,
      detail: `${isValidDate(t.date) ? format(new Date(t.date), 'dd MMM yyyy') : t.date} · ${formatMoney(
        t.amount + (t.tax_amount || 0),
        currency,
      )}`,
    }));

    const assetRows: Target[] = assets.map((a: Asset) => ({
      kind: 'asset',
      id: a.id,
      label: a.name,
      detail: `cost ${formatMoney(round2(a.value), currency)} · ${a.depreciation_rate}% depreciation`,
    }));

    return { ledger: ledgerRows, voucher: voucherRows, asset: assetRows };
  }, [ledgers, transactions, assets, currency]);
}
