import type { ReactNode } from 'react';
import { useTheme } from '../lib/theme';

/**
 * The persistent layout shell: top bar + content region. Role-specific shells
 * (/admin, /company, /app) render through this in P5-03. For P5-01 the content
 * region also doubles as a small token showcase so the palette is verifiable by eye.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <TopBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <TokenShowcase />
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-base font-semibold tracking-tight">Parking Reservation</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            className="flex h-8 items-center gap-2 rounded-control border border-border bg-surface px-2.5 text-sm text-text-muted transition-colors hover:bg-surface-2"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
              A
            </span>
            <span className="hidden sm:inline">Account</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function TokenShowcase() {
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Frontend scaffold is live</h1>
        <p className="max-w-2xl text-text-muted">
          Vite + React + TypeScript + Tailwind with the design-token system wired up. Toggle the
          theme in the top bar to see light/dark. The pieces below are a preview of the palette the
          rest of Phase 5 is built on.
        </p>
      </section>

      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Actions</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Primary action
          </button>
          <button
            type="button"
            className="rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2"
          >
            Secondary
          </button>
          <button
            type="button"
            className="rounded-control px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-subtle"
          >
            Ghost
          </button>
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Status colours
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone="success">Allocated</Badge>
          <Badge tone="warning">Waitlisted</Badge>
          <Badge tone="danger">Rejected</Badge>
          <Badge tone="primary">Pending</Badge>
        </div>
      </section>

      <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            Allocation preview
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            The winning row uses the warm accent — reserved for exactly this kind of highlight.
          </p>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-6 py-3 font-medium">Rank</th>
              <th className="px-6 py-3 font-medium">User</th>
              <th className="px-6 py-3 font-medium">Distance</th>
              <th className="px-6 py-3 font-medium">Score</th>
              <th className="px-6 py-3 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border bg-accent-subtle">
              <td className="px-6 py-3 font-semibold text-accent">1</td>
              <td className="px-6 py-3">priya@acme.test</td>
              <td className="px-6 py-3 tabular-nums">2.4 km</td>
              <td className="px-6 py-3 font-medium tabular-nums">0.91</td>
              <td className="px-6 py-3">
                <Badge tone="success">Allocated</Badge>
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="px-6 py-3">2</td>
              <td className="px-6 py-3">sam@acme.test</td>
              <td className="px-6 py-3 tabular-nums">5.1 km</td>
              <td className="px-6 py-3 font-medium tabular-nums">0.78</td>
              <td className="px-6 py-3">
                <Badge tone="success">Allocated</Badge>
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="px-6 py-3">3</td>
              <td className="px-6 py-3">lee@globex.test</td>
              <td className="px-6 py-3 tabular-nums">8.7 km</td>
              <td className="px-6 py-3 font-medium tabular-nums">0.55</td>
              <td className="px-6 py-3">
                <Badge tone="warning">Waitlisted</Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'primary';

const toneClasses: Record<Tone, string> = {
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  primary: 'bg-primary-subtle text-primary',
};

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

function ThemeToggle() {
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

function Logo() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-bold text-white">
      P
    </span>
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
