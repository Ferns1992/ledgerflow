import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Td, Th } from '../components/ui';
import { parseItems, type GRNItem, type GRN } from '../types';
import { formatMoney, isValidDate, round2, today } from '../lib/format';
import { format } from 'date-fns';
import { statusTone } from './PurchaseOrders';

const BLANK_ITEM: GRNItem = { description: '', quantity: 1, rate: 0, amount: 0 };

interface FormState {
  grn_number: string;
  date: string;
  po_id: number | '';
  supplier: string;
  status: string;
  items: GRNItem[];
}

export function GRNsView() {
  const { grns, purchaseOrders, currentCompany, canWrite, notify, confirm, refreshCompany } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GRN | null>(null);
  const [form, setForm] = useState<FormState>({
    grn_number: '',
    date: today(),
    po_id: '',
    supplier: '',
    status: 'Pending',
    items: [{ ...BLANK_ITEM }],
  });
  const [saving, setSaving] = useState(false);
  const [numbering, setNumbering] = useState(false);

  const currency = currentCompany?.currency_symbol ?? '₹';
  const openPOs = purchaseOrders.filter((p) => p.status !== 'Cancelled' && p.status !== 'Received');

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const openCreate = async () => {
    setEditing(null);
    setForm({ grn_number: '', date: today(), po_id: '', supplier: '', status: 'Pending', items: [{ ...BLANK_ITEM }] });
    setFormOpen(true);
    setNumbering(true);
    try {
      const next = await api<{ number: string }>(`/api/next-number/grn?company_id=${currentCompany?.id ?? 0}`);
      setForm((f) => (f.grn_number ? f : { ...f, grn_number: next.number }));
    } catch {
      // Manual numbering is acceptable.
    } finally {
      setNumbering(false);
    }
  };

  const openEdit = (grn: GRN) => {
    setEditing(grn);
    setForm({
      grn_number: grn.grn_number,
      date: grn.date,
      po_id: grn.po_id ?? '',
      supplier: grn.supplier,
      status: grn.status,
      items: parseItems<GRNItem>(grn.items),
    });
    setFormOpen(true);
  };

  const setItem = (index: number, patch: Partial<GRNItem>) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        next.amount = round2((Number(next.quantity) || 0) * (Number(next.rate) || 0));
        return next;
      }),
    }));
  };

  const save = async () => {
    if (!currentCompany) return;
    if (!form.grn_number.trim()) {
      notify('GRN number is required', 'error');
      return;
    }
    if (!isValidDate(form.date)) {
      notify('Enter a valid date', 'error');
      return;
    }
    const items = form.items.filter((i) => i.description.trim());
    if (items.length === 0) {
      notify('Add at least one line item', 'error');
      return;
    }

    setSaving(true);
    try {
      await api(editing ? `/api/grns/${editing.id}` : '/api/grns', {
        method: editing ? 'PUT' : 'POST',
        body: {
          company_id: currentCompany.id,
          grn_number: form.grn_number,
          date: form.date,
          po_id: form.po_id === '' ? null : Number(form.po_id),
          supplier: form.supplier,
          status: form.status,
          total_amount: round2(items.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
          items,
        },
      });
      notify(editing ? 'Goods receipt updated' : 'Goods receipt created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save goods receipt'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (grn: GRN) => {
    const ok = await confirm('Delete goods receipt', `Delete GRN ${grn.grn_number}?`, { danger: true });
    if (!ok) return;
    try {
      await api(`/api/grns/${grn.id}`, { method: 'DELETE' });
      notify('Goods receipt deleted');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not delete goods receipt'), 'error');
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Create a company to record goods receipts." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goods Receipts"
        description={`${grns.length} receipt(s) in ${currentCompany.name}`}
        actions={
          canWrite && (
            <Button onClick={() => void openCreate()}>
              <Plus size={16} /> New GRN
            </Button>
          )
        }
      />

      {grns.length === 0 ? (
        <Card>
          <EmptyState
            title="No goods receipts"
            hint="Record what actually arrived, optionally against a purchase order."
            action={canWrite ? <Button onClick={() => void openCreate()}>Record the first receipt</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>PO</Th>
              <Th>Supplier</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
              {canWrite && <Th className="text-right">Actions</Th>}
            </>
          }
        >
          {grns.map((grn) => {
            const linked = purchaseOrders.find((p) => p.id === grn.po_id);
            return (
              <tr key={grn.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <Td>
                  <button
                    type="button"
                    onClick={() => openEdit(grn)}
                    className="font-medium text-zinc-900 dark:text-white hover:underline"
                  >
                    {grn.grn_number}
                  </button>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {parseItems<GRNItem>(grn.items).length} item(s)
                  </p>
                </Td>
                <Td className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  {isValidDate(grn.date) ? format(new Date(grn.date), 'dd MMM yyyy') : grn.date}
                </Td>
                <Td className="font-mono text-zinc-500 dark:text-zinc-400">{linked ? linked.po_number : '—'}</Td>
                <Td className="text-zinc-600 dark:text-zinc-300">{grn.supplier || '—'}</Td>
                <Td className="text-right font-mono">{formatMoney(grn.total_amount, currency)}</Td>
                <Td>
                  <Badge tone={statusTone(grn.status)}>{grn.status}</Badge>
                </Td>
                {canWrite && (
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Delete"
                        onClick={() => void remove(grn)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </Td>
                )}
              </tr>
            );
          })}
        </DataTable>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? `Edit GRN ${editing.grn_number}` : 'New goods receipt'} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="GRN number"
              required
              value={form.grn_number}
              onChange={(e) => setForm({ ...form, grn_number: e.target.value })}
              hint={numbering ? 'Suggesting the next number…' : undefined}
            />
            <Input
              label="Date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <Select
              label="Against purchase order"
              value={form.po_id}
              onChange={(e) => {
                const poId = e.target.value === '' ? '' : Number(e.target.value);
                const po = purchaseOrders.find((p) => p.id === poId);
                setForm((f) => ({
                  ...f,
                  po_id: poId,
                  // Pull supplier and lines across from the PO so the receipt
                  // cannot silently disagree with what was ordered.
                  supplier: po?.supplier || f.supplier,
                  items: po ? parseItems<GRNItem>(po.items) : f.items,
                }));
              }}
              options={openPOs.map((p) => ({ value: p.id, label: `${p.type} ${p.po_number} — ${p.supplier || 'no supplier'}` }))}
              placeholder="No linked order"
            />
            <Input
              label="Supplier"
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Received items</p>
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1"
                onClick={() => setForm({ ...form, items: [...form.items, { ...BLANK_ITEM }] })}
              >
                <Plus size={14} /> Add line
              </Button>
            </div>
            {form.items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="col-span-12 sm:col-span-5 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
                  placeholder="Description"
                  value={item.description}
                  onChange={(e) => setItem(index, { description: e.target.value })}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="col-span-4 sm:col-span-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-mono dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) => setItem(index, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="col-span-4 sm:col-span-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-mono dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
                  placeholder="Rate"
                  value={item.rate}
                  onChange={(e) => setItem(index, { rate: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <input
                  readOnly
                  className="col-span-3 sm:col-span-2 px-3 py-2 bg-zinc-100 border border-zinc-200 rounded-lg text-sm font-mono text-zinc-500 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400"
                  value={round2((Number(item.quantity) || 0) * (Number(item.rate) || 0)).toFixed(2)}
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}
                  className="col-span-1 px-2 py-2 text-red-600 hover:text-red-700"
                  title="Remove line"
                >
                  <Trash2 size={15} className="mx-auto" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create receipt'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
