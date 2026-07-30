import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { roleHome } from '../lib/roles';
import { RequireRole, RequireAuth } from '../lib/guards';
import { AppShell } from './AppShell';
import { NotFound } from './NotFound';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { AdminShell } from '../features/superadmin/AdminShell';
import { AllocationRun } from '../features/superadmin/AllocationRun';
import { SuperAdminDashboard } from '../features/superadmin/SuperAdminDashboard';
import { ConfigTimings } from '../features/superadmin/ConfigTimings';
import { Companies } from '../features/superadmin/Companies';
import { AdminApprovals } from '../features/superadmin/AdminApprovals';
import { Slots } from '../features/superadmin/Slots';
import { CompanyShell } from '../features/companyadmin/CompanyShell';
import { CompanyDashboard } from '../features/companyadmin/CompanyDashboard';
import { Allocations } from '../features/companyadmin/Allocations';
import { Approvals } from '../features/companyadmin/Approvals';
import { Blocks } from '../features/companyadmin/Blocks';
import { UserShell } from '../features/user/UserShell';
import { UserDashboard } from '../features/user/UserDashboard';
import { History } from '../features/user/History';
import { BookingForm } from '../features/user/BookingForm';
import { BookingStatus } from '../features/user/BookingStatus';

/** `/` → the signed-in user's home, or /login when anonymous. */
function RootRedirect() {
  const { isAuthenticated, user } = useAuth();
  return <Navigate to={isAuthenticated && user ? roleHome(user.role) : '/login'} replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireRole role="SUPER_ADMIN" />}>
        <Route element={<AppShell />}>
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<AllocationRun />} />
            <Route path="dashboard" element={<SuperAdminDashboard />} />
            <Route path="config" element={<ConfigTimings />} />
            <Route path="companies" element={<Companies />} />
            <Route path="admin-requests" element={<AdminApprovals />} />
            <Route path="slots" element={<Slots />} />
          </Route>
        </Route>
      </Route>

      <Route element={<RequireRole role="COMPANY_ADMIN" />}>
        <Route element={<AppShell />}>
          <Route path="/company" element={<CompanyShell />}>
            <Route index element={<CompanyDashboard />} />
            <Route path="allocations" element={<Allocations />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="blocks" element={<Blocks />} />
          </Route>
        </Route>
      </Route>

      <Route element={<RequireRole role="USER" />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<UserShell />}>
            <Route index element={<UserDashboard />} />
          </Route>
        </Route>
      </Route>

      {/* Booking is a cross-role capability — USER, COMPANY_ADMIN and SUPER_ADMIN can all book,
          view a booking, and see their own history. */}
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/book" element={<BookingForm />} />
          <Route path="/booking/:id" element={<BookingStatus />} />
          <Route path="/my-bookings" element={<History />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
