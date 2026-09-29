import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  Building2,
  FileStack,
  Landmark,
  LogOut,
  Menu,
  Package,
  Receipt,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../store';
import { Avatar, Badge, Select } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Wallet;
  /** Only the dashboard should light up on an exact path match. */
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Wallet, end: true },
  { to: '/vouchers', label: 'Vouchers', icon: Receipt },
  { to: '/ledgers', label: 'Ledgers', icon: Landmark },
  { to: '/assets', label: 'Assets', icon: Building2 },
  { to: '/taxes', label: 'Taxes', icon: ScrollText },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: FileStack },
  { to: '/grns', label: 'Goods Receipts', icon: Package },
  { to: '/companies', label: 'Companies', icon: Building2 },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/users', label: 'Users', icon: Users },
  { to: '/transfers', label: 'Transfers', icon: ArrowRightLeft },
  { to: '/audit', label: 'Audit Log', icon: ShieldCheck },
];

export function AppShell() {
  const { user, companies, currentCompany, setCurrentCompanyId, isAdmin, logout, loading } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const links = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transform transition-transform lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 h-16 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900">
              <Wallet size={15} />
            </div>
            <span className="font-bold text-zinc-900 dark:text-white">LedgerFlow</span>
          </div>
          <button
            type="button"
            className="lg:hidden p-1.5 text-zinc-500"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={user?.full_name || user?.username || '?'} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                {user?.full_name || user?.username}
              </p>
              <Badge tone={isAdmin ? 'blue' : 'neutral'}>{user?.role}</Badge>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Sign out"
              className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 h-16 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 px-4 lg:px-8">
          <button
            type="button"
            className="lg:hidden p-2 -ml-2 text-zinc-600 dark:text-zinc-300"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <div className="flex-1 min-w-0">
            {companies.length > 0 && (
              <Select
                className="!py-1.5 !text-sm font-semibold max-w-xs"
                value={currentCompany?.id ?? ''}
                onChange={(e) => setCurrentCompanyId(Number(e.target.value))}
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </div>

          {loading && (
            <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 animate-spin" />
          )}

          <span className="hidden sm:block text-xs text-zinc-400 dark:text-zinc-500">
            {currentCompany?.currency_symbol ?? ''}
          </span>
        </header>

        <main className="p-4 lg:p-8 max-w-7xl mx-auto" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
