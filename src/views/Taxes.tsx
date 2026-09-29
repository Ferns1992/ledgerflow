import { useState } from 'react';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Td, Th } from '../components/ui';
import type { Tax } from '../types';

const BLANK = { name: '', rate: 0 };

export function TaxesView() {
  const { taxes, currentCompany, canWrite, notify, confirm, refreshCompany } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tax | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

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

  const openEdit = (tax: Tax) => {
    setEditing(tax);
    setForm({ name: tax.name, rate: tax.rate });
    setFormOpen(true);
  };

  const save = async () => {
    if (!currentCompany) return;
    if (!form.name.trim()) {
      notify('Tax name is required', 'error');
      return;
    }
    if (form.rate < 0 || form.rate > 100) {
      notify('Rate must be between 0 and 100', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(editing ? `/api/taxes/${editing.id}` : '/api/taxes', {
        method: editing ? 'PUT' : 'POST',
        body: { ...form, company_id: currentCompany.id },
      });
      notify(editing ? 'Tax updated' : 'Tax created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save tax'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tax: Tax) => {
    const ok = await confirm(
      'Delete tax',
      `Delete "${tax.name}"? Vouchers that already used it keep their recorded tax amount, but the rate will no longer be selectable.`,
      { danger: true },
    );
    if (!ok) return;
    try {
      await api(`/api/taxes/${tax.id}`, { method: 'DELETE' });
      notify('Tax deleted');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not delete tax'), 'error');
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Create a company to define its taxes." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Taxes"
        description={`${taxes.length} tax rate(s) configured for ${currentCompany.name}`}
        actions={
          canWrite && (
            <Button onClick={openCreate}>
              <Plus size={16} /> New Tax
            </Button>
          )
        }
      />

      {taxes.length === 0 ? (
        <Card>
          <EmptyState
            title="No taxes defined"
            hint="Define GST or VAT rates once, then attach a tax to any voucher."
            action={canWrite ? <Button onClick={openCreate}>Add the first tax</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>Name</Th>
              <Th className="text-right">Rate</Th>
              {canWrite && <Th className="text-right">Actions</Th>}
            </>
          }
        >
          {taxes.map((tax) => (
            <tr key={tax.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td className="font-medium text-zinc-900 dark:text-white">{tax.name}</Td>
              <Td className="text-right">
                <span className="font-mono text-zinc-700 dark:text-zinc-200">{tax.rate}%</span>
              </Td>
              {canWrite && (
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" className="px-2 py-1" title="Edit" onClick={() => openEdit(tax)}>
                      <Edit size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-red-600 hover:text-red-700"
                      title="Delete"
                      onClick={() => void remove(tax)}
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

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? 'Edit tax' : 'New tax'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <Input
            label="Tax name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. GST 18%"
          />
          <Input
            label="Rate (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            required
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create tax'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
