import { Outlet } from 'react-router-dom';

/** Super-admin area layout. Keeps the "Super Admin" heading; content routes through the Outlet. */
export function AdminShell() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
      <Outlet />
    </div>
  );
}
