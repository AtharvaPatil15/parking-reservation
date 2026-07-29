import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { roleHome } from '../lib/roles';
import { RequireRole } from '../lib/guards';
import { AppShell } from './AppShell';
import { NotFound } from './NotFound';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { AdminShell } from '../features/superadmin/AdminShell';
import { CompanyShell } from '../features/companyadmin/CompanyShell';
import { UserShell } from '../features/user/UserShell';
import { ComponentGallery } from '../features/dev/ComponentGallery';
import { BookingForm } from '../features/user/BookingForm';

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
          <Route path="/admin/*" element={<AdminShell />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="COMPANY_ADMIN" />}>
        <Route element={<AppShell />}>
          <Route path="/company/*" element={<CompanyShell />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="USER" />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<UserShell />}>
            <Route index element={<ComponentGallery />} />
            <Route path="book" element={<BookingForm />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
