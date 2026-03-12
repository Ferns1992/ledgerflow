import React, { useState, useEffect, useLayoutEffect } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  Building2, 
  Users as UsersIcon, 
  FileText, 
  Plus, 
  Download, 
  LogOut,
  Package,
  ChevronRight,
  Search,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Briefcase,
  Sun,
  Moon,
  Trash2,
  Edit,
  History,
  Upload
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { cn, User, Company, Ledger, Transaction, Asset, Tax } from './types';

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-lg",
      active 
        ? "bg-zinc-900 text-white" 
        : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
    )}
  >
    <Icon size={18} />
    {label}
  </button>
);

interface CardProps {
  children: React.ReactNode;
  className?: string;
  key?: React.Key;
}

const Card = ({ children, className }: CardProps) => (
  <div className={cn("bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden dark:bg-zinc-900 dark:border-zinc-800", className)}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className, disabled, type = 'button' }: { children: React.ReactNode, onClick?: () => void, variant?: 'primary' | 'secondary' | 'outline' | 'danger', className?: string, disabled?: boolean, type?: 'button' | 'submit' }) => {
  const variants = {
    primary: "bg-zinc-900 text-white hover:bg-zinc-800",
    secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
    outline: "border border-zinc-200 text-zinc-700 hover:bg-zinc-50",
    danger: "bg-red-600 text-white hover:bg-red-700"
  };
  return (
    <button 
      type={type}
      onClick={onClick} 
      disabled={disabled}
      className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed", variants[variant], className)}
    >
      {children}
    </button>
  );
};

const Input = ({ label, className, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="space-y-1.5">
    {label && <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</label>}
    <input 
      {...props}
      className={cn("w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 transition-all dark:bg-zinc-800 dark:border-zinc-700 dark:text-white", className)}
    />
  </div>
);

const Select = ({ label, options, className, ...props }: { label?: string, options: { value: string | number, label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <div className="space-y-1.5">
    {label && <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</label>}
    <select 
      {...props}
      className={cn("w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 transition-all dark:bg-zinc-800 dark:border-zinc-700 dark:text-white", className)}
    >
      <option value="">Select Option</option>
      {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  </div>
);

const Modal = ({ children, isOpen, onClose, title }: { children: React.ReactNode, isOpen: boolean, onClose: () => void, title: string }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="font-bold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <Plus className="rotate-45" size={20} />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
};

const Notification = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={cn(
      "fixed bottom-4 right-4 z-[60] px-6 py-3 rounded-xl shadow-lg border flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300",
      type === 'success' ? "bg-emerald-50 border-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-400" : "bg-red-50 border-red-100 text-red-800 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400"
    )}>
      <div className={cn("w-2 h-2 rounded-full", type === 'success' ? "bg-emerald-500" : "bg-red-500")} />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
};

// --- Main Application ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ledgers' | 'vouchers' | 'assets' | 'users' | 'companies' | 'taxes'>('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const theme = localStorage.getItem('theme');
      console.log('theme from localStorage:', theme);
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      console.log('prefersDark:', prefersDark);
      return theme === 'dark' || (!theme && prefersDark);
    }
    return false;
  });
  
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [eventLogs, setEventLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
  };

  const handleConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  useLayoutEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    console.log('Applying theme:', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      root.classList.add('dark');
      body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Fetch Data
  useEffect(() => {
    if (user) {
      fetchCompanies();
      fetchAllUsers();
      fetchLogs();
    }
  }, [user]);

  useEffect(() => {
    if (currentCompany) {
      fetchCompanyData();
    }
  }, [currentCompany]);

  const fetchCompanies = async () => {
    const res = await fetch('/api/companies');
    const data = await res.json();
    setCompanies(data);
    if (data.length > 0) {
      if (!currentCompany || !data.find(c => c.id === currentCompany.id)) {
        setCurrentCompany(data[0]);
      }
    } else {
      setCurrentCompany(null);
    }
  };

  const fetchAllUsers = async () => {
    const res = await fetch('/api/users');
    const data = await res.json();
    setAllUsers(data);
  };

  const fetchLogs = async () => {
    const res = await fetch('/api/logs');
    const data = await res.json();
    setEventLogs(data);
  };

  const fetchCompanyData = async () => {
    if (!currentCompany) return;
    setLoading(true);
    const [lRes, tRes, aRes, taxRes] = await Promise.all([
      fetch(`/api/ledgers/${currentCompany.id}`),
      fetch(`/api/transactions/${currentCompany.id}`),
      fetch(`/api/assets/${currentCompany.id}`),
      fetch(`/api/taxes/${currentCompany.id}`)
    ]);
    setLedgers(await lRes.json());
    setTransactions(await tRes.json());
    setAssets(await aRes.json());
    setTaxes(await taxRes.json());
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        showNotification('Logged in successfully');
      } else {
        showNotification('Invalid credentials', 'error');
      }
    } catch (error) {
      console.error('Login error:', error);
      showNotification('Connection error or invalid response', 'error');
    }
  };

  const exportToExcel = (data: any[], fileName: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  const exportToPDF = (title: string, columns: string[], rows: any[][]) => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text(title, 14, 22);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Company: ${currentCompany?.name || 'N/A'}`, 14, 30);
      doc.text(`Date: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 36);
      
      autoTable(doc, {
        head: [columns],
        body: rows,
        startY: 45,
        theme: 'grid',
        headStyles: { fillColor: [24, 24, 27], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
      });
      
      doc.save(`${title.toLowerCase().replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      showNotification('Failed to generate PDF. Please check console for details.', 'error');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4 transition-colors duration-300">
        <Card className="w-full max-w-md p-8 dark:bg-zinc-900 dark:border-zinc-800">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-zinc-900 dark:bg-zinc-100 rounded-xl flex items-center justify-center text-white dark:text-zinc-900 mb-4">
              <BookOpen size={24} />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">LedgerFlow</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">Sign in to manage your accounts</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input 
              label="Username" 
              placeholder="admin"
              value={loginForm.username}
              onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
            />
            <Input 
              label="Password" 
              type="password"
              placeholder="••••••••"
              value={loginForm.password}
              onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
              className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
            />
            <Button type="submit" className="w-full py-3 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">Sign In</Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex transition-colors duration-300">
      {notification && (
        <Notification 
          message={notification.message} 
          type={notification.type} 
          onClose={() => setNotification(null)} 
        />
      )}

      {confirmModal && (
        <Modal 
          isOpen={confirmModal.isOpen} 
          onClose={() => setConfirmModal(null)} 
          title={confirmModal.title}
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmModal(null)} className="dark:border-zinc-800 dark:text-zinc-300">Cancel</Button>
              <Button variant="danger" onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}>Confirm</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
        <div className="p-6 border-bottom border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-zinc-900 dark:bg-zinc-100 rounded-lg flex items-center justify-center text-white dark:text-zinc-900">
              <BookOpen size={16} />
            </div>
            <span className="font-bold text-lg tracking-tight dark:text-white">LedgerFlow</span>
          </div>
          
          <div className="space-y-1">
            <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <SidebarItem icon={BookOpen} label="Ledgers" active={activeTab === 'ledgers'} onClick={() => setActiveTab('ledgers')} />
            <SidebarItem icon={FileText} label="Vouchers" active={activeTab === 'vouchers'} onClick={() => setActiveTab('vouchers')} />
            <SidebarItem icon={Package} label="Assets" active={activeTab === 'assets'} onClick={() => setActiveTab('assets')} />
            <SidebarItem icon={DollarSign} label="Taxes" active={activeTab === 'taxes'} onClick={() => setActiveTab('taxes')} />
            {user.role === 'admin' && (
              <SidebarItem icon={UsersIcon} label="Users" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
            )}
            <SidebarItem icon={Building2} label="Companies" active={activeTab === 'companies'} onClick={() => setActiveTab('companies')} />
            <SidebarItem icon={History} label="Event Logs" active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
          </div>
        </div>

        <div className="mt-auto p-6 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-600 dark:text-zinc-400 font-bold text-xs">
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{user.full_name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">{user.role}</p>
            </div>
          </div>
          <Button variant="outline" className="w-full flex items-center justify-center gap-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" onClick={() => setUser(null)}>
            <LogOut size={14} />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white capitalize">{activeTab}</h2>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-zinc-400" />
              <select 
                className="text-sm font-medium bg-transparent border-none focus:ring-0 cursor-pointer dark:text-zinc-300"
                value={currentCompany?.id || ''}
                onChange={e => setCurrentCompany(companies.find(c => c.id === Number(e.target.value)) || null)}
              >
                {companies.map(c => <option key={c.id} value={c.id} className="dark:bg-zinc-900">{c.name}</option>)}
              </select>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
              <input 
                type="text" 
                placeholder="Search..." 
                className="pl-9 pr-4 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-none rounded-full text-sm w-64 focus:ring-2 focus:ring-zinc-900/10 dark:text-zinc-300 transition-all"
              />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'dashboard' && (
            <DashboardView 
              transactions={transactions} 
              ledgers={ledgers} 
              assets={assets} 
              currentCompany={currentCompany}
            />
          )}
          {activeTab === 'ledgers' && (
            <LedgersView 
              ledgers={ledgers} 
              onRefresh={() => { fetchCompanyData(); fetchLogs(); }} 
              currentCompany={currentCompany}
              currentUser={user}
              showNotification={showNotification}
              handleConfirm={handleConfirm}
              exportExcel={() => exportToExcel(ledgers, 'Ledgers')}
              exportPDF={() => exportToPDF('Ledgers List', ['Name', 'Group', 'Balance'], ledgers.map(l => [l.name, l.group_name, l.opening_balance]))}
            />
          )}
          {activeTab === 'vouchers' && (
            <VouchersView 
              transactions={transactions} 
              ledgers={ledgers} 
              taxes={taxes}
              onRefresh={() => { fetchCompanyData(); fetchLogs(); }} 
              currentCompany={currentCompany}
              currentUser={user}
              showNotification={showNotification}
              handleConfirm={handleConfirm}
              exportExcel={() => exportToExcel(transactions, 'Transactions')}
              exportPDF={() => exportToPDF('Transactions List', ['Date', 'Debit', 'Credit', 'Amount', 'Narration'], transactions.map(t => [t.date, t.debit_ledger_name, t.credit_ledger_name, t.amount, t.narration]))}
            />
          )}
          {activeTab === 'assets' && (
            <AssetsView 
              assets={assets} 
              onRefresh={() => { fetchCompanyData(); fetchLogs(); }} 
              currentCompany={currentCompany}
              currentUser={user}
              showNotification={showNotification}
              handleConfirm={handleConfirm}
              exportExcel={() => exportToExcel(assets, 'Assets')}
              exportPDF={() => exportToPDF('Assets List', ['Name', 'Value', 'Purchase Date', 'Depreciation'], assets.map(a => [a.name, a.value, a.purchase_date, a.depreciation_rate]))}
            />
          )}
          {activeTab === 'taxes' && (
            <TaxesView 
              taxes={taxes} 
              onRefresh={() => { fetchCompanyData(); fetchLogs(); }} 
              currentCompany={currentCompany}
              currentUser={user}
              showNotification={showNotification}
              handleConfirm={handleConfirm}
            />
          )}
          {activeTab === 'users' && (
            <UsersView 
              allUsers={allUsers} 
              onRefresh={() => { fetchAllUsers(); fetchLogs(); }} 
              currentUser={user} 
              showNotification={showNotification}
              handleConfirm={handleConfirm}
            />
          )}
          {activeTab === 'companies' && (
            <div className="space-y-8">
              <CompaniesView 
                companies={companies} 
                onRefresh={() => { fetchCompanies(); fetchLogs(); }} 
                currentUser={user} 
                showNotification={showNotification}
                handleConfirm={handleConfirm}
              />
              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-8">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-6">Event Logs</h2>
                <EventLogsView logs={eventLogs} />
              </div>
            </div>
          )}
          {activeTab === 'logs' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">System Audit Logs</h2>
              <EventLogsView logs={eventLogs} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EventLogsView({ logs }: { logs: any[] }) {
  return (
    <Card className="dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Time</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">User</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Action</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Entity</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  {format(new Date(log.timestamp), 'MMM dd, HH:mm:ss')}
                </td>
                <td className="px-6 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">{log.user_name}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter",
                    log.action === 'CREATE' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                    log.action === 'UPDATE' ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  )}>
                    {log.action}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{log.entity_type}</td>
                <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-300">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --- View Components ---

function DashboardView({ transactions, ledgers, assets, currentCompany }: { transactions: Transaction[], ledgers: Ledger[], assets: Asset[], currentCompany: Company | null }) {
  const totalDebit = transactions.reduce((sum, t) => sum + t.amount + t.tax_amount, 0);
  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  
  const chartData = transactions.slice(0, 7).reverse().map(t => ({
    name: format(new Date(t.date), 'MMM dd'),
    amount: t.amount + t.tax_amount
  }));

  const groupData = ledgers.reduce((acc: any[], l) => {
    const existing = acc.find(a => a.name === l.group_name);
    if (existing) existing.value += 1;
    else acc.push({ name: l.group_name, value: 1 });
    return acc;
  }, []);

  const COLORS = ['#18181b', '#3f3f46', '#71717a', '#a1a1aa', '#d4d4d8'];

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 dark:bg-zinc-900 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <DollarSign size={20} />
            </div>
            <TrendingUp size={16} className="text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total Transactions</p>
          <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{currentCompany?.currency_symbol || '₹'}{totalDebit.toLocaleString()}</h3>
        </Card>
        
        <Card className="p-6 dark:bg-zinc-900 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <Briefcase size={20} />
            </div>
            <TrendingUp size={16} className="text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total Assets</p>
          <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{currentCompany?.currency_symbol || '₹'}{totalAssets.toLocaleString()}</h3>
        </Card>

        <Card className="p-6 dark:bg-zinc-900 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <BookOpen size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total Ledgers</p>
          <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{ledgers.length}</h3>
        </Card>

        <Card className="p-6 dark:bg-zinc-900 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <FileText size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total Vouchers</p>
          <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{transactions.length}</h3>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 p-6 dark:bg-zinc-900 dark:border-zinc-800">
          <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-6 uppercase tracking-widest">Recent Activity</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" className="dark:stroke-zinc-800" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                <Tooltip 
                  cursor={{ fill: '#f4f4f5' }}
                  contentStyle={{ 
                    borderRadius: '8px', 
                    border: 'none', 
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    backgroundColor: '#18181b',
                    color: '#fff'
                  }}
                />
                <Bar dataKey="amount" fill="#18181b" radius={[4, 4, 0, 0]} barSize={40} className="dark:fill-zinc-100" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 dark:bg-zinc-900 dark:border-zinc-800">
          <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-6 uppercase tracking-widest">Ledger Distribution</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={groupData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {groupData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            {groupData.slice(0, 4).map((g, i) => (
              <div key={g.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-zinc-500 dark:text-zinc-400">{g.name}</span>
                </div>
                <span className="font-bold text-zinc-900 dark:text-white">{g.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function LedgersView({ ledgers, onRefresh, currentCompany, currentUser, showNotification, handleConfirm, exportExcel, exportPDF }: { ledgers: Ledger[], onRefresh: () => void, currentCompany: Company | null, currentUser: User | null, showNotification: (m: string, t?: 'success' | 'error') => void, handleConfirm: (t: string, m: string, c: () => void) => void, exportExcel: () => void, exportPDF: () => void }) {
  console.log('LedgersView currentUser:', currentUser);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', group_name: 'Direct Expenses', opening_balance: 0 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }
    
    const url = editingId ? `/api/ledgers/${editingId}` : '/api/ledgers';
    const method = editingId ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...form, 
        company_id: currentCompany.id,
        userId: currentUser?.id,
        userName: currentUser?.username
      })
    });
    
    if (res.ok) {
      showNotification(editingId ? "Ledger updated successfully" : "Ledger created successfully");
      setForm({ name: '', group_name: 'Direct Expenses', opening_balance: 0 });
      setShowAdd(false);
      setEditingId(null);
      onRefresh();
    } else {
      showNotification("Failed to save ledger", "error");
    }
  };

  const handleEdit = (ledger: Ledger) => {
    setForm({ name: ledger.name, group_name: ledger.group_name, opening_balance: ledger.opening_balance });
    setEditingId(ledger.id);
    setShowAdd(true);
  };

  const handleDelete = async (id: number) => {
    console.log('handleDelete called for id:', id);
    handleConfirm(
      "Delete Ledger",
      "Are you sure you want to delete this ledger? This will also delete all associated transactions.",
      async () => {
        const res = await fetch(`/api/ledgers/${id}?userId=${currentUser?.id}&userName=${currentUser?.username}`, { method: 'DELETE' });
        if (res.ok) {
          showNotification("Ledger deleted successfully");
          onRefresh();
        } else {
          showNotification("Failed to delete ledger", "error");
        }
      }
    );
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const parsedLedgers = [];
        let errors = 0;

        for (const row of results.data as any[]) {
          const name = row['Name']?.trim();
          const group_name = row['Group']?.trim() || 'Direct Expenses';
          const opening_balance = parseFloat(row['Opening Balance']) || 0;

          if (!name) {
            errors++;
            continue;
          }

          parsedLedgers.push({
            company_id: currentCompany.id,
            name,
            group_name,
            opening_balance,
            userId: currentUser?.id,
            userName: currentUser?.username
          });
        }

        if (parsedLedgers.length === 0) {
          showNotification("No valid ledgers found in CSV", "error");
          return;
        }

        try {
          const res = await fetch('/api/ledgers/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              ledgers: parsedLedgers,
              userId: currentUser?.id,
              userName: currentUser?.username
            })
          });

          if (res.ok) {
            const data = await res.json();
            showNotification(`Successfully imported ${data.count} ledgers. ${errors > 0 ? `Skipped ${errors} invalid rows.` : ''}`);
            onRefresh();
          } else {
            showNotification("Failed to import ledgers", "error");
          }
        } catch (error) {
          showNotification("Error importing ledgers", "error");
        }
        
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
      error: (error) => {
        showNotification(`Error parsing CSV: ${error.message}`, "error");
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button onClick={() => setShowAdd(true)} className="flex items-center gap-2 dark:bg-white dark:text-zinc-900">
            <Plus size={16} />
            Create Ledger
          </Button>
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleImportCSV}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Upload size={14} /> Import CSV
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportExcel} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Download size={14} /> Excel
          </Button>
          <Button variant="outline" onClick={exportPDF} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Download size={14} /> PDF
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card className="p-6 border-zinc-900/20 bg-zinc-50/50 dark:bg-zinc-900 dark:border-zinc-800">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <Input label="Ledger Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Select 
              label="Group" 
              value={form.group_name} 
              onChange={e => setForm({...form, group_name: e.target.value})}
              className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              options={[
                { value: 'Direct Expenses', label: 'Direct Expenses' },
                { value: 'Indirect Expenses', label: 'Indirect Expenses' },
                { value: 'Direct Incomes', label: 'Direct Incomes' },
                { value: 'Indirect Incomes', label: 'Indirect Incomes' },
                { value: 'Current Assets', label: 'Current Assets' },
                { value: 'Fixed Assets', label: 'Fixed Assets' },
                { value: 'Current Liabilities', label: 'Current Liabilities' },
                { value: 'Capital Account', label: 'Capital Account' },
              ]}
            />
            <Input label="Opening Balance" type="number" value={form.opening_balance} onChange={e => setForm({...form, opening_balance: Number(e.target.value)})} className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <div className="md:col-span-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); setForm({ name: '', group_name: 'Direct Expenses', opening_balance: 0 }); }} className="dark:border-zinc-700 dark:text-zinc-300">Cancel</Button>
              <Button type="submit" className="dark:bg-white dark:text-zinc-900">{editingId ? 'Update Ledger' : 'Save Ledger'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="dark:bg-zinc-900 dark:border-zinc-800">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Name</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Group</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Balance</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {ledgers.map(l => (
              <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">{l.name}</td>
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{l.group_name}</td>
                <td className="px-6 py-4 text-sm font-mono text-right dark:text-zinc-300">{currentCompany?.currency_symbol || '₹'}{l.opening_balance.toLocaleString()}</td>
                <td className="px-6 py-4 text-right flex justify-end gap-2">
                  <button onClick={() => handleEdit(l)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <Edit size={16} />
                  </button>
                  <button onClick={() => handleDelete(l.id)} className="text-red-500 hover:text-red-700 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function VouchersView({ transactions, ledgers, taxes, onRefresh, currentCompany, currentUser, showNotification, handleConfirm, exportExcel, exportPDF }: { transactions: Transaction[], ledgers: Ledger[], taxes: Tax[], onRefresh: () => void, currentCompany: Company | null, currentUser: User | null, showNotification: (m: string, t?: 'success' | 'error') => void, handleConfirm: (t: string, m: string, c: () => void) => void, exportExcel: () => void, exportPDF: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ 
    date: format(new Date(), 'yyyy-MM-dd'), 
    debit_ledger_id: '', 
    credit_ledger_id: '', 
    amount: 0, 
    tax_id: '',
    tax_amount: 0,
    narration: '' 
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }
    if (form.debit_ledger_id === form.credit_ledger_id) {
      showNotification("Debit and Credit ledgers cannot be the same", "error");
      return;
    }
    
    const url = editingId ? `/api/transactions/${editingId}` : '/api/transactions';
    const method = editingId ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...form, 
        debit_ledger_id: Number(form.debit_ledger_id),
        credit_ledger_id: Number(form.credit_ledger_id),
        tax_id: form.tax_id ? Number(form.tax_id) : null,
        tax_amount: form.tax_amount,
        company_id: currentCompany.id,
        userId: currentUser?.id,
        userName: currentUser?.username
      })
    });
    
    if (res.ok) {
      showNotification(editingId ? "Voucher updated successfully" : "Voucher created successfully");
      setForm({ 
        date: format(new Date(), 'yyyy-MM-dd'), 
        debit_ledger_id: '', 
        credit_ledger_id: '', 
        amount: 0, 
        tax_id: '',
        tax_amount: 0,
        narration: '' 
      });
      setShowAdd(false);
      setEditingId(null);
      onRefresh();
    } else {
      showNotification("Failed to save voucher", "error");
    }
  };

  const handleEdit = (t: Transaction) => {
    setForm({ 
      date: t.date, 
      debit_ledger_id: String(t.debit_ledger_id), 
      credit_ledger_id: String(t.credit_ledger_id), 
      amount: t.amount, 
      tax_id: t.tax_id ? String(t.tax_id) : '',
      tax_amount: t.tax_amount,
      narration: t.narration 
    });
    setEditingId(t.id);
    setShowAdd(true);
  };

  const handleDelete = async (id: number) => {
    handleConfirm(
      "Delete Voucher",
      "Are you sure you want to delete this voucher? This action cannot be undone.",
      async () => {
        const res = await fetch(`/api/transactions/${id}?userId=${currentUser?.id}&userName=${currentUser?.username}`, { method: 'DELETE' });
        if (res.ok) {
          showNotification("Voucher deleted successfully");
          onRefresh();
        } else {
          showNotification("Failed to delete voucher", "error");
        }
      }
    );
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const parsedTransactions = [];
        let errors = 0;

        for (const row of results.data as any[]) {
          const debitLedger = ledgers.find(l => l.name.toLowerCase() === row['Debit Ledger']?.trim().toLowerCase());
          const creditLedger = ledgers.find(l => l.name.toLowerCase() === row['Credit Ledger']?.trim().toLowerCase());
          const amount = parseFloat(row['Amount']);
          const date = row['Date'];
          const narration = row['Narration'] || '';

          if (!debitLedger || !creditLedger || isNaN(amount) || !date) {
            errors++;
            continue;
          }

          parsedTransactions.push({
            company_id: currentCompany.id,
            date,
            debit_ledger_id: debitLedger.id,
            credit_ledger_id: creditLedger.id,
            amount,
            tax_id: null,
            tax_amount: 0,
            narration,
            userId: currentUser?.id,
            userName: currentUser?.username
          });
        }

        if (parsedTransactions.length === 0) {
          showNotification("No valid transactions found in CSV. Ensure headers are: Date, Debit Ledger, Credit Ledger, Amount, Narration", "error");
          return;
        }

        try {
          const res = await fetch('/api/transactions/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: parsedTransactions, userId: currentUser?.id, userName: currentUser?.username })
          });

          if (res.ok) {
            const data = await res.json();
            showNotification(`Successfully imported ${data.count} transactions.${errors > 0 ? ` Skipped ${errors} invalid rows.` : ''}`);
            onRefresh();
          } else {
            showNotification("Failed to import transactions", "error");
          }
        } catch (error) {
          showNotification("Error importing transactions", "error");
        }
        
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowAdd(true)} className="flex items-center gap-2 dark:bg-white dark:text-zinc-900">
            <Plus size={16} />
            New Voucher
          </Button>
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            onChange={handleImportCSV} 
            className="hidden" 
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Upload size={14} /> Import CSV
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportExcel} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Download size={14} /> Excel
          </Button>
          <Button variant="outline" onClick={exportPDF} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Download size={14} /> PDF
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card className="p-6 border-zinc-900/20 bg-zinc-50/50 dark:bg-zinc-900 dark:border-zinc-800">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input label="Date" type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
              <Select 
                label="Debit Ledger (Dr)" 
                value={form.debit_ledger_id} 
                onChange={e => setForm({...form, debit_ledger_id: e.target.value})}
                options={ledgers.map(l => ({ value: l.id, label: l.name }))}
                required
                className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              />
              <Select 
                label="Credit Ledger (Cr)" 
                value={form.credit_ledger_id} 
                onChange={e => setForm({...form, credit_ledger_id: e.target.value})}
                options={ledgers.map(l => ({ value: l.id, label: l.name }))}
                required
                className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input label="Amount" type="number" value={form.amount} onChange={e => {
                const amount = Number(e.target.value);
                setForm({...form, amount, tax_amount: form.tax_id ? amount * (taxes.find(t => t.id === Number(form.tax_id))?.rate || 0) / 100 : 0});
              }} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
              <Select 
                label="Tax" 
                value={form.tax_id} 
                onChange={e => {
                  const tax_id = e.target.value;
                  setForm({...form, tax_id, tax_amount: tax_id ? form.amount * (taxes.find(t => t.id === Number(tax_id))?.rate || 0) / 100 : 0});
                }}
                options={[{ value: '', label: 'No Tax' }, ...taxes.map(t => ({ value: t.id, label: `${t.name} (${t.rate}%)` }))]}
                className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              />
              <Input label="Tax Amount" type="number" value={form.tax_amount} readOnly className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            </div>
            <Input label="Narration" value={form.narration} onChange={e => setForm({...form, narration: e.target.value})} placeholder="Enter transaction details..." className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); }} className="dark:border-zinc-700 dark:text-zinc-300">Cancel</Button>
              <Button type="submit" className="dark:bg-white dark:text-zinc-900">{editingId ? 'Update Voucher' : 'Post Voucher'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="dark:bg-zinc-900 dark:border-zinc-800">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Date</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Particulars</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Amount</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {transactions.map(t => (
              <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{format(new Date(t.date), 'dd MMM yyyy')}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.debit_ledger_name} <span className="text-xs text-zinc-400 font-normal ml-2">Dr</span></span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 ml-8">To {t.credit_ledger_name}</span>
                    <span className="text-xs text-zinc-400 mt-1 italic">({t.narration})</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-mono text-right font-bold dark:text-zinc-100">{currentCompany?.currency_symbol || '₹'}{(t.amount + t.tax_amount).toLocaleString()}</td>
                <td className="px-6 py-4 text-right flex justify-end gap-2">
                  <button onClick={() => handleEdit(t)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <Edit size={16} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:text-red-700 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AssetsView({ assets, onRefresh, currentCompany, currentUser, showNotification, handleConfirm, exportExcel, exportPDF }: { assets: Asset[], onRefresh: () => void, currentCompany: Company | null, currentUser: User | null, showNotification: (m: string, t?: 'success' | 'error') => void, handleConfirm: (t: string, m: string, c: () => void) => void, exportExcel: () => void, exportPDF: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', value: 0, purchase_date: format(new Date(), 'yyyy-MM-dd'), depreciation_rate: 10 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }
    
    const url = editingId ? `/api/assets/${editingId}` : '/api/assets';
    const method = editingId ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...form, 
        company_id: currentCompany.id,
        userId: currentUser?.id,
        userName: currentUser?.username
      })
    });
    
    if (res.ok) {
      showNotification(editingId ? "Asset updated successfully" : "Asset created successfully");
      setForm({ name: '', value: 0, purchase_date: format(new Date(), 'yyyy-MM-dd'), depreciation_rate: 10 });
      setShowAdd(false);
      setEditingId(null);
      onRefresh();
    } else {
      showNotification("Failed to save asset", "error");
    }
  };

  const handleEdit = (asset: Asset) => {
    setForm({ name: asset.name, value: asset.value, purchase_date: asset.purchase_date, depreciation_rate: asset.depreciation_rate });
    setEditingId(asset.id);
    setShowAdd(true);
  };

  const handleDelete = async (id: number) => {
    handleConfirm(
      "Delete Asset",
      "Are you sure you want to delete this asset?",
      async () => {
        const res = await fetch(`/api/assets/${id}?userId=${currentUser?.id}&userName=${currentUser?.username}`, { method: 'DELETE' });
        if (res.ok) {
          showNotification("Asset deleted successfully");
          onRefresh();
        } else {
          showNotification("Failed to delete asset", "error");
        }
      }
    );
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const parsedAssets = [];
        let errors = 0;

        for (const row of results.data as any[]) {
          const name = row['Name']?.trim();
          const value = parseFloat(row['Value']);
          const purchase_date = row['Purchase Date'];
          const depreciation_rate = parseFloat(row['Depreciation Rate']) || 10;

          if (!name || isNaN(value) || !purchase_date) {
            errors++;
            continue;
          }

          parsedAssets.push({
            company_id: currentCompany.id,
            name,
            value,
            purchase_date,
            depreciation_rate,
            userId: currentUser?.id,
            userName: currentUser?.username
          });
        }

        if (parsedAssets.length === 0) {
          showNotification("No valid assets found in CSV", "error");
          return;
        }

        try {
          const res = await fetch('/api/assets/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              assets: parsedAssets,
              userId: currentUser?.id,
              userName: currentUser?.username
            })
          });

          if (res.ok) {
            const data = await res.json();
            showNotification(`Successfully imported ${data.count} assets. ${errors > 0 ? `Skipped ${errors} invalid rows.` : ''}`);
            onRefresh();
          } else {
            showNotification("Failed to import assets", "error");
          }
        } catch (error) {
          showNotification("Error importing assets", "error");
        }
        
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
      error: (error) => {
        showNotification(`Error parsing CSV: ${error.message}`, "error");
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button onClick={() => setShowAdd(true)} className="flex items-center gap-2 dark:bg-white dark:text-zinc-900">
            <Plus size={16} />
            Add Asset
          </Button>
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleImportCSV}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Upload size={14} /> Import CSV
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportExcel} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Download size={14} /> Excel
          </Button>
          <Button variant="outline" onClick={exportPDF} className="flex items-center gap-2 dark:border-zinc-800 dark:text-zinc-300">
            <Download size={14} /> PDF
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card className="p-6 border-zinc-900/20 bg-zinc-50/50 dark:bg-zinc-900 dark:border-zinc-800">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <Input label="Asset Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Input label="Value" type="number" value={form.value} onChange={e => setForm({...form, value: Number(e.target.value)})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Input label="Purchase Date" type="date" value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Input label="Depreciation %" type="number" value={form.depreciation_rate} onChange={e => setForm({...form, depreciation_rate: Number(e.target.value)})} className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <div className="md:col-span-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); }} className="dark:border-zinc-700 dark:text-zinc-300">Cancel</Button>
              <Button type="submit" className="dark:bg-white dark:text-zinc-900">{editingId ? 'Update Asset' : 'Save Asset'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="dark:bg-zinc-900 dark:border-zinc-800">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Asset Name</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Purchase Date</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Depreciation</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Current Value</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {assets.map(a => (
              <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">{a.name}</td>
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{format(new Date(a.purchase_date), 'dd MMM yyyy')}</td>
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{a.depreciation_rate}% p.a.</td>
                <td className="px-6 py-4 text-sm font-mono text-right dark:text-zinc-300">{currentCompany?.currency_symbol || '₹'}{a.value.toLocaleString()}</td>
                <td className="px-6 py-4 text-right flex justify-end gap-2">
                  <button onClick={() => handleEdit(a)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <Edit size={16} />
                  </button>
                  <button onClick={() => handleDelete(a.id)} className="text-red-500 hover:text-red-700 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function UsersView({ allUsers, onRefresh, currentUser, showNotification, handleConfirm }: { allUsers: User[], onRefresh: () => void, currentUser: User | null, showNotification: (m: string, t?: 'success' | 'error') => void, handleConfirm: (t: string, m: string, c: () => void) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer', full_name: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingId ? `/api/users/${editingId}` : '/api/users';
    const method = editingId ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...form,
        userId: currentUser?.id,
        userName: currentUser?.username
      })
    });
    
    if (res.ok) {
      showNotification(editingId ? "User updated successfully" : "User created successfully");
      setForm({ username: '', password: '', role: 'viewer', full_name: '' });
      setShowAdd(false);
      setEditingId(null);
      onRefresh();
    } else {
      showNotification("Failed to save user", "error");
    }
  };

  const handleEdit = (u: User) => {
    setForm({ username: u.username, password: '', role: u.role, full_name: u.full_name });
    setEditingId(u.id);
    setShowAdd(true);
  };

  const handleDelete = async (id: number) => {
    handleConfirm(
      "Delete User",
      "Are you sure you want to delete this user?",
      async () => {
        const res = await fetch(`/api/users/${id}?userId=${currentUser?.id}&userName=${currentUser?.username}`, { method: 'DELETE' });
        if (res.ok) {
          showNotification("User deleted successfully");
          onRefresh();
        } else {
          showNotification("Failed to delete user", "error");
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button onClick={() => setShowAdd(true)} className="flex items-center gap-2 dark:bg-white dark:text-zinc-900">
          <Plus size={16} />
          Add User
        </Button>
      </div>

      {showAdd && (
        <Card className="p-6 border-zinc-900/20 bg-zinc-50/50 dark:bg-zinc-900 dark:border-zinc-800">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <Input label="Full Name" value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Input label="Username" value={form.username} onChange={e => setForm({...form, username: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Input label="Password" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required={!editingId} className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Select 
              label="Role" 
              value={form.role} 
              onChange={e => setForm({...form, role: e.target.value as any})}
              className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              options={[
                { value: 'admin', label: 'Administrator' },
                { value: 'manager', label: 'Manager' },
                { value: 'viewer', label: 'Viewer' },
              ]}
            />
            <div className="md:col-span-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); setForm({ username: '', password: '', role: 'viewer', full_name: '' }); }} className="dark:border-zinc-700 dark:text-zinc-300">Cancel</Button>
              <Button type="submit" className="dark:bg-white dark:text-zinc-900">{editingId ? 'Update User' : 'Create User'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="dark:bg-zinc-900 dark:border-zinc-800">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">User</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Username</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Role</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {allUsers.map(u => (
              <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-600 dark:text-zinc-400 font-bold text-xs">
                      {u.full_name[0]}
                    </div>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{u.full_name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-500 dark:text-zinc-400">{u.username}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    u.role === 'admin' ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  )}>
                    {u.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-right flex justify-end gap-2">
                  <button onClick={() => handleEdit(u)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <Edit size={16} />
                  </button>
                  <button onClick={() => handleDelete(u.id)} className="text-red-500 hover:text-red-700 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function TaxesView({ taxes, onRefresh, currentCompany, currentUser, showNotification, handleConfirm }: { taxes: Tax[], onRefresh: () => void, currentCompany: Company | null, currentUser: User | null, showNotification: (m: string, t?: 'success' | 'error') => void, handleConfirm: (t: string, m: string, c: () => void) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', rate: 0 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany) {
      showNotification("Please select a company first", "error");
      return;
    }
    
    const url = editingId ? `/api/taxes/${editingId}` : '/api/taxes';
    const method = editingId ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...form, 
        company_id: currentCompany.id,
        userId: currentUser?.id,
        userName: currentUser?.username
      })
    });
    
    if (res.ok) {
      showNotification(editingId ? "Tax updated successfully" : "Tax created successfully");
      setForm({ name: '', rate: 0 });
      setShowAdd(false);
      setEditingId(null);
      onRefresh();
    } else {
      showNotification("Failed to save tax", "error");
    }
  };

  const handleEdit = (t: Tax) => {
    setForm({ name: t.name, rate: t.rate });
    setEditingId(t.id);
    setShowAdd(true);
  };

  const handleDelete = async (id: number) => {
    handleConfirm(
      "Delete Tax",
      "Are you sure you want to delete this tax?",
      async () => {
        const res = await fetch(`/api/taxes/${id}?userId=${currentUser?.id}&userName=${currentUser?.username}`, { method: 'DELETE' });
        if (res.ok) {
          showNotification("Tax deleted successfully");
          onRefresh();
        } else {
          showNotification("Failed to delete tax", "error");
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button onClick={() => setShowAdd(true)} className="flex items-center gap-2 dark:bg-white dark:text-zinc-900">
          <Plus size={16} />
          Create Tax
        </Button>
      </div>

      {showAdd && (
        <Card className="p-6 border-zinc-900/20 bg-zinc-50/50 dark:bg-zinc-900 dark:border-zinc-800">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <Select 
              label="Quick Select Predefined Tax" 
              value=""
              onChange={e => {
                const val = e.target.value;
                if (val) {
                  const [name, rate] = val.split('|');
                  setForm({ ...form, name, rate: parseFloat(rate) });
                }
              }}
              className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              options={[
                { value: 'GST 0%|0', label: 'GST 0%' },
                { value: 'GST 5%|5', label: 'GST 5%' },
                { value: 'GST 12%|12', label: 'GST 12%' },
                { value: 'GST 18%|18', label: 'GST 18%' },
                { value: 'GST 28%|28', label: 'GST 28%' },
                { value: 'VAT 5%|5', label: 'VAT 5%' },
                { value: 'VAT 10%|10', label: 'VAT 10%' },
                { value: 'VAT 20%|20', label: 'VAT 20%' },
                { value: 'Sales Tax 6%|6', label: 'Sales Tax 6%' },
                { value: 'Sales Tax 7%|7', label: 'Sales Tax 7%' },
                { value: 'Sales Tax 8%|8', label: 'Sales Tax 8%' },
                { value: 'Exempt|0', label: 'Exempt (0%)' },
              ]}
            />
            <Input label="Tax Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <Input label="Rate (%)" type="number" step="0.01" value={form.rate} onChange={e => setForm({...form, rate: parseFloat(e.target.value)})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); setForm({ name: '', rate: 0 }); }} className="dark:border-zinc-700 dark:text-zinc-300">Cancel</Button>
              <Button type="submit" className="dark:bg-white dark:text-zinc-900">{editingId ? 'Update Tax' : 'Save Tax'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase">Name</th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-zinc-500 uppercase">Rate (%)</th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-zinc-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {taxes.map(t => (
              <tr key={t.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                <td className="px-6 py-4 text-sm font-medium text-zinc-900 dark:text-white">{t.name}</td>
                <td className="px-6 py-4 text-sm font-mono text-right dark:text-zinc-300">{t.rate.toFixed(2)}%</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(t)} className="text-zinc-400 hover:text-zinc-600"><Edit size={16} /></button>
                    <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function CompaniesView({ companies, onRefresh, currentUser, showNotification, handleConfirm }: { companies: Company[], onRefresh: () => void, currentUser: User | null, showNotification: (m: string, t?: 'success' | 'error') => void, handleConfirm: (t: string, m: string, c: () => void) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', address: '', gstin: '', currency_symbol: '₹', taxes: [] as {name: string, rate: number}[] });
  const [newTax, setNewTax] = useState({ name: '', rate: 0 });

  const handleAddTax = () => {
    if (newTax.name && newTax.rate >= 0) {
      setForm({ ...form, taxes: [...form.taxes, newTax] });
      setNewTax({ name: '', rate: 0 });
    }
  };

  const handleRemoveTax = (index: number) => {
    setForm({ ...form, taxes: form.taxes.filter((_, i) => i !== index) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingId ? `/api/companies/${editingId}` : '/api/companies';
    const method = editingId ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...form,
        userId: currentUser?.id,
        userName: currentUser?.username
      })
    });
    
    if (res.ok) {
      showNotification(editingId ? "Company updated successfully" : "Company created successfully");
      setForm({ name: '', address: '', gstin: '', currency_symbol: '₹', taxes: [] });
      setNewTax({ name: '', rate: 0 });
      setShowAdd(false);
      setEditingId(null);
      onRefresh();
    } else {
      showNotification("Failed to save company", "error");
    }
  };

  const handleEdit = (c: Company) => {
    setForm({ name: c.name, address: c.address, gstin: c.gstin, currency_symbol: c.currency_symbol, taxes: [] });
    setEditingId(c.id);
    setShowAdd(true);
  };

  const handleDelete = async (id: number) => {
    handleConfirm(
      "Delete Company",
      "Are you sure you want to delete this company? This will delete ALL associated data (ledgers, vouchers, assets).",
      async () => {
        const res = await fetch(`/api/companies/${id}?userId=${currentUser?.id}&userName=${currentUser?.username}`, { method: 'DELETE' });
        if (res.ok) {
          showNotification("Company deleted successfully");
          onRefresh();
        } else {
          showNotification("Failed to delete company", "error");
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button onClick={() => setShowAdd(true)} className="flex items-center gap-2 dark:bg-white dark:text-zinc-900">
          <Plus size={16} />
          Create Company
        </Button>
      </div>

      {showAdd && (
        <Card className="p-6 border-zinc-900/20 bg-zinc-50/50 dark:bg-zinc-900 dark:border-zinc-800">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
            <div className="md:col-span-4 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <Input label="Company Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
              <Input label="Address" value={form.address} onChange={e => setForm({...form, address: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
              <Input label="GSTIN" value={form.gstin} onChange={e => setForm({...form, gstin: e.target.value})} required className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
              <Select 
                label="Currency" 
                value={form.currency_symbol} 
                onChange={e => setForm({...form, currency_symbol: e.target.value})}
                required
                className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
                options={[
                  { value: '$', label: 'USD ($)' },
                  { value: '€', label: 'EUR (€)' },
                  { value: '£', label: 'GBP (£)' },
                  { value: '₹', label: 'INR (₹)' },
                  { value: 'A$', label: 'AUD (A$)' },
                  { value: 'C$', label: 'CAD (C$)' },
                  { value: '¥', label: 'JPY/CNY (¥)' },
                  { value: 'S$', label: 'SGD (S$)' },
                  { value: 'NZ$', label: 'NZD (NZ$)' },
                  { value: 'R', label: 'ZAR (R)' },
                  { value: 'د.إ', label: 'AED (د.إ)' },
                  { value: '﷼', label: 'SAR (﷼)' },
                  { value: 'CHF', label: 'CHF (CHF)' },
                  { value: 'HK$', label: 'HKD (HK$)' },
                  { value: 'kr', label: 'SEK/NOK/DKK (kr)' },
                  { value: '₩', label: 'KRW (₩)' },
                  { value: 'R$', label: 'BRL (R$)' },
                  { value: '₽', label: 'RUB (₽)' },
                  { value: '₺', label: 'TRY (₺)' },
                ]}
              />
            </div>

            {!editingId && (
              <div className="md:col-span-4 border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-2">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-white mb-4">Initial Tax Rates (Optional)</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-4">
                  <Select 
                    label="Quick Select Predefined Tax" 
                    value=""
                    onChange={e => {
                      const val = e.target.value;
                      if (val) {
                        const [name, rate] = val.split('|');
                        setNewTax({ name, rate: parseFloat(rate) });
                      }
                    }}
                    className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
                    options={[
                      { value: 'GST 0%|0', label: 'GST 0%' },
                      { value: 'GST 5%|5', label: 'GST 5%' },
                      { value: 'GST 12%|12', label: 'GST 12%' },
                      { value: 'GST 18%|18', label: 'GST 18%' },
                      { value: 'GST 28%|28', label: 'GST 28%' },
                      { value: 'VAT 5%|5', label: 'VAT 5%' },
                      { value: 'VAT 10%|10', label: 'VAT 10%' },
                      { value: 'VAT 20%|20', label: 'VAT 20%' },
                      { value: 'Sales Tax 6%|6', label: 'Sales Tax 6%' },
                      { value: 'Sales Tax 7%|7', label: 'Sales Tax 7%' },
                      { value: 'Sales Tax 8%|8', label: 'Sales Tax 8%' },
                      { value: 'Exempt|0', label: 'Exempt (0%)' },
                    ]}
                  />
                  <Input label="Manual Tax Name" value={newTax.name} onChange={e => setNewTax({...newTax, name: e.target.value})} className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
                  <Input label="Rate (%)" type="number" step="0.01" value={newTax.rate} onChange={e => setNewTax({...newTax, rate: parseFloat(e.target.value)})} className="dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" />
                  <Button type="button" variant="outline" onClick={handleAddTax} className="dark:border-zinc-700 dark:text-zinc-300">Add Tax</Button>
                </div>
                
                {form.taxes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.taxes.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-full text-sm">
                        <span className="font-medium dark:text-zinc-900 dark:text-zinc-100">{t.name}</span>
                        <span className="text-zinc-500 dark:text-zinc-400">({t.rate}%)</span>
                        <button type="button" onClick={() => handleRemoveTax(i)} className="text-red-500 hover:text-red-700 ml-1">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="md:col-span-4 flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); setForm({ name: '', address: '', gstin: '', currency_symbol: '₹', taxes: [] }); setNewTax({ name: '', rate: 0 }); }} className="dark:border-zinc-700 dark:text-zinc-300">Cancel</Button>
              <Button type="submit" className="dark:bg-white dark:text-zinc-900">{editingId ? 'Update Company' : 'Save Company'}</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {companies.map(c => (
          <Card key={c.id} className="p-6 dark:bg-zinc-900 dark:border-zinc-800 relative group">
            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => handleEdit(c)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <Edit size={16} />
              </button>
              <button 
                onClick={() => handleDelete(c.id)}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-900 dark:text-zinc-100">
                <Building2 size={24} />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white">{c.name}</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">ID: {c.id}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">GSTIN</span>
                <span className="font-medium dark:text-zinc-200">{c.gstin}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">Address</span>
                <span className="font-medium truncate max-w-[150px] dark:text-zinc-200">{c.address}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
