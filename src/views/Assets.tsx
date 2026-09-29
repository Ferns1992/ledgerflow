import React, { useMemo, useState } from 'react';
import { Download, Edit, Plus, Trash2, Upload } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Td, Th } from '../components/ui';
import { exportToExcel, exportToPDF } from '../lib/exporters';
import type { Asset } from '../types';
import { formatMoney, isValidDate, parseLocalDate, round2, today } from '../lib/format';
import { format } from 'date-fns';

const BLANK = { name: '', value: 0, purchase_date: today(), depreciation_rate: 0 };

interface DerivedRow {
  asset: Asset;
  bookValue: number;
  depreciation: number;
}

export function AssetsView() {
  const { assets, currentCompany, canWrite, notify, confirm, refreshCompany } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [asOf, setAsOf] = useState(today());
  const fileRef = React.useRef<HTMLInputElement>(null);

  const currency = currentCompany?.currency_symbol ?? '₹';

  const rows = useMemo<DerivedRow[]>(() => {
    const reference = isValidDate(asOf) ? asOf : today();
    return assets.map((asset) => {
      // Straight-line depreciation, floored at zero so an asset never goes negative.
      const rate = Number(asset.depreciation_rate) || 0;
      let depreciation = 0;
      if (rate > 0 && isValidDate(asset.purchase_date) && asset.purchase_date <= reference) {
        const years = (parseLocalDate(reference).getTime() - parseLocalDate(asset.purchase_date).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000);
        depreciation = round2(asset.value * (rate / 100) * Math.max(years, 0));
      }
      return { asset, depreciation, bookValue: round2(asset.value - depreciation) };
    });
  }, [assets, asOf]);

  const totals = useMemo(
    () => ({
      cost: round2(rows.reduce((s, r) => s + r.asset.value, 0)),
      depreciation: round2(rows.reduce((s, r) => s + r.depreciation, 0)),
      net: round2(rows.reduce((s, r) => s + r.bookValue, 0)),
    }),
    [rows],
  );

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...BLANK, purchase_date: today() });
    setFormOpen(true);
  };

  const openEdit = (asset: Asset) => {
    setEditing(asset);
    setForm({
      name: asset.name,
      value: asset.value,
      purchase_date: asset.purchase_date || today(),
      depreciation_rate: asset.depreciation_rate,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!currentCompany) return;
    if (!form.name.trim()) {
      notify('Asset name is required', 'error');
      return;
    }
    if (form.depreciation_rate < 0 || form.depreciation_rate > 100) {
      notify('Depreciation rate must be between 0 and 100', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(editing ? `/api/assets/${editing.id}` : '/api/assets', {
        method: editing ? 'PUT' : 'POST',
        body: { ...form, company_id: currentCompany.id },
      });
      notify(editing ? 'Asset updated' : 'Asset created');
      closeForm();
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not save asset'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (asset: Asset) => {
    const ok = await confirm('Delete asset', `Delete "${asset.name}"?`, { danger: true });
    if (!ok) return;
    try {
      await api(`/api/assets/${asset.id}`, { method: 'DELETE' });
      notify('Asset deleted');
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Could not delete asset'), 'error');
    }
  };

  const runImport = async (file: File) => {
    if (!currentCompany) return;
    setImporting(true);
    try {
      const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        notify('No rows found. Expected headers: Name, Value, Purchase Date, Depreciation Rate', 'error');
        return;
      }
      const payload = lines
        .slice(1)
        .map((line) => {
          const [name, value, date, rate] = splitCsvLine(line).map((c) => c.trim().replace(/^"|"$/g, ''));
          if (!name) return null;
          return {
            company_id: currentCompany.id,
            name,
            value: Number(value) || 0,
            purchase_date: isValidDate(date ?? '') ? (date as string) : '',
            depreciation_rate: Number(rate) || 0,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (payload.length === 0) {
        notify('No valid rows found', 'error');
        return;
      }
      const result = await api<{ count: number }>('/api/assets/bulk', { method: 'POST', body: { assets: payload } });
      notify(`Imported ${result.count} asset(s)`);
      await refreshCompany();
    } catch (error) {
      notify(errMsg(error, 'Import failed'), 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (!currentCompany) {
    return <EmptyState title="No company selected" hint="Create a company to start tracking assets." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fixed Assets"
        description={`${assets.length} asset(s) in ${currentCompany.name}`}
        actions={
          <>
            <Input
              type="date"
              className="!w-40"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              title="Depreciation as of"
            />
            <Button
              variant="outline"
              disabled={!assets.length}
              onClick={() =>
                void exportToExcel(
                  rows.map((r) => ({
                    Name: r.asset.name,
                    'Purchase Date': r.asset.purchase_date,
                    'Cost Value': r.asset.value,
                    'Depreciation Rate': r.asset.depreciation_rate,
                    Depreciation: r.depreciation,
                    'Net Book Value': r.bookValue,
                  })),
                  'assets',
                )
              }
            >
              <Download size={16} /> Excel
            </Button>
            <Button
              variant="outline"
              disabled={!assets.length}
              onClick={() =>
                void exportToPDF(
                  'Fixed Assets',
                  ['Name', 'Purchased', 'Cost', 'Rate %', 'Depreciation', 'Net Value'],
                  rows.map((r) => [
                    r.asset.name,
                    r.asset.purchase_date,
                    r.asset.value.toFixed(2),
                    r.asset.depreciation_rate,
                    r.depreciation.toFixed(2),
                    r.bookValue.toFixed(2),
                  ]),
                  { company: currentCompany.name, subtitle: `Depreciation as of ${asOf}` },
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
                  <Plus size={16} /> New Asset
                </Button>
              </>
            )}
          </>
        }
      />

      {assets.length === 0 ? (
        <Card>
          <EmptyState
            title="No assets tracked"
            hint="Add machinery, vehicles or equipment to get straight-line depreciation and net book value."
            action={canWrite ? <Button onClick={openCreate}>Add the first asset</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total cost" value={formatMoney(totals.cost, currency)} />
            <StatCard label="Accumulated depreciation" value={formatMoney(totals.depreciation, currency)} />
            <StatCard label="Net book value" value={formatMoney(totals.net, currency)} accent />
          </div>

          <DataTable
            empty=""
            headers={
              <>
                <Th>Asset</Th>
                <Th>Purchased</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Depreciation</Th>
                <Th className="text-right">Net Value</Th>
                {canWrite && <Th className="text-right">Actions</Th>}
              </>
            }
          >
            {rows.map(({ asset, depreciation, bookValue }) => (
              <tr key={asset.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <Td className="font-medium text-zinc-900 dark:text-white">{asset.name}</Td>
                <Td className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  {isValidDate(asset.purchase_date) ? format(parseLocalDate(asset.purchase_date), 'dd MMM yyyy') : '—'}
                </Td>
                <Td className="text-right font-mono">{formatMoney(asset.value, currency)}</Td>
                <Td className="text-right font-mono text-zinc-500 dark:text-zinc-400">{asset.depreciation_rate}%</Td>
                <Td className="text-right font-mono text-red-600 dark:text-red-400">
                  {depreciation ? `-${formatMoney(depreciation, currency)}` : '—'}
                </Td>
                <Td className="text-right font-mono font-semibold">{formatMoney(bookValue, currency)}</Td>
                {canWrite && (
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" className="px-2 py-1" title="Edit" onClick={() => openEdit(asset)}>
                        <Edit size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Delete"
                        onClick={() => void remove(asset)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? 'Edit asset' : 'New asset'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <Input
            label="Asset name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Delivery Van"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={`Cost value (${currency})`}
              type="number"
              step="0.01"
              min="0"
              required
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
            <Input
              label="Purchase date"
              type="date"
              value={form.purchase_date}
              onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
            />
          </div>
          <Input
            label="Depreciation rate (% per year)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.depreciation_rate}
            onChange={(e) =>
              setForm({ ...form, depreciation_rate: e.target.value === '' ? 0 : Number(e.target.value) })
            }
            hint="Straight line. Leave 0 for an asset that is not depreciated."
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create asset'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent
          ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
          : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wider ${
          accent ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'
        }`}
      >
        {label}
      </p>
      <p className="text-2xl font-bold mt-1 font-mono">{value}</p>
    </div>
  );
}

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
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
