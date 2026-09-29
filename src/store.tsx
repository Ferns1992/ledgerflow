import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, errMsg, onUnauthorized } from './lib/api';
import { Button, Modal, Notification } from './components/ui';
import {
  type Asset,
  type Company,
  type EventLog,
  type GRN,
  type Ledger,
  type PurchaseOrder,
  type Tax,
  type Transaction,
  type User,
  canWrite,
  isAdmin,
} from './types';

interface Notification {
  message: string;
  type: 'success' | 'error';
}

interface AppState {
  // Session
  user: User | null;
  booting: boolean;
  loggingIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;

  // Directory
  companies: Company[];
  currentCompany: Company | null;
  setCurrentCompanyId: (id: number) => void;

  // Per-company data
  ledgers: Ledger[];
  transactions: Transaction[];
  assets: Asset[];
  taxes: Tax[];
  purchaseOrders: PurchaseOrder[];
  grns: GRN[];

  // Admin-only
  users: User[];
  logs: EventLog[];

  loading: boolean;
  canWrite: boolean;
  isAdmin: boolean;

  notify: (message: string, type?: 'success' | 'error') => void;
  confirm: (title: string, message: string, options?: { danger?: boolean }) => Promise<boolean>;
  refreshCompany: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshLogs: () => Promise<void>;
}

/** One company's data, as returned by GET /api/companies/:id/bundle. */
interface CompanyBundle {
  ledgers: Ledger[];
  transactions: Transaction[];
  assets: Asset[];
  taxes: Tax[];
  purchaseOrders: PurchaseOrder[];
  grns: GRN[];
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<number | null>(null);

  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);

  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<EventLog[]>([]);

  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const refreshAbort = useRef<AbortController | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    resolve: (v: boolean) => void;
  } | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
  }, []);

  const confirm = useCallback(
    (title: string, message: string, options?: { danger?: boolean }) =>
      new Promise<boolean>((resolve) => setConfirmState({ title, message, danger: options?.danger, resolve })),
    [],
  );

  // A 401 anywhere means the session is gone: drop straight to the login screen.
  useEffect(() => {
    onUnauthorized(() => {
      setUser(null);
      setCompanies([]);
      setLedgers([]);
      setTransactions([]);
      setAssets([]);
      setTaxes([]);
      setPurchaseOrders([]);
      setGrns([]);
      setUsers([]);
      setLogs([]);
      setCurrentCompanyId(null);
    });
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      setUsers(await api<User[]>('/api/users'));
    } catch {
      setUsers([]);
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      setLogs(await api<EventLog[]>('/api/logs?limit=200'));
    } catch {
      setLogs([]);
    }
  }, []);

  const refreshCompany = useCallback(async () => {
    if (currentCompanyId === null) {
      setLedgers([]);
      setTransactions([]);
      setAssets([]);
      setTaxes([]);
      setPurchaseOrders([]);
      setGrns([]);
      return;
    }
    setLoading(true);

    // A newer switch invalidates this response, so abort the older request
    // instead of letting two bundles race to set state.
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;

    try {
      // One request, not six. See the /api/companies/:id/bundle route.
      const bundle = await api<CompanyBundle>(`/api/companies/${currentCompanyId}/bundle`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setLedgers(bundle.ledgers);
      setTransactions(bundle.transactions);
      setAssets(bundle.assets);
      setTaxes(bundle.taxes);
      setPurchaseOrders(bundle.purchaseOrders);
      setGrns(bundle.grns);
    } catch (error) {
      if (controller.signal.aborted) return;
      notify(errMsg(error, 'Could not load company data'), 'error');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [currentCompanyId, notify]);

  // Drop the in-flight request when the provider unmounts.
  useEffect(() => () => refreshAbort.current?.abort(), []);

  const loadDirectory = useCallback(
    async (active: User) => {
      const list = await api<Company[]>('/api/companies');
      setCompanies(list);
      setCurrentCompanyId((prev) => {
        if (prev !== null && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
      // Only admins can read these, so only admins ask for them.
      if (active.role === 'admin') {
        await Promise.all([refreshUsers(), refreshLogs()]);
      } else {
        setUsers([]);
        setLogs([]);
      }
    },
    [refreshUsers, refreshLogs],
  );

  // Bootstrap: ask the server who we already are, so a refresh keeps the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<User>('/api/me');
        if (cancelled) return;
        setUser(me);
        await loadDirectory(me);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount; loadDirectory is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshCompany();
  }, [refreshCompany]);

  const login = useCallback(
    async (username: string, password: string) => {
      setLoggingIn(true);
      try {
        const me = await api<User>('/api/login', { method: 'POST', body: { username, password } });
        setUser(me);
        await loadDirectory(me);
        notify('Signed in successfully');
      } catch (error) {
        notify(errMsg(error, 'Invalid credentials'), 'error');
        throw error;
      } finally {
        setLoggingIn(false);
      }
    },
    [loadDirectory, notify],
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      // A failed logout still clears local state; the cookie expires server-side.
    }
    setUser(null);
    setCompanies([]);
    setCurrentCompanyId(null);
    setLedgers([]);
    setTransactions([]);
    setAssets([]);
    setTaxes([]);
    setPurchaseOrders([]);
    setGrns([]);
    setUsers([]);
    setLogs([]);
  }, []);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      try {
        await api('/api/me/password', { method: 'POST', body: { current_password: current, new_password: next } });
        setUser((prev) => (prev ? { ...prev, must_change_password: 0 } : prev));
        notify('Password updated');
      } catch (error) {
        notify(errMsg(error, 'Could not change password'), 'error');
        throw error;
      }
    },
    [notify],
  );

  const currentCompany = useMemo(
    () => companies.find((c) => c.id === currentCompanyId) ?? null,
    [companies, currentCompanyId],
  );

  const setCurrentCompanyIdSafe = useCallback((id: number) => setCurrentCompanyId(id), []);

  const value = useMemo<AppState>(
    () => ({
      user,
      booting,
      loggingIn,
      login,
      logout,
      changePassword,
      companies,
      currentCompany,
      setCurrentCompanyId: setCurrentCompanyIdSafe,
      ledgers,
      transactions,
      assets,
      taxes,
      purchaseOrders,
      grns,
      users,
      logs,
      loading,
      canWrite: canWrite(user),
      isAdmin: isAdmin(user),
      notify,
      confirm,
      refreshCompany,
      refreshUsers,
      refreshLogs,
    }),
    [
      user, booting, loggingIn, login, logout, changePassword, companies, currentCompany,
      setCurrentCompanyIdSafe, ledgers, transactions, assets, taxes, purchaseOrders, grns,
      users, logs, loading, notify, confirm, refreshCompany, refreshUsers, refreshLogs,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
      {confirmState && (
        <Modal
          isOpen
          onClose={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
          title={confirmState.title}
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-line">{confirmState.message}</p>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => {
                confirmState.resolve(false);
                setConfirmState(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={confirmState.danger ? 'danger' : 'primary'}
              onClick={() => {
                confirmState.resolve(true);
                setConfirmState(null);
              }}
            >
              Confirm
            </Button>
          </div>
        </Modal>
      )}
    </AppContext.Provider>
  );
}
