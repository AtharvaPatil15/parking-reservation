import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { AuthProvider, type AuthUser } from '../../lib/auth';
import { BookingList } from './BookingList';

/**
 * The last-minute handover, from the admin's side of the screen.
 *
 * The mock roster is dated 2026-08-03, so "today" is stubbed rather than faked with timers — the
 * component only asks `todayIstIso()` whether the booking date has passed, and fake timers would drag
 * userEvent's own scheduling into it for no benefit. `clock.today` is mutable so one test can put the
 * booking in the past.
 */
const clock = vi.hoisted(() => ({ today: '2026-08-01' }));
vi.mock('../../lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dates')>()),
  todayIstIso: () => clock.today,
}));

const companyAdmin: AuthUser = {
  id: 'ca1', fullName: 'Cara Company', role: 'COMPANY_ADMIN', companyId: 'mock-co', companyName: 'Mock Co',
};
const plainUser: AuthUser = {
  id: 'u-priya', fullName: 'Priya Rao', role: 'USER', companyId: 'mock-co', companyName: 'Mock Co',
};

function renderRoster(user: AuthUser = companyAdmin) {
  clock.today = '2026-08-01';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthProvider initialSession={{ accessToken: 't', user }}>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><BookingList scope="company" /></Wrap>);
}

/**
 * Open the details popup for a booking, by the employee currently shown against it. Scoped to the row:
 * every row has its own Details button, so an unscoped query is ambiguous.
 */
async function openDetails(employeeName: string) {
  const row = (await screen.findByText(employeeName)).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /details/i }));
  return row;
}

describe('handing an allocated slot to a colleague', () => {
  it('offers the handover on an allocated, still-upcoming booking', async () => {
    renderRoster();
    await openDetails('Priya Rao');
    expect(screen.getByRole('button', { name: /hand to a colleague/i })).toBeInTheDocument();
  });

  it('moves the booking to the colleague and records who it came from', async () => {
    renderRoster();
    await openDetails('Priya Rao');
    await userEvent.click(screen.getByRole('button', { name: /hand to a colleague/i }));

    // The current holder is not offered as the taker — only the other active colleague.
    const picker = screen.getByLabelText(/taking the slot/i);
    expect(screen.queryByRole('option', { name: /priya rao/i })).not.toBeInTheDocument();
    await userEvent.selectOptions(picker, 'u-sam');

    await userEvent.type(screen.getByLabelText(/why/i), 'swapped on #parking');
    await userEvent.click(screen.getByRole('button', { name: /hand over the slot/i }));

    expect(await screen.findByText(/now belongs to Sam Lee/i)).toBeInTheDocument();
    // Same bay, new owner — and the roster still explains where the slot came from.
    expect(await screen.findByText(/taken over from Priya Rao/i)).toBeInTheDocument();
    expect(screen.getByText('swapped on #parking', { exact: false })).toBeInTheDocument();
  });

  it('does not offer the handover on a booking with no slot', async () => {
    renderRoster();
    // Lee Chen is WAITLISTED — there is no bay to hand over.
    const row = (await screen.findByText('Lee Chen')).closest('tr')!;
    await userEvent.click(row.querySelector('button')!);
    expect(screen.queryByRole('button', { name: /hand to a colleague/i })).not.toBeInTheDocument();
  });

  it('does not offer the handover once the date has passed', async () => {
    renderRoster();
    await openDetails('Priya Rao');
    expect(screen.getByRole('button', { name: /hand to a colleague/i })).toBeInTheDocument();

    // Re-render with the booking date behind us: a spent day has nothing left to give away.
    clock.today = '2026-08-04';
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    await openDetails('Priya Rao');
    expect(screen.queryByRole('button', { name: /hand to a colleague/i })).not.toBeInTheDocument();
  });

  it('is not offered to a plain user', async () => {
    renderRoster(plainUser);
    await openDetails('Priya Rao');
    expect(screen.queryByRole('button', { name: /hand to a colleague/i })).not.toBeInTheDocument();
  });
});
