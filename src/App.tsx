import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './store';
import { LoginScreen } from './components/LoginScreen';
import { MustChangePassword } from './components/MustChangePassword';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { DashboardView } from './views/Dashboard';
import { VouchersView } from './views/Vouchers';
import { LedgersView } from './views/Ledgers';
import { AssetsView } from './views/Assets';
import { TaxesView } from './views/Taxes';
import { PurchaseOrdersView } from './views/PurchaseOrders';
import { GRNsView } from './views/GRNs';
import { CompaniesView } from './views/Companies';
import { UsersView } from './views/Users';
import { AuditLogView } from './views/AuditLog';
import { TransferView } from './views/Transfer';

function Gate() {
  const { user, booting } = useApp();

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Spinner label="Restoring your session…" />
      </div>
    );
  }
  if (!user) return <LoginScreen />;
  // A flagged account can do nothing else until it sets a real password, so
  // this gate sits above the router rather than inside each protected view.
  if (user.must_change_password) return <MustChangePassword />;

  return (
    <Router>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardView />} />
          <Route path="vouchers" element={<VouchersView />} />
          <Route path="ledgers" element={<LedgersView />} />
          <Route path="assets" element={<AssetsView />} />
          <Route path="taxes" element={<TaxesView />} />
          <Route path="purchase-orders" element={<PurchaseOrdersView />} />
          <Route path="grns" element={<GRNsView />} />
          <Route path="companies" element={<CompaniesView />} />
          <Route path="users" element={<AdminOnly><UsersView /></AdminOnly>} />
          <Route path="audit" element={<AdminOnly><AuditLogView /></AdminOnly>} />
          <Route path="transfers" element={<AdminOnly><TransferView /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}

/**
 * The server rejects these routes for non-admins anyway. This is purely so a
 * viewer who types the URL sees their dashboard instead of an error toast.
 */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useApp();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
