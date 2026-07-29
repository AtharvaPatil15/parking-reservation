import { ThemeProvider } from '../lib/theme';
import { AppShell } from './AppShell';

/**
 * Root of the frontend. For P5-01 it wires the theme provider around the layout
 * shell. The router + role guards (P5-03) and query/API providers (P5-04) slot in
 * here in their own tasks.
 */
export function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
