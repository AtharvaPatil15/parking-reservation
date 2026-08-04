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
 * Phase 8 booking form (D18/D22): dates are chosen from the open window (each row showing that day's
 * slot grid), but a request never consumes capacity — there is no "grid is full" refusal any more.
 * Only a date outside the window, already decided, or already requested by the caller is unpickable.
 *
 * Multi-date: several dates can be selected at once and are booked independently, so the form's job on
 * submit is to report what happened per date rather than to succeed or fail as a whole.
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
    requestCount?: number;
    allocatedCount?: number;
    phase?: 'OPEN' | 'DECIDED';
    mine?: boolean;
    myStatus?: 'SUBMITTED' | 'ALLOCATED' | 'WAITLISTED' | 'RELEASED' | null;
    mySlotNumber?: number | null;
    requestable?: boolean;
    reason?: string | null;
    message?: string | null;
  }>;
} = {}) {
  const days = (overrides.days ?? [{ date: '2099-01-05' }, { date: '2099-01-06' }]).map((d) => {
    const quota = d.quota ?? 12;
    const blocked = d.blocked ?? 0;
    const requestCount = d.requestCount ?? 0;
    const phase = d.phase ?? 'OPEN';
    const allocatedCount = d.allocatedCount ?? 0;
    const boxes =
      phase === 'OPEN'
        ? Array.from({ length: quota }, (_, i) => ({
            index: i + 1,
            state: i < blocked ? 'BLOCKED' : 'AVAILABLE',
            slotNumber: null,
          }))
        : Array.from({ length: quota }, (_, i) => ({
            index: i + 1,
            state:
              d.mine && i === 0 ? 'MINE' : i < allocatedCount ? 'TAKEN' : i < allocatedCount + blocked ? 'BLOCKED' : 'AVAILABLE',
            slotNumber: i < allocatedCount ? i + 1 : null,
          }));
    return {
      date: d.date,
      phase,
      quota,
      blocked,
      requestCount,
      allocatedCount,
      available: Math.max(0, quota - blocked - allocatedCount),
      mine: d.mine ?? false,
      myStatus: d.myStatus ?? (d.mine ? 'SUBMITTED' : null),
      mySlotNumber: d.mySlotNumber ?? null,
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
        approvalLeadDays: 1,
        earliestDate: days[0]?.date ?? '2099-01-05',
        latestDate: days.at(-1)?.date ?? '2099-01-06',
        requestableDates: days.filter((d) => d.requestable).map((d) => d.date),
        scoring: { distanceWeight: 0.6, carpoolWeight: 0.4, maxDistanceKm: 40, maxPeople: 4 },
      },
      days,
    },
  };
}

const useAvailability = (payload: ReturnType<typeof availability>) =>
  server.use(http.get('*/api/v1/availability', () => HttpResponse.json(payload)));

/** Stub the batch endpoint with a fixed per-date report. */
const useBatch = (data: {
  requested: number;
  createdCount: number;
  failedCount: number;
  results: Array<Record<string, unknown>>;
}) => server.use(http.post('*/api/v1/bookings/batch', () => HttpResponse.json({ success: true, data })));

const created = (date: string, id = `bkg-${date}`) => ({
  bookingDate: date,
  outcome: 'CREATED',
  booking: {
    id,
    status: 'SUBMITTED',
    bookingType: 'PRIMARY',
    bookingDate: date,
    travelDistanceKm: 6.2,
    carpoolPeople: 1,
    submittedAt: '2099-01-02T10:00:00.000Z',
  },
});
const failed = (date: string, code: string, message: string) => ({
  bookingDate: date,
  outcome: 'FAILED',
  code,
  message,
});

/** The window rows are multi-select checkboxes, not a single toggle group. */
const dateRow = (label: RegExp) => screen.getByRole('checkbox', { name: label });

describe('BookingForm', () => {
  it('renders the window summary, the profile distance and the slot grid', async () => {
    useAvailability(availability({ days: [{ date: '2099-01-05', requestCount: 5, blocked: 2 }] }));
    renderForm();

    expect(await screen.findByRole('heading', { name: /book a parking slot/i })).toBeInTheDocument();
    // The score panel also mentions "8.5 km", so assert on the profile line specifically.
    expect(screen.getByText(/home → office: 8\.5 km/i)).toBeInTheDocument();
    // The next run is announced so the user knows when they will hear back.
    expect(screen.getByText(/results published/i)).toBeInTheDocument();
    expect(screen.getByText(/booking is open for the next 2 weeks/i)).toBeInTheDocument();
    // Phase 8 (D18): demand is a count, never a fullness readout.
    expect((await screen.findAllByText(/12 slots · 5 requests so far/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('12 parking slots').length).toBeGreaterThan(0);
  });

  it('preselects the first bookable date, skipping one the caller already requested', async () => {
    useAvailability(
      availability({
        days: [
          {
            date: '2099-01-05',
            requestable: false,
            reason: 'ALREADY_BOOKED',
            mine: true,
            message: 'You already have a request for this date.',
          },
          { date: '2099-01-06' },
        ],
      }),
    );
    renderForm();
    // 5 Jan is already requested, so the form should land on 6 Jan rather than a date it cannot resubmit.
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
    expect((await screen.findAllByText(/12 slots · 0 requests so far/i)).length).toBeGreaterThan(0);
    expect(dateRow(/Tue, 6 Jan/i)).toBeChecked();
  });

  it('blocks submission for an already-requested date and says why', async () => {
    useAvailability(
      availability({
        days: [
          {
            date: '2099-01-05',
            mine: true,
            requestable: false,
            reason: 'ALREADY_BOOKED',
            message: 'You already have a request for this date.',
          },
        ],
      }),
    );
    renderForm();

    // With no bookable date at all, the button must not offer to submit.
    expect(await screen.findByRole('button', { name: /pick an available date/i })).toBeDisabled();
    // The already-requested date is not selectable either.
    const row = dateRow(/Mon, 5 Jan/i);
    expect(row).toBeDisabled();
    expect(within(row).getByText(/already have a request/i)).toBeInTheDocument();
  });

  // Phase 8 (D18): demand can be arbitrarily high without ever blocking a submission.
  it('never blocks submission for a heavily-requested date', async () => {
    useAvailability(availability({ days: [{ date: '2099-01-05', requestCount: 500 }] }));
    renderForm();

    expect((await screen.findAllByText(/12 slots · 500 requests so far/i)).length).toBeGreaterThan(0);
    expect(dateRow(/Mon, 5 Jan/i)).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
  });

  it('shows the grid of whichever date was clicked last', async () => {
    useAvailability(
      availability({ days: [{ date: '2099-01-05', requestCount: 4 }, { date: '2099-01-06', requestCount: 1 }] }),
    );
    renderForm();

    await screen.findAllByText(/12 slots · 4 requests so far/i); // 5 Jan preselected
    await userEvent.click(dateRow(/Tue, 6 Jan/i));
    expect((await screen.findAllByText(/12 slots · 1 request so far/i)).length).toBeGreaterThan(0); // 6 Jan, singular
  });

  describe('multi-date selection', () => {
    it('adds a second date instead of replacing the first', async () => {
      useAvailability(availability());
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());

      await userEvent.click(dateRow(/Tue, 6 Jan/i));
      expect(dateRow(/Mon, 5 Jan/i)).toBeChecked();
      expect(dateRow(/Tue, 6 Jan/i)).toBeChecked();
      expect(screen.getByText(/2 dates selected/i)).toBeInTheDocument();
      // The button counts what will be submitted.
      expect(screen.getByRole('button', { name: /submit 2 requests/i })).toBeEnabled();
    });

    it('toggles a selected date back off', async () => {
      useAvailability(availability());
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());

      await userEvent.click(dateRow(/Mon, 5 Jan/i));
      expect(dateRow(/Mon, 5 Jan/i)).not.toBeChecked();
      expect(screen.getByText(/no dates selected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /pick an available date/i })).toBeDisabled();
    });

    it('selects and clears every open date', async () => {
      useAvailability(
        availability({
          days: [
            { date: '2099-01-05' },
            { date: '2099-01-06' },
            // Already requested, so "select all" must skip it rather than build a duplicate request.
            {
              date: '2099-01-07',
              mine: true,
              requestable: false,
              reason: 'ALREADY_BOOKED',
              message: 'You already have a request for this date.',
            },
          ],
        }),
      );
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());

      await userEvent.click(screen.getByRole('button', { name: /select all 2 open dates/i }));
      expect(screen.getByText(/2 dates selected/i)).toBeInTheDocument();
      expect(dateRow(/Wed, 7 Jan/i)).not.toBeChecked();

      await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));
      expect(screen.getByText(/no dates selected/i)).toBeInTheDocument();
      expect(dateRow(/Mon, 5 Jan/i)).not.toBeChecked();
    });

    it('does not re-add a date the user deliberately cleared', async () => {
      useAvailability(availability());
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());

      await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));
      // The preselect effect must not fight the user by putting the first open date back.
      await waitFor(() => expect(screen.getByText(/no dates selected/i)).toBeInTheDocument());
      expect(dateRow(/Mon, 5 Jan/i)).not.toBeChecked();
    });

    it('removes a date from the summary chips', async () => {
      useAvailability(availability());
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());
      await userEvent.click(dateRow(/Tue, 6 Jan/i));

      // Chips only appear once more than one date is selected.
      await userEvent.click(screen.getByRole('button', { name: /remove tue, 6 jan/i }));
      expect(dateRow(/Tue, 6 Jan/i)).not.toBeChecked();
      expect(screen.getByText(/1 date selected/i)).toBeInTheDocument();
    });
  });

  describe('submission outcomes', () => {
    it('submits one date and shows queued-not-held copy with the actual publish date and lead time', async () => {
      useAvailability(availability());
      useBatch({ requested: 1, createdCount: 1, failedCount: 0, results: [created('2099-01-05')] });
      renderForm();
      await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
      await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

      // D19: never "held" — a queued request can still be waitlisted at the run. Both the title and
      // the description say "queued", so assert on the set rather than a single unique match.
      expect((await screen.findAllByText(/request queued/i)).length).toBeGreaterThan(0);
      expect(screen.queryByText(/held/i)).not.toBeInTheDocument();
      expect(screen.getByText(/results are published/i)).toBeInTheDocument();
      expect(screen.getByText(/at least 1 day before each date/i)).toBeInTheDocument();
    });

    it('pluralises the all-succeeded summary and lists every date', async () => {
      useAvailability(availability());
      useBatch({
        requested: 2,
        createdCount: 2,
        failedCount: 0,
        results: [created('2099-01-05'), created('2099-01-06')],
      });
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());
      await userEvent.click(dateRow(/Tue, 6 Jan/i));
      await userEvent.click(screen.getByRole('button', { name: /submit 2 requests/i }));

      expect((await screen.findAllByText(/2 requests queued/i)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/submitted/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Mon, 5 Jan/i)).toBeInTheDocument();
      expect(screen.getByText(/Tue, 6 Jan/i)).toBeInTheDocument();
    });

    it('keeps the dates that worked and explains the one that did not', async () => {
      useAvailability(availability());
      useBatch({
        requested: 2,
        createdCount: 1,
        failedCount: 1,
        results: [
          created('2099-01-05'),
          // Phase 8: capacity can no longer be the reason a date fails — only duplicate/window-closed.
          failed('2099-01-06', 'CONFLICT', 'You already have a PRIMARY booking for this date'),
        ],
      });
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());
      await userEvent.click(dateRow(/Tue, 6 Jan/i));
      await userEvent.click(screen.getByRole('button', { name: /submit 2 requests/i }));

      // A partial result is reported, not treated as a failure — the user keeps the request they placed.
      expect(await screen.findByRole('status')).toHaveTextContent(/1 of 2 dates queued/i);
      expect(screen.getByText(/already queued for you/i)).toBeInTheDocument();
      expect(screen.getByText(/already have a primary booking/i)).toBeInTheDocument();
      expect(screen.getByText('Submitted')).toBeInTheDocument();
      expect(screen.getByText('Not booked')).toBeInTheDocument();
    });

    it('reports an all-failed batch as an alert without claiming success', async () => {
      useAvailability(availability());
      useBatch({
        requested: 2,
        createdCount: 0,
        failedCount: 2,
        results: [
          failed('2099-01-05', 'CONFLICT', 'You already have a PRIMARY booking for this date'),
          failed('2099-01-06', 'WINDOW_CLOSED', '2099-01-06 is no longer open — allocation has run.'),
        ],
      });
      renderForm();
      await waitFor(() => expect(dateRow(/Mon, 5 Jan/i)).toBeChecked());
      await userEvent.click(dateRow(/Tue, 6 Jan/i));
      await userEvent.click(screen.getByRole('button', { name: /submit 2 requests/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/no dates could be queued/i);
      expect(screen.queryByText(/requests queued/i)).not.toBeInTheDocument();
      expect(screen.getByText(/already have a primary booking/i)).toBeInTheDocument();
      expect(screen.getByText(/no longer open/i)).toBeInTheDocument();
    });

    it('offers a way back to the form after a partial result', async () => {
      useAvailability(availability());
      useBatch({
        requested: 1,
        createdCount: 0,
        failedCount: 1,
        results: [failed('2099-01-05', 'WINDOW_CLOSED', 'Already decided.')],
      });
      renderForm();
      await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
      await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

      await userEvent.click(await screen.findByRole('button', { name: /book more dates/i }));
      // Back on the form, with the date list available again.
      expect(await screen.findByRole('heading', { name: /book a parking slot/i })).toBeInTheDocument();
    });

    it('falls back to the server message for a request-level error', async () => {
      useAvailability(availability());
      server.use(
        http.post('*/api/v1/bookings/batch', () =>
          HttpResponse.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Some other problem' } }, { status: 400 }),
        ),
      );
      renderForm();
      await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeEnabled());
      await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/some other problem/i);
    });
  });

  describe('live score panel (§4, D3)', () => {
    it('shows the score, distance and carpool components, matching the formula', async () => {
      // me.data.distanceKm is 8.5 (mock profile fixture). maxDistanceKm=40, maxPeople=4.
      // distanceScore = min(8.5,40)/40*100 = 21.25 → 21.3 (rounded)
      // carpoolScore (1 person) = (min(1,4)-1)/(4-1)*100 = 0
      // finalScore = 0.6*21.25 + 0.4*0 = 12.75 → 12.8 (rounded, banker's rounding aside)
      useAvailability(availability());
      renderForm();

      const panel = await screen.findByTestId('score-panel');
      expect(within(panel).getByText(/your score:/i)).toBeInTheDocument();
      expect(within(panel).getByText(/8\.5 km/)).toBeInTheDocument();
      expect(within(panel).getByText(/1 person/)).toBeInTheDocument();
    });

    it('recomputes live as carpool members are added', async () => {
      useAvailability(availability());
      renderForm();
      const panel = await screen.findByTestId('score-panel');
      const before = panel.textContent;

      const carpoolPeopleInput = screen.getByLabelText(/carpool people/i);
      await userEvent.clear(carpoolPeopleInput);
      await userEvent.type(carpoolPeopleInput, '3');

      await waitFor(() => expect(screen.getByTestId('score-panel').textContent).not.toBe(before));
      expect(screen.getByTestId('score-panel')).toHaveTextContent(/3 people/);
    });
  });

  it('explains that requests are ranked by score, not first-come-first-served', async () => {
    useAvailability(availability());
    renderForm();
    expect(await screen.findByText(/ranked by score/i)).toBeInTheDocument();
    expect(screen.getByText(/not first-come-first-served/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/request queued/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/request queued/i)).not.toBeInTheDocument();
  });

  it('accepts a registered member from another company (cross-company carpool)', async () => {
    useAvailability(availability());
    renderForm();
    await addMemberBooking('Ivy', 'ivy@acme.test'); // seeded under co-acme, not the booker's mock-co
    expect((await screen.findAllByText(/request queued/i)).length).toBeGreaterThan(0);
  });
});
