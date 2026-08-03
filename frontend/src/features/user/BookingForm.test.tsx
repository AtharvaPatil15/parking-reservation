import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { BookingForm } from './BookingForm';

/**
 * Phase 7 booking form: the date is chosen from the open window (each row showing that day's slot
 * grid) instead of typed, and submission is gated on the selected day still having a free slot.
 */

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/book']}>
        <Routes>
          <Route path="/book" element={children} />
          <Route path="/booking/:id" element={<div>Status page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Wrap><BookingForm /></Wrap>);
}

/** A fixed availability payload, so tests do not depend on the real calendar. */
function availability(overrides: {
  days?: Array<{
    date: string;
    quota?: number;
    blocked?: number;
    taken?: number;
    mine?: boolean;
    requestable?: boolean;
    reason?: string | null;
    message?: string | null;
  }>;
} = {}) {
  const days = (overrides.days ?? [{ date: '2099-01-05' }, { date: '2099-01-06' }]).map((d) => {
    const quota = d.quota ?? 12;
    const blocked = d.blocked ?? 0;
    const taken = d.taken ?? 0;
    const boxes = Array.from({ length: quota }, (_, i) => ({
      index: i + 1,
      state:
        d.mine && i === 0
          ? 'MINE'
          : i < taken
            ? 'TAKEN'
            : i < taken + blocked
              ? 'BLOCKED'
              : 'AVAILABLE',
    }));
    return {
      date: d.date,
      quota,
      blocked,
      taken,
      available: Math.max(0, quota - blocked - taken),
      mine: d.mine ?? false,
      requestable: d.requestable ?? true,
      reason: d.reason ?? null,
      message: d.message ?? null,
      boxes,
    };
  });
  return {
    success: true,
    data: {
      window: {
        nextRunAt: '2099-01-03T14:30:00.000Z',
        nextRunCountdownSeconds: 90_000,
        runDay: 'SUNDAY',
        runTime: '20:00',
        windowWeeks: 2,
        approvalLeadDays: 3,
        earliestDate: days[0]?.date ?? '2099-01-05',
        latestDate: days.at(-1)?.date ?? '2099-01-06',
        requestableDates: days.filter((d) => d.requestable).map((d) => d.date),
      },
      days,
    },
  };
}

const useAvailability = (payload: ReturnType<typeof availability>) =>
  server.use(http.get('*/api/v1/availability', () => HttpResponse.json(payload)));

describe('BookingForm', () => {
  it('renders the window summary, the profile distance and the slot grid', async () => {
    useAvailability(availability({ days: [{ date: '2099-01-05', taken: 3, blocked: 2 }] }));
    renderForm();

    expect(await screen.findByRole('heading', { name: /book a parking slot/i })).toBeInTheDocument();
    expect(screen.getByText(/8\.5 km/)).toBeInTheDocument();
    // The next run is announced so the user knows when they will hear back.
    expect(screen.getByText(/results published/i)).toBeInTheDocument();
    expect(screen.getByText(/booking is open for the next 2 weeks/i)).toBeInTheDocument();
    // 12 boxes for a quota of 12, with 3 taken + 2 blocked → 7 free.
    expect(await screen.findByText(/7 of 12 slots free/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText('12 parking slots').length).toBeGreaterThan(0);
  });

  it('preselects the first bookable date', async () => {
    useAvailability(
      availability({
        days: [
          { date: '2099-01-05', requestable: false, reason: 'FULL', taken: 12, message: 'All slots for this date are taken — pick another date.' },
          { date: '2099-01-06' },
        ],
      }),
    );
    renderForm();
    // 5 Jan is full, so the form should land on 6 Jan rather than a date that cannot be submitted.
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    expect(await screen.findByText(/12 of 12 slots free/i)).toBeInTheDocument();
  });

  it('blocks submission for a full date and says why', async () => {
    useAvailability(
      availability({
        days: [
          {
            date: '2099-01-05',
            taken: 12,
            requestable: false,
            reason: 'FULL',
            message: 'All slots for this date are taken — pick another date.',
          },
        ],
      }),
    );
    renderForm();

    // With no bookable date at all, the button must not offer to submit.
    expect(await screen.findByRole('button', { name: /pick an available date/i })).toBeDisabled();
    // The full date is not clickable either.
    const row = screen.getByRole('button', { name: /Mon, 5 Jan/i });
    expect(row).toBeDisabled();
    expect(within(row).getByText(/all slots for this date are taken/i)).toBeInTheDocument();
  });

  it('lets the user switch to another date from the window list', async () => {
    useAvailability(availability({ days: [{ date: '2099-01-05', taken: 4 }, { date: '2099-01-06', taken: 1 }] }));
    renderForm();

    await screen.findByText(/8 of 12 slots free/i); // 5 Jan preselected (12 − 4)
    await userEvent.click(screen.getByRole('button', { name: /Tue, 6 Jan/i }));
    expect(await screen.findByText(/11 of 12 slots free/i)).toBeInTheDocument(); // 6 Jan (12 − 1)
  });

  it('submits a valid booking and shows when results land', async () => {
    useAvailability(availability());
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/request submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/results are published/i)).toBeInTheDocument();
  });

  it('offers saved profile cars while still allowing manual car entry', async () => {
    useAvailability(availability());
    const view = renderForm();
    const carNumber = await screen.findByLabelText(/car number/i);

    expect(carNumber).toHaveAttribute('list', 'profile-cars');
    const option = view.container.querySelector('datalist#profile-cars option[value="KA011234"]');
    expect(option).toHaveTextContent(/KA 01 1234 - Honda City - Silver/i);

    await userEvent.type(carNumber, 'MH12ZZ9999');
    expect(carNumber).toHaveValue('MH12ZZ9999');
  });

  it('maps CAPACITY_FULL to a "grid refreshed" message', async () => {
    useAvailability(availability());
    server.use(
      http.post('*/api/v1/bookings', () =>
        HttpResponse.json(
          { success: false, error: { code: 'CAPACITY_FULL', message: 'All 12 slot(s) for 2099-01-05 are already taken.' } },
          { status: 409 },
        ),
      ),
    );
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already taken.*grid below has been refreshed/i);
  });

  it('maps a plain 409 to a duplicate-request message', async () => {
    useAvailability(availability());
    server.use(
      http.post('*/api/v1/bookings', () =>
        HttpResponse.json({ success: false, error: { code: 'CONFLICT', message: 'dup' } }, { status: 409 }),
      ),
    );
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already have a request/i);
  });

  it('surfaces a WINDOW_CLOSED refusal from the server', async () => {
    useAvailability(availability());
    server.use(
      http.post('*/api/v1/bookings', () =>
        HttpResponse.json(
          { success: false, error: { code: 'WINDOW_CLOSED', message: '2099-01-05 is no longer open — allocation has run.' } },
          { status: 422 },
        ),
      ),
    );
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer open/i);
  });

  it('falls back to the server message for an unmapped error', async () => {
    useAvailability(availability());
    server.use(
      http.post('*/api/v1/bookings', () =>
        HttpResponse.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Some other problem' } }, { status: 400 }),
      ),
    );
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/some other problem/i);
  });

  it('shows an error state when availability cannot be loaded', async () => {
    server.use(
      http.get('*/api/v1/availability', () =>
        HttpResponse.json({ success: false, error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderForm();
    expect(await screen.findByText(/could not load slot availability/i)).toBeInTheDocument();
  });

  it('gates "Add member" on carpool people count', async () => {
    useAvailability(availability());
    renderForm();
    const addMember = await screen.findByRole('button', { name: /add member/i });
    expect(addMember).toBeDisabled(); // carpoolPeople=1 → 0 >= 1-1

    const carpoolPeopleInput = screen.getByLabelText(/carpool people/i);
    await userEvent.clear(carpoolPeopleInput);
    await userEvent.type(carpoolPeopleInput, '2');
    expect(addMember).toBeEnabled(); // 0 >= 2-1 is false

    await userEvent.click(addMember);
    expect(addMember).toBeDisabled(); // 1 >= 2-1 is true
  });

  it('validates member email format and blocks submission', async () => {
    useAvailability(availability());
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());

    const carpoolPeopleInput = screen.getByLabelText(/carpool people/i);
    await userEvent.clear(carpoolPeopleInput);
    await userEvent.type(carpoolPeopleInput, '2');

    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    await userEvent.type(screen.getByLabelText(/member 1 name/i), 'Sam');
    await userEvent.type(screen.getByLabelText(/member 1 email/i), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(screen.queryByText(/request submitted/i)).not.toBeInTheDocument();
  });

  async function addMemberBooking(name: string, email: string) {
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    const people = screen.getByLabelText(/carpool people/i);
    await userEvent.clear(people);
    await userEvent.type(people, '2');
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    await userEvent.type(screen.getByLabelText(/member 1 name/i), name);
    await userEvent.type(screen.getByLabelText(/member 1 email/i), email);
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
  }

  it('rejects a carpool member who is not a registered user', async () => {
    useAvailability(availability());
    renderForm();
    await addMemberBooking('Ghost', 'ghost@nobody.test');
    expect(await screen.findByText(/no registered user has this email/i)).toBeInTheDocument();
    expect(screen.queryByText(/request submitted/i)).not.toBeInTheDocument();
  });

  it('accepts a registered member from another company (cross-company carpool)', async () => {
    useAvailability(availability());
    renderForm();
    await addMemberBooking('Ivy', 'ivy@acme.test'); // seeded under co-acme, not the booker's mock-co
    expect(await screen.findByText(/request submitted/i)).toBeInTheDocument();
  });
});
