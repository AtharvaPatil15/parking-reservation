import { useState } from 'react';
import { useTheme } from '../lib/theme';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
  SuccessState,
  Table,
  useToast,
  type Column,
} from '../components';

/**
 * The persistent layout shell: top bar + content region. Role-specific shells
 * (/admin, /company, /app) render through this in P5-03. For now the content
 * region is a gallery of the P5-02 component library so it's verifiable by eye.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <TopBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <ComponentGallery />
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

interface AllocationRow {
  rank: number;
  user: string;
  distanceKm: number;
  score: number;
  outcome: 'allocated' | 'waitlisted';
}

const allocationRows: AllocationRow[] = [
  { rank: 1, user: 'priya@acme.test', distanceKm: 2.4, score: 0.91, outcome: 'allocated' },
  { rank: 2, user: 'sam@acme.test', distanceKm: 5.1, score: 0.78, outcome: 'allocated' },
  { rank: 3, user: 'lee@globex.test', distanceKm: 8.7, score: 0.55, outcome: 'waitlisted' },
];

const allocationColumns: Column<AllocationRow>[] = [
  { key: 'rank', header: 'Rank', render: (r) => <span className={r.rank === 1 ? 'font-semibold text-accent' : ''}>{r.rank}</span> },
  { key: 'user', header: 'User', render: (r) => r.user },
  { key: 'distance', header: 'Distance', align: 'right', className: 'tabular-nums', render: (r) => `${r.distanceKm.toFixed(1)} km` },
  { key: 'score', header: 'Score', align: 'right', className: 'font-medium tabular-nums', render: (r) => r.score.toFixed(2) },
  {
    key: 'outcome',
    header: 'Outcome',
    render: (r) =>
      r.outcome === 'allocated' ? <Badge tone="success">Allocated</Badge> : <Badge tone="warning">Waitlisted</Badge>,
  },
];

function ComponentGallery() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Component library</h1>
        <p className="max-w-2xl text-text-muted">
          P5-02 base components on the P5-01 token system. Toggle the theme in the top bar — every
          component tracks light/dark automatically.
        </p>
      </section>

      <Card title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
        </div>
      </Card>

      <Card title="Form controls">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" placeholder="you@company.com" hint="We never share this." />
          <Input label="Password" type="password" error="Password is required." defaultValue="" />
          <Select
            label="Vehicle"
            placeholder="Select a vehicle"
            options={[
              { value: 'car', label: 'Car' },
              { value: 'bike', label: 'Motorbike' },
              { value: 'ev', label: 'EV' },
            ]}
          />
          <Input label="Carpool people" type="number" min={1} max={4} defaultValue={1} />
        </div>
      </Card>

      <Card title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Allocated</Badge>
          <Badge tone="warning">Waitlisted</Badge>
          <Badge tone="danger">Rejected</Badge>
          <Badge tone="primary">Pending</Badge>
          <Badge tone="accent">Winner</Badge>
          <Badge>Neutral</Badge>
        </div>
      </Card>

      <Card title="Overlays & notifications">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Button variant="secondary" onClick={() => toast('Booking submitted.', { tone: 'success' })}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast('Cutoff has passed.', { tone: 'warning' })}>
            Warning toast
          </Button>
          <Button variant="secondary" onClick={() => toast('Could not reach the server.', { tone: 'danger' })}>
            Error toast
          </Button>
        </div>
      </Card>

      <Card
        title="Allocation preview"
        description="Generic Table; the winning row uses the warm accent — reserved for exactly this highlight."
        padded={false}
      >
        <Table
          columns={allocationColumns}
          rows={allocationRows}
          rowKey={(r) => r.user}
          rowClassName={(r) => (r.rank === 1 ? 'bg-accent-subtle' : undefined)}
        />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Loading state" padded={false}>
          <LoadingState label="Running allocation…" />
        </Card>
        <Card title="Empty state" padded={false}>
          <EmptyState title="No bookings yet" description="Bookings you create will appear here." />
        </Card>
        <Card title="Error state" padded={false}>
          <ErrorState action={<Button size="sm" variant="secondary">Retry</Button>} />
        </Card>
        <Card title="Success state" padded={false}>
          <SuccessState title="Slot allocated" description="You're parked in Bay 12 on Fri." />
        </Card>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Release your slot?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setModalOpen(false);
                toast('Slot released.', { tone: 'success' });
              }}
            >
              Release
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          Releasing frees your bay for the waitlist. This can't be undone for today.
        </p>
      </Modal>
    </div>
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
