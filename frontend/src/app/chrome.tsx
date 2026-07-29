import { useTheme } from '../lib/theme';

export function Logo() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-bold text-white">
      P
    </span>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      className="grid h-8 w-8 place-items-center rounded-control border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Minimal header for public pages (login / register / 404). */
export function PublicHeader() {
  return (
    <header className="border-b border-border bg-surface/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-base font-semibold tracking-tight">Parking Reservation</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
