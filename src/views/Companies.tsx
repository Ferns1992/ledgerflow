import { useMemo, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Td, Th } from '../components/ui';
import { exportToExcel, exportToPDF } from '../lib/exporters';
import type { Company } from '../types';

const BLANK = { name: '', address: '', gstin: '', currency_symbol: '₹' };

export function CompaniesView() {
  const { companies, currentCompany, canWrite, isAdmin, notify, confirm, refreshCompany, refreshUsers } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<{ key: 'name' | 'gstin'; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [query, setQuery] = useState('');

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

  const openEdit = (company: Company) => {
    setEditing(company);
    setForm({
      name: company.name,
      address: company.address,
      gstin: company.gstin,
      currency_symbol: company.currency_symbol || '₹',
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      notify('Company name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(editing ? `/api/companies/${editing.id}` : '/api/companies', {
        method: editing ? 'PUT' : 'POST',
        body: form,
      });
      notify(editing ? 'Company updated' : 'Company created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save company'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (company: Company) => {
    const ok = await confirm(
      'Delete company',
      `Permanently delete "${company.name}" and every voucher, ledger, asset, purchase order and goods receipt inside it?\n\nThis cannot be undone.`,
      { danger: true },
    );
    if (!ok) return;
    try {
      await api(`/api/companies/${company.id}`, { method: 'DELETE' });
      notify('Company deleted');
      await refreshCompany();
      await refreshUsers();
    } catch (error) {
      notify(errMsg(error, 'Could not delete company'), 'error');
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? companies.filter((c) => [c.name, c.gstin, c.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      : [...companies];

    // The table only ever offers name/gstin, so read those two rather than
    // indexing Company with a key that may not exist on it.
    const column = (c: Company) => (sort.key === 'gstin' ? c.gstin : c.name);
    return filtered.sort((a, b) => {
      const cmp = column(a).localeCompare(column(b), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [companies, query, sort]);

  const toggleSort = (key: 'name' | 'gstin') =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description={`${companies.length} company${companies.length === 1 ? '' : 'ies'} you have access to`}
        actions={
          <>
            <Input
              className="!w-56"
              placeholder="Search companies…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!visible.length}
              onClick={() => void exportToExcel(visible as unknown as Record<string, unknown>[], 'companies')}
            >
              <Download size={16} /> Excel
            </Button>
            <Button
              variant="outline"
              disabled={!visible.length}
              onClick={() =>
                void exportToPDF(
                  'Companies',
                  ['Name', 'GSTIN', 'Address', 'Currency'],
                  visible.map((c) => [c.name, c.gstin, c.address, c.currency_symbol]),
                )
              }
            >
              <Download size={16} /> PDF
            </Button>
            {canWrite && (
              <Button onClick={openCreate}>
                <Plus size={16} /> New Company
              </Button>
            )}
          </>
        }
      />

      {companies.length === 0 ? (
        <Card>
          <EmptyState
            title="No companies yet"
            hint="A company holds its own ledgers, vouchers, assets and documents. Data never crosses between companies."
            action={canWrite ? <Button onClick={openCreate}>Create your first company</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>
                <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1">
                  Name {sort.key === 'name' && (sort.dir === 'asc' ? '↑' : '↓')}
                </button>
              </Th>
              <Th>
                <button type="button" onClick={() => toggleSort('gstin')} className="inline-flex items-center gap-1">
                  GSTIN {sort.key === 'gstin' && (sort.dir === 'asc' ? '↑' : '↓')}
                </button>
              </Th>
              <Th>Address</Th>
              <Th className="text-right">Currency</Th>
              {(canWrite || isAdmin) && <Th className="text-right">Actions</Th>}
            </>
          }
        >
          {visible.map((company) => (
            <tr key={company.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-900 dark:text-white">{company.name}</span>
                  {currentCompany?.id === company.id && <Badge tone="green">Active</Badge>}
                </div>
              </Td>
              <Td className="font-mono text-zinc-500 dark:text-zinc-400">{company.gstin || '—'}</Td>
              <Td className="max-w-xs truncate" title={company.address}>
                {company.address || '—'}
              </Td>
              <Td className="text-right font-mono">{company.currency_symbol}</Td>
              {(canWrite || isAdmin) && (
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    {canWrite && (
                      <Button variant="outline" className="px-2 py-1" onClick={() => openEdit(company)}>
                        Edit
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Delete company"
                        onClick={() => void remove(company)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    )}
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? 'Edit company' : 'New company'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <Input
            label="Company name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="GSTIN / Tax ID"
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
            placeholder="Optional"
          />
          <Input
            label="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Optional"
          />
          <Input
            label="Currency symbol"
            value={form.currency_symbol}
            onChange={(e) => setForm({ ...form, currency_symbol: e.target.value.slice(0, 4) })}
            hint="Shown next to every amount in this company."
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create company'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
