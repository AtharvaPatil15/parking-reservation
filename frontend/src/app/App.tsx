import { ThemeProvider } from '../lib/theme';
import { ToastProvider } from '../components';
import { AppShell } from './AppShell';

/**
 * Root of the frontend. Wires the app-wide providers (theme, toasts) around the
 * layout shell. The router + role guards (P5-03) and query/API providers (P5-04)
 * slot in here in their own tasks.
 */
export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </ThemeProvider>
  );
}
