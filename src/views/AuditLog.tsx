import { useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useApp } from '../store';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, Td, Th } from '../components/ui';
import { exportToExcel, exportToPDF } from '../lib/exporters';
import { actionTone } from '../lib/format';
import type { EventLog } from '../types';

export function AuditLogView() {
  const { logs, refreshLogs, notify } = useApp();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const actions = useMemo(
    () => Array.from(new Set(logs.map((l) => l.action))).sort(),
    [logs],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (action && l.action !== action) return false;
      if (!q) return true;
      return [l.user_name, l.details, l.entity_type, l.action, l.timestamp]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [logs, query, action]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshLogs();
    } catch {
      notify('Could not refresh the audit log', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Every write is recorded with the account that made it. Entries cannot be edited or removed."
        actions={
          <>
            <Input
              className="!w-56"
              placeholder="Search the log…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button variant="outline" disabled={refreshing} onClick={() => void doRefresh()}>
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} /> Refresh
            </Button>
            <Button
              variant="outline"
              disabled={!visible.length}
              onClick={() => void exportToExcel(visible as unknown as Record<string, unknown>[], 'audit_log')}
            >
              <Download size={16} /> Excel
            </Button>
            <Button
              variant="outline"
              disabled={!visible.length}
              onClick={() =>
                void exportToPDF(
                  'Audit Log',
                  ['When', 'Who', 'Action', 'Entity', 'Details'],
                  visible.map((l) => [l.timestamp, l.user_name, l.action, l.entity_type, l.details]),
                )
              }
            >
              <Download size={16} /> PDF
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAction('')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              action === ''
                ? 'border-zinc-900 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
            }`}
          >
            All actions
          </button>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                action === a
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title={logs.length === 0 ? 'Nothing logged yet' : 'No entries match those filters'}
            hint={
              logs.length === 0
                ? 'As soon as someone creates or edits something it will appear here.'
                : 'Try clearing the action filter or the search box.'
            }
          />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Details</Th>
            </>
          }
        >
          {visible.map((log: EventLog) => (
            <tr key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td className="whitespace-nowrap font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(log.timestamp).toLocaleString()}
              </Td>
              <Td className="font-medium text-zinc-900 dark:text-white">{log.user_name}</Td>
              <Td>
                <span
                  className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                    {
                      create: 'bg-emerald-100 text-emerald-700',
                      update: 'bg-amber-100 text-amber-700',
                      delete: 'bg-red-100 text-red-700',
                      neutral: 'bg-zinc-100 text-zinc-600',
                    }[actionTone(log.action)]
                  } dark:bg-zinc-800 dark:text-zinc-300`}
                >
                  {log.action}
                </span>
              </Td>
              <Td className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {log.entity_type}
                {log.entity_id ? ` #${log.entity_id}` : ''}
              </Td>
              <Td className="max-w-lg text-zinc-600 dark:text-zinc-300">{log.details}</Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
