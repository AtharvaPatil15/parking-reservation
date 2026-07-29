import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '../lib/theme';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components';
import { AppRouter } from './router';

/**
 * Root of the frontend. Wires the app-wide providers (theme, auth, toasts) and the
 * router. The query/API providers (P5-04) slot in around AppRouter in their own task.
 */
export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
