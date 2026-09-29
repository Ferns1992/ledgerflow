import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Td, Th } from '../components/ui';
import { parseItems, type POItem, type PurchaseOrder } from '../types';
import { formatMoney, isValidDate, round2, today } from '../lib/format';
import { format } from 'date-fns';

const STATUSES = ['Pending', 'Approved', 'Ordered', 'Received', 'Cancelled'];
const BLANK_ITEM: POItem = { description: '', quantity: 1, rate: 0, amount: 0 };

interface FormState {
  type: 'LPO' | 'IPO';
  po_number: string;
  date: string;
  supplier: string;
  status: string;
  items: POItem[];
}

export function PurchaseOrdersView() {
  const { purchaseOrders, currentCompany, canWrite, notify, confirm, refreshCompany } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [form, setForm] = useState<FormState>({ type: 'LPO', po_number: '', date: today(), supplier: '', status: 'Pending', items: [] });
  const [saving, setSaving] = useState(false);
  const [numbering, setNumbering] = useState(false);

  const currency = currentCompany?.currency_symbol ?? '₹';

  const total = useMemo(() => round2(form.items.reduce((s, i) => s + (Number(i.amount) || 0), 0)), [form.items]);

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const openCreate = async () => {
    setEditing(null);
    setForm({ type: 'LPO', po_number: '', date: today(), supplier: '', status: 'Pending', items: [{ ...BLANK_ITEM }] });
    setFormOpen(true);
    // Suggest the next sequential number so users are not hand-counting POs.
    setNumbering(true);
    try {
      const next = await api<{ number: string }>(`/api/next-number/po?company_id=${currentCompany?.id ?? 0}`);
      setForm((f) => (f.po_number ? f : { ...f, po_number: next.number }));
    } catch {
      // A manual number is fine; leave the field empty.
    } finally {
      setNumbering(false);
    }
  };

  const openEdit = (po: PurchaseOrder) => {
    setEditing(po);
    setForm({
      type: po.type,
      po_number: po.po_number,
      date: po.date,
      supplier: po.supplier,
      status: po.status,
      items: parseItems<POItem>(po.items),
    });
    setFormOpen(true);
  };

  const setItem = (index: number, patch: Partial<POItem>) => {
    setForm((f) => {
      const items = f.items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        // Amount is derived, never typed, so the rows can never disagree.
        next.amount = round2((Number(next.quantity) || 0) * (Number(next.rate) || 0));
        return next;
      });
      return { ...f, items };
    });
  };

  const save = async () => {
    if (!currentCompany) return;
    if (!form.po_number.trim()) {
      notify('PO number is required', 'error');
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
      await api(editing ? `/api/purchase-orders/${editing.id}` : '/api/purchase-orders', {
        method: editing ? 'PUT' : 'POST',
        body: {
          company_id: currentCompany.id,
          type: form.type,
          po_number: form.po_number,
          date: form.date,
          supplier: form.supplier,
          status: form.status,
          total_amount: round2(items.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
          items,
        },
      });
      notify(editing ? 'Purchase order updated' : 'Purchase order created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save purchase order'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (po: PurchaseOrder) => {
    const ok = await confirm(
      'Delete purchase order',
      `Delete ${po.type} ${po.po_number}? Any goods receipt linked to it will be kept but unlinked.`,
      { danger: true },
    );
    if (!ok) return;
    try {
      await api(`/api/purchase-orders/${po.id}`, { method: 'DELETE' });
      notify('Purchase order deleted');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not delete purchase order'), 'error');
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Create a company to raise purchase orders." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        description={`${purchaseOrders.length} order(s) in ${currentCompany.name}`}
        actions={
          canWrite && (
            <Button onClick={() => void openCreate()}>
              <Plus size={16} /> New {form.type}
            </Button>
          )
        }
      />

      {purchaseOrders.length === 0 ? (
        <Card>
          <EmptyState
            title="No purchase orders"
            hint="Raise an order to track what you have committed to buy, then receive it against a goods receipt."
            action={canWrite ? <Button onClick={() => void openCreate()}>Create the first order</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>Type</Th>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Supplier</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
              {canWrite && <Th className="text-right">Actions</Th>}
            </>
          }
        >
          {purchaseOrders.map((po) => (
            <tr key={po.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td>
                <Badge tone={po.type === 'IPO' ? 'amber' : 'blue'}>{po.type}</Badge>
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => openEdit(po)}
                  className="font-medium text-zinc-900 dark:text-white hover:underline"
                >
                  {po.po_number}
                </button>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {parseItems<POItem>(po.items).length} item(s)
                </p>
              </Td>
              <Td className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                {isValidDate(po.date) ? format(new Date(po.date), 'dd MMM yyyy') : po.date}
              </Td>
              <Td className="text-zinc-600 dark:text-zinc-300">{po.supplier || '—'}</Td>
              <Td className="text-right font-mono">{formatMoney(po.total_amount, currency)}</Td>
              <Td>
                <Badge tone={statusTone(po.status)}>{po.status}</Badge>
              </Td>
              {canWrite && (
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-red-600 hover:text-red-700"
                      title="Delete"
                      onClick={() => void remove(po)}
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

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? `Edit ${editing.type}` : 'New purchase order'} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, type: 'LPO' })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  form.type === 'LPO'
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                Local PO
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, type: 'IPO' })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  form.type === 'IPO'
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                Import PO
              </button>
            </div>
            <Input
              label="PO number"
              required
              value={form.po_number}
              onChange={(e) => setForm({ ...form, po_number: e.target.value })}
              hint={numbering ? 'Suggesting the next number…' : undefined}
            />
            <Input
              label="Date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <Input
              label="Supplier"
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Line items</p>
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1"
                onClick={() => setForm({ ...form, items: [...form.items, { ...BLANK_ITEM }] })}
              >
                <Plus size={14} /> Add line
              </Button>
            </div>
            {form.items.length === 0 ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">No line items yet.</p>
            ) : (
              form.items.map((item, index) => (
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
                    title="Amount is calculated from quantity × rate"
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
              ))
            )}
            <div className="flex justify-end pt-2">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                Total{' '}
                <strong className="font-mono text-zinc-900 dark:text-white">{formatMoney(total, currency)}</strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create order'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function statusTone(status: string): 'neutral' | 'green' | 'amber' | 'red' | 'blue' {
  switch (status) {
    case 'Approved':
    case 'Received':
      return 'green';
    case 'Ordered':
      return 'blue';
    case 'Pending':
      return 'amber';
    case 'Cancelled':
      return 'red';
    default:
      return 'neutral';
  }
}
