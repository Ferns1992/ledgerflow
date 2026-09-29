import React, { useMemo, useState } from 'react';
import { Download, Edit, Plus, Trash2, Upload } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Td, Textarea, Th } from '../components/ui';
import { exportToExcel, exportToPDF } from '../lib/exporters';
import type { Transaction } from '../types';
import { formatMoney, isValidDate, parseLocalDate, today } from '../lib/format';
import { format } from 'date-fns';

const BLANK = {
  date: today(),
  debit_ledger_id: '',
  credit_ledger_id: '',
  amount: 0,
  tax_id: '',
  tax_amount: 0,
  narration: '',
};

export function VouchersView() {
  const { transactions, ledgers, taxes, currentCompany, canWrite, notify, confirm, refreshCompany } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const currency = currentCompany?.currency_symbol ?? '₹';
  const ledgerOptions = useMemo(
    () => ledgers.map((l) => ({ value: l.id, label: `${l.name} (${l.group_name})` })),
    [ledgers],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) =>
      [t.narration, t.debit_ledger_name, t.credit_ledger_name, t.date, String(t.amount)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [transactions, query]);

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...BLANK, date: today() });
    setFormOpen(true);
  };

  const openEdit = (t: Transaction) => {
    setEditing(t);
    setForm({
      date: t.date,
      debit_ledger_id: String(t.debit_ledger_id),
      credit_ledger_id: String(t.credit_ledger_id),
      amount: t.amount,
      tax_id: t.tax_id ? String(t.tax_id) : '',
      tax_amount: t.tax_amount,
      narration: t.narration,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!currentCompany) return;
    if (!isValidDate(form.date)) {
      notify('Enter a valid date', 'error');
      return;
    }
    if (!form.debit_ledger_id || !form.credit_ledger_id) {
      notify('Choose both a debit and a credit ledger', 'error');
      return;
    }
    if (form.debit_ledger_id === form.credit_ledger_id) {
      notify('Debit and credit ledgers must be different', 'error');
      return;
    }
    if (!(form.amount > 0)) {
      notify('Amount must be greater than zero', 'error');
      return;
    }

    setSaving(true);
    try {
      await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', {
        method: editing ? 'PUT' : 'POST',
        body: {
          company_id: currentCompany.id,
          date: form.date,
          debit_ledger_id: Number(form.debit_ledger_id),
          credit_ledger_id: Number(form.credit_ledger_id),
          amount: Number(form.amount),
          tax_id: form.tax_id ? Number(form.tax_id) : null,
          tax_amount: form.tax_id ? Number(form.tax_amount) : 0,
          narration: form.narration,
        },
      });
      notify(editing ? 'Voucher updated' : 'Voucher created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save voucher'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Transaction) => {
    const ok = await confirm(
      'Delete voucher',
      `Delete voucher #${t.id} for ${formatMoney(t.amount + t.tax_amount, currency)}? This cannot be undone.`,
      { danger: true },
    );
    if (!ok) return;
    try {
      await api(`/api/transactions/${t.id}`, { method: 'DELETE' });
      notify('Voucher deleted');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not delete voucher'), 'error');
    }
  };

  const runImport = async (file: File) => {
    if (!currentCompany) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { rows, skipped } = parseVoucherCsv(text);
      if (rows.length === 0) {
        notify('No valid rows found. Expected headers: Date, Debit Ledger, Credit Ledger, Amount, Narration', 'error');
        return;
      }
      // The API rejects the whole batch if any row is invalid, so map ledger
      // names to ids here and let the server own the rest of the validation.
      const byName = new Map(ledgers.map((l) => [l.name.trim().toLowerCase(), l.id]));
      const mapped = rows
        .map((r) => ({
          ...r,
          company_id: currentCompany.id,
          debit_ledger_id: byName.get(r.debit_ledger.toLowerCase()) ?? 0,
          credit_ledger_id: byName.get(r.credit_ledger.toLowerCase()) ?? 0,
        }))
        .filter((r) => r.debit_ledger_id > 0 && r.credit_ledger_id > 0);

      if (mapped.length === 0) {
        notify('None of the rows matched a ledger name in this company', 'error');
        return;
      }

      const result = await api<{ count: number }>('/api/transactions/bulk', {
        method: 'POST',
        body: { transactions: mapped },
      });
      const ignored = skipped + (rows.length - mapped.length);
      notify(`Imported ${result.count} voucher(s)${ignored > 0 ? `, skipped ${ignored}` : ''}`);
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Import failed'), 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Create a company before recording vouchers." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description={`${transactions.length} journal entr${transactions.length === 1 ? 'y' : 'ies'} in ${currentCompany.name}`}
        actions={
          <>
            <Input
              className="!w-56"
              placeholder="Search vouchers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!visible.length}
              onClick={() => void exportToExcel(visible as unknown as Record<string, unknown>[], 'vouchers')}
            >
              <Download size={16} /> Excel
            </Button>
            <Button
              variant="outline"
              disabled={!visible.length}
              onClick={() =>
                void exportToPDF(
                  'Vouchers',
                  ['Date', 'Debit', 'Credit', 'Amount', 'Tax', 'Narration'],
                  visible.map((t) => [
                    t.date,
                    t.debit_ledger_name ?? '',
                    t.credit_ledger_name ?? '',
                    t.amount.toFixed(2),
                    t.tax_amount.toFixed(2),
                    t.narration,
                  ]),
                  { company: currentCompany.name },
                )
              }
            >
              <Download size={16} /> PDF
            </Button>
            {canWrite && (
              <>
                <Button
                  variant="outline"
                  disabled={importing || !ledgers.length}
                  title={!ledgers.length ? 'Create a ledger first' : undefined}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={16} /> {importing ? 'Importing…' : 'Import CSV'}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void runImport(file);
                  }}
                />
                <Button onClick={openCreate} disabled={!ledgers.length}>
                  <Plus size={16} /> New Voucher
                </Button>
              </>
            )}
          </>
        }
      />

      {!ledgers.length ? (
        <Card>
          <EmptyState
            title="Create ledgers first"
            hint="A voucher is a double entry — it needs both a debit and a credit ledger to post against."
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={query ? 'No vouchers match that search' : 'No vouchers yet'}
            hint={
              query
                ? 'Try a different search term.'
                : 'Record income, expenses and transfers as balanced journal entries.'
            }
            action={canWrite && !query ? <Button onClick={openCreate}>Record the first voucher</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>Date</Th>
              <Th>Debit</Th>
              <Th>Credit</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Tax</Th>
              <Th>Narration</Th>
              {canWrite && <Th className="text-right">Actions</Th>}
            </>
          }
        >
          {visible.map((t) => (
            <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                {isValidDate(t.date) ? format(parseLocalDate(t.date), 'dd MMM yyyy') : t.date}
              </Td>
              <Td className="font-medium text-zinc-900 dark:text-white">{t.debit_ledger_name ?? '—'}</Td>
              <Td className="font-medium text-zinc-900 dark:text-white">{t.credit_ledger_name ?? '—'}</Td>
              <Td className="text-right font-mono">{formatMoney(t.amount, currency)}</Td>
              <Td className="text-right font-mono text-zinc-500 dark:text-zinc-400">
                {t.tax_amount ? formatMoney(t.tax_amount, currency) : '—'}
              </Td>
              <Td className="max-w-xs truncate text-zinc-600 dark:text-zinc-300" title={t.narration}>
                {t.narration || '—'}
              </Td>
              {canWrite && (
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" className="px-2 py-1" title="Edit" onClick={() => openEdit(t)}>
                      <Edit size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-red-600 hover:text-red-700"
                      title="Delete"
                      onClick={() => void remove(t)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? 'Edit voucher' : 'New voucher'} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <Input
              label={`Amount (${currency})`}
              type="number"
              step="0.01"
              min="0"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
            <Select
              label="Debit ledger"
              required
              value={form.debit_ledger_id}
              onChange={(e) => setForm({ ...form, debit_ledger_id: e.target.value })}
              options={ledgerOptions}
            />
            <Select
              label="Credit ledger"
              required
              value={form.credit_ledger_id}
              onChange={(e) => setForm({ ...form, credit_ledger_id: e.target.value })}
              options={ledgerOptions}
            />
            <Select
              label="Tax"
              value={form.tax_id}
              onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
              options={taxes.map((t) => ({ value: t.id, label: `${t.name} (${t.rate}%)` }))}
            />
            <Input
              label="Tax amount"
              type="number"
              step="0.01"
              min="0"
              disabled={!form.tax_id}
              value={form.tax_amount}
              onChange={(e) => setForm({ ...form, tax_amount: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
          </div>
          <Textarea
            label="Narration"
            rows={2}
            value={form.narration}
            onChange={(e) => setForm({ ...form, narration: e.target.value })}
            placeholder="What is this entry for?"
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create voucher'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface ParsedVoucher {
  date: string;
  debit_ledger: string;
  credit_ledger: string;
  amount: number;
  narration: string;
}

function parseVoucherCsv(text: string): { rows: ParsedVoucher[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0 };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const idx = (name: string) => header.findIndex((h) => h === name);
  const iDate = idx('date');
  const iDebit = idx('debit ledger');
  const iCredit = idx('credit ledger');
  const iAmount = idx('amount');
  const iNarration = idx('narration');

  if (iDate < 0 || iDebit < 0 || iCredit < 0 || iAmount < 0) {
    return { rows: [], skipped: 0 };
  }

  const rows: ParsedVoucher[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const date = (cells[iDate] ?? '').trim();
    const debit = (cells[iDebit] ?? '').trim();
    const credit = (cells[iCredit] ?? '').trim();
    const amount = Number(cells[iAmount]);
    if (!isValidDate(date) || !debit || !credit || !Number.isFinite(amount) || amount <= 0) {
      skipped++;
      continue;
    }
    rows.push({ date, debit_ledger: debit, credit_ledger: credit, amount, narration: (cells[iNarration] ?? '').trim() });
  }
  return { rows, skipped };
}

/** Handles quoted cells so a narration containing a comma does not shift columns. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
