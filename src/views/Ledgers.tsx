import React, { useState } from 'react';
import { ArrowRightLeft, Download, Edit, Plus, Trash2, Upload } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg, field } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Td, Th } from '../components/ui';
import { exportToExcel, exportToPDF } from '../lib/exporters';
import { BALANCE_GROUPS, EXPENSE_GROUPS, INCOME_GROUPS, LEDGER_GROUPS, type Ledger } from '../types';
import { formatMoney } from '../lib/format';

const BLANK = { name: '', group_name: 'Direct Expenses' as string, opening_balance: 0 };

export function LedgersView() {
  const {
    ledgers,
    currentCompany,
    canWrite,
    isAdmin,
    companies,
    notify,
    confirm,
    refreshCompany,
  } = useApp();

  const [editing, setEditing] = useState<Ledger | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [transferring, setTransferring] = useState<Ledger | null>(null);
  const [targetCompany, setTargetCompany] = useState<number | ''>('');
  const [importing, setImporting] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const currency = currentCompany?.currency_symbol ?? '₹';

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setFormOpen(true);
  };

  const openEdit = (ledger: Ledger) => {
    setEditing(ledger);
    setForm({
      name: ledger.name,
      group_name: ledger.group_name,
      opening_balance: ledger.opening_balance,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!currentCompany) return;
    if (!form.name.trim()) {
      notify('Ledger name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(editing ? `/api/ledgers/${editing.id}` : '/api/ledgers', {
        method: editing ? 'PUT' : 'POST',
        body: { ...form, company_id: currentCompany.id },
      });
      notify(editing ? 'Ledger updated' : 'Ledger created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save ledger'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ledger: Ledger) => {
    // The server refuses to drop a ledger that still has vouchers, and reports
    // how many are in the way, so we can ask for confirmation with real numbers.
    const ok = await confirm(
      'Delete ledger',
      `Delete "${ledger.name}"? Ledgers that still have vouchers will be refused.`,
      { danger: true },
    );
    if (!ok) return;

    try {
      await api(`/api/ledgers/${ledger.id}`, { method: 'DELETE' });
      notify('Ledger deleted');
      await refreshCompany();
    } catch (error) {
      const used = field<number>(error, 'transactionCount');
      const canCascade = field<boolean>(error, 'canCascade');
      if (typeof used === 'number' && used > 0) {
        if (canCascade) {
          const force = await confirm(
            'Ledger is in use',
            `"${ledger.name}" is used by ${used} voucher(s). Deleting it will permanently destroy those vouchers and break their audit trail.\n\nThis cannot be undone.`,
            { danger: true },
          );
          if (force) {
            try {
              const result = await api<{ deletedTransactions: number }>(`/api/ledgers/${ledger.id}?cascade=true`, {
                method: 'DELETE',
              });
              notify(`Ledger and ${result.deletedTransactions} voucher(s) deleted`);
              await refreshCompany();
            } catch (e) {
              notify(errMsg(e, 'Could not delete ledger'), 'error');
            }
          }
        } else {
          notify(
            `"${ledger.name}" is used by ${used} voucher(s) and cannot be deleted. Reassign or remove those vouchers first.`,
            'error',
          );
        }
      } else {
        notify(errMsg(error, 'Could not delete ledger'), 'error');
      }
    }
  };

  const runImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseLedgerCsv(text, currentCompany?.id ?? 0);
      if (rows.length === 0) {
        notify('No valid rows found. Expected headers: Name, Group, Opening Balance', 'error');
        return;
      }
      const result = await api<{ count: number }>('/api/ledgers/bulk', {
        method: 'POST',
        body: { ledgers: rows },
      });
      notify(`Imported ${result.count} ledger(s)`);
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Import failed'), 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runTransfer = async () => {
    if (!transferring || !targetCompany) return;
    try {
      await api('/api/transfers/ledger', {
        method: 'POST',
        body: { ledger_id: transferring.id, target_company_id: targetCompany },
      });
      notify(`"${transferring.name}" transferred`);
      setTransferring(null);
      setTargetCompany('');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Transfer failed'), 'error');
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Create a company to start building ledgers." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ledgers"
        description={`${ledgers.length} account(s) in ${currentCompany.name}`}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!ledgers.length}
              onClick={() => void exportToExcel(ledgers as unknown as Record<string, unknown>[], 'ledgers')}
            >
              <Download size={16} /> Excel
            </Button>
            <Button
              variant="outline"
              disabled={!ledgers.length}
              onClick={() =>
                void exportToPDF(
                  'Ledgers',
                  ['Name', 'Group', 'Opening Balance'],
                  ledgers.map((l) => [l.name, l.group_name, l.opening_balance.toFixed(2)]),
                  { company: currentCompany.name },
                )
              }
            >
              <Download size={16} /> PDF
            </Button>
            {canWrite && (
              <>
                <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
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
                <Button onClick={openCreate}>
                  <Plus size={16} /> New Ledger
                </Button>
              </>
            )}
          </>
        }
      />

      {ledgers.length === 0 ? (
        <Card>
          <EmptyState
            title="No ledgers yet"
            hint="Ledgers are the accounts your vouchers post against — cash, debtors, sales, and so on."
            action={canWrite ? <Button onClick={openCreate}>Create the first ledger</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>Name</Th>
              <Th>Group</Th>
              <Th className="text-right">Opening Balance</Th>
              <Th className="text-right">Actions</Th>
            </>
          }
        >
          {ledgers.map((ledger) => (
            <tr key={ledger.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td className="font-medium text-zinc-900 dark:text-white">{ledger.name}</Td>
              <Td>
                <Badge tone={groupTone(ledger.group_name)}>{ledger.group_name || 'Ungrouped'}</Badge>
              </Td>
              <Td className="text-right font-mono">{formatMoney(ledger.opening_balance, currency)}</Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      className="px-2 py-1"
                      title="Transfer to another company"
                      onClick={() => setTransferring(ledger)}
                    >
                      <ArrowRightLeft size={15} />
                    </Button>
                  )}
                  {canWrite && (
                    <>
                      <Button variant="ghost" className="px-2 py-1" title="Edit" onClick={() => openEdit(ledger)}>
                        <Edit size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Delete"
                        onClick={() => void remove(ledger)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? 'Edit ledger' : 'New ledger'}>
        <LedgerForm
          form={form}
          setForm={setForm}
          isEdit={Boolean(editing)}
          saving={saving}
          onSave={save}
          onCancel={closeForm}
        />
      </Modal>

      <Modal isOpen={Boolean(transferring)} onClose={() => setTransferring(null)} title="Transfer ledger">
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">
          Move <strong>{transferring?.name}</strong> to a different company. Its vouchers move with it.
        </p>
        <Select
          label="Target company"
          value={targetCompany}
          onChange={(e) => setTargetCompany(e.target.value === '' ? '' : Number(e.target.value))}
          options={companies
            .filter((c) => c.id !== currentCompany.id)
            .map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={() => setTransferring(null)}>
            Cancel
          </Button>
          <Button disabled={!targetCompany} onClick={() => void runTransfer()}>
            Transfer
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function LedgerForm({
  form,
  setForm,
  isEdit,
  saving,
  onSave,
  onCancel,
}: {
  form: typeof BLANK;
  setForm: (f: typeof BLANK) => void;
  isEdit: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-4"
    >
      <Input
        label="Ledger name"
        required
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="e.g. Cash"
      />
      <Select
        label="Group"
        value={form.group_name}
        onChange={(e) => setForm({ ...form, group_name: e.target.value })}
        options={LEDGER_GROUPS.map((g) => ({ value: g, label: g }))}
      />
      <Input
        label="Opening balance"
        type="number"
        step="0.01"
        value={form.opening_balance}
        onChange={(e) => setForm({ ...form, opening_balance: e.target.value === '' ? 0 : Number(e.target.value) })}
      />
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create ledger'}
        </Button>
      </div>
    </form>
  );
}

function groupTone(group: string): 'neutral' | 'green' | 'amber' | 'blue' {
  if ((INCOME_GROUPS as readonly string[]).includes(group)) return 'green';
  if ((EXPENSE_GROUPS as readonly string[]).includes(group)) return 'amber';
  if ((BALANCE_GROUPS as readonly string[]).includes(group)) return 'blue';
  return 'neutral';
}

/** Minimum CSV parse: Name, Group, Opening Balance. */
function parseLedgerCsv(text: string, companyId: number) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const rows: { company_id: number; name: string; group_name: string; opening_balance: number }[] = [];
  for (const line of lines.slice(1)) {
    const [name, group, balance] = line.split(',').map((c) => (c ?? '').trim().replace(/^"|"$/g, ''));
    if (!name) continue;
    rows.push({
      company_id: companyId,
      name,
      group_name: group || 'Direct Expenses',
      opening_balance: Number(balance) || 0,
    });
  }
  return rows;
}
