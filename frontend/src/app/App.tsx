import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/theme';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components';
import { queryClient } from '../api/queryClient';
import { AppRouter } from './router';

/**
 * Root of the frontend. Wires the app-wide providers (theme, query client, auth, toasts)
 * and the router.
 */
export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
