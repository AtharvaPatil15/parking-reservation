import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { AuthProvider } from '../../lib/auth';
import { GateConsole } from './GateConsole';

/**
 * Phase 7 security console. The behaviour that matters most is D16: the gate must never be blocked —
 * an unknown car, or a known one with no booking, still records an entry (with a warning).
 */

function renderConsole() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/security']}>{children}</MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><GateConsole /></Wrap>);
}

const lookup = (data: Record<string, unknown>) =>
  server.use(http.get('*/api/v1/vehicles/lookup', () => HttpResponse.json({ success: true, data })));

const KNOWN_VEHICLE = {
  id: 'veh-1',
  vehicleNumber: 'MH12AB1234',
  displayNumber: 'MH 12 AB 1234',
  ownerName: 'Aditi Rao',
  ownerEmail: 'aditi',
  contactNumber: '9822001101',
  vehicleType: 'CAR',
  makeModel: 'Hyundai i20',
  colour: 'White',
  companyId: 'mock-co',
  companyName: 'Mock Co',
};

describe('GateConsole', () => {
  it('offers exactly two actions', async () => {
    renderConsole();
    expect(await screen.findByRole('button', { name: /^check in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^check out$/i })).toBeInTheDocument();
  });

  /**
   * The guard's landing page has to answer "is there room?" before it answers anything else — and since a
   * walk-in registration now waits on an admin, what is left is what tells them whether calling that admin
   * is even worth it.
   *
   * Two numbers per row, and they must sum to that company's slots. Rendering the full payload — quota,
   * blocked, requests, allocated, inside — read as broken arithmetic, because reconciling it requires
   * knowing that blocked slots are excluded and that a reserved slot is taken before its owner arrives.
   */
  it('shows slots filled and slots remaining per company, and they add up', async () => {
    server.use(
      http.get('*/api/v1/gate/capacity', () =>
        HttpResponse.json({
          success: true,
          data: {
            bookingDate: '2026-08-05',
            rows: [
              { companyId: 'c1', companyName: 'Assent', slots: 12, blocked: 2, requests: 14, allocated: 10, free: 0, inside: 7 },
              { companyId: 'c2', companyName: 'Acme', slots: 8, blocked: 0, requests: 5, allocated: 5, free: 3, inside: 2 },
            ],
            building: {
              totalSlots: 20, allottedSlots: 20, blocked: 2, requests: 19,
              allocated: 15, free: 3, inside: 9, insideUnattributed: 0,
            },
          },
        }),
      ),
    );
    renderConsole();

    // Assent: 12 slots, 2 blocked, 10 given out. All 12 accounted for, nothing left.
    const assent = (await screen.findByText('Assent')).closest('tr')!;
    expect(within(assent).getByText('12')).toBeInTheDocument();
    // Said as "Full" rather than a bare 0, which reads as missing data.
    expect(within(assent).getByText('Full')).toBeInTheDocument();

    // Acme: 8 slots, none blocked, 5 given out → 5 filled, 3 left. `inside: 2` must NOT move these:
    // remaining is quota-relative, so a reserved slot stays taken until its owner arrives.
    const acme = screen.getByText('Acme').closest('tr')!;
    expect(within(acme).getByText('5')).toBeInTheDocument();
    expect(within(acme).getByText('3')).toBeInTheDocument();

    // The columns the panel deliberately drops. Each one individually reconciles only if you know the
    // rules; together they made the panel look like it could not add up.
    for (const header of [/blocked/i, /booked/i, /given a slot/i, /inside/i]) {
      expect(screen.queryByRole('columnheader', { name: header })).not.toBeInTheDocument();
    }

    // The building line is assembled from several spans, so assert on its text content rather than
    // hunting for a phrase that no single node owns. It totals the ALLOTTED slots (20), because slots no
    // company holds are not the guard's to give — 17 filled + 3 remaining.
    const buildingLine = screen.getByText('Building').parentElement!;
    expect(buildingLine.textContent).toMatch(/17 filled/);
    expect(buildingLine.textContent).toMatch(/3 remaining/);
  });

  it('makes registering a new car a full-size action', async () => {
    renderConsole();
    // A ghost link was too small a target for a tablet at a barrier. Named for what it does, not for who
    // it is for — the guard is looking for the verb.
    expect(await screen.findByRole('button', { name: /^register a new car$/i })).toBeInTheDocument();
  });

  it('lists the cars it has registered that are still waiting on an admin', async () => {
    server.use(
      http.get('*/api/v1/vehicles/registrations', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: 'vreg-1', vehicleNumber: 'MH14XY9911', displayNumber: 'MH 14 XY 9911',
              ownerName: 'Nikhil Rao', ownerEmail: null, contactNumber: '9876500011',
              companyId: 'c1', companyName: 'Assent', vehicleType: 'CAR', makeModel: null,
              colour: null, notes: null, status: 'PENDING', requestedById: 'sec-1',
              decidedById: null, decidedAt: null, decisionNote: null, vehicleId: null,
              createdAt: '2026-08-05T05:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 5, total: 1 },
        }),
      ),
    );
    renderConsole();

    expect(await screen.findByText(/waiting for approval \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/MH 14 XY 9911/)).toBeInTheDocument();
  });

  /**
   * The one case the gate refuses a car — and the reason has to be on screen next to the disabled button,
   * naming who to call, not delivered as a server error after a pointless round-trip.
   */
  it('will not check in a car whose registration is still pending', async () => {
    lookup({
      vehicleNumber: 'MH14XY9911',
      known: false,
      vehicle: null,
      bookingDate: '2026-08-05',
      hasBooking: false,
      booking: null,
      openVisit: null,
      pendingRegistration: {
        id: 'vreg-1',
        ownerName: 'Nikhil Rao',
        companyId: 'c1',
        companyName: 'Assent',
        requestedAt: '2026-08-05T05:00:00.000Z',
      },
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH14XY9911');

    expect(await screen.findByText(/waiting for assent to approve this car/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /waiting for approval/i })).toBeDisabled();
    // The "you can still let them in" reassurance must not appear — it would contradict the hold.
    expect(screen.queryByText(/you can still let them in/i)).not.toBeInTheDocument();
  });

  it('offers to register an unknown car, and keeps the plate already typed', async () => {
    lookup({
      vehicleNumber: 'MH99NEW0001',
      known: false,
      vehicle: null,
      bookingDate: '2026-08-05',
      hasBooking: false,
      booking: null,
      openVisit: null,
      pendingRegistration: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH99NEW0001');

    await userEvent.click(await screen.findByRole('button', { name: /register this car/i }));

    // Re-keying a plate at a barrier is exactly the sort of friction that gets a feature ignored.
    expect(await screen.findByRole('heading', { name: /register a car/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/car number/i)).toHaveValue('MH99NEW0001');
  });

  it('fills in the driver from the car number and shows the allocated slot', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234',
      known: true,
      vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03',
      hasBooking: true,
      booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: 'B1-03' },
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');

    // The guard never types a name — it is resolved from the registry.
    expect(await screen.findByText('Aditi Rao')).toBeInTheDocument();
    expect(screen.getByText('Booked today')).toBeInTheDocument();
    expect(screen.getByText('B1-03')).toBeInTheDocument();
  });

  it('normalizes sloppy spacing before looking the car up', async () => {
    let asked = '';
    server.use(
      http.get('*/api/v1/vehicles/lookup', ({ request }) => {
        asked = new URL(request.url).searchParams.get('number') ?? '';
        return HttpResponse.json({
          success: true,
          data: {
            vehicleNumber: 'MH12AB1234', known: true, vehicle: KNOWN_VEHICLE,
            bookingDate: '2026-08-03', hasBooking: true,
            booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: null },
            openVisit: null,
          },
        });
      }),
    );
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'mh-12 ab.1234');
    // The raw string goes to the server, which normalizes it; the resolved plate comes back canonical.
    await waitFor(() => expect(asked).toBe('mh-12 ab.1234'));
    expect(await screen.findByText('Aditi Rao')).toBeInTheDocument();
  });

  it('warns but still allows a check-in with no booking (D16)', async () => {
    lookup({
      vehicleNumber: 'MH12CD5678',
      known: true,
      vehicle: { ...KNOWN_VEHICLE, id: 'veh-2', vehicleNumber: 'MH12CD5678', displayNumber: 'MH 12 CD 5678', ownerName: 'Rahul Mehta' },
      bookingDate: '2026-08-03',
      hasBooking: false,
      booking: null,
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12CD5678');

    expect(await screen.findByText('No booking today')).toBeInTheDocument();
    expect(screen.getByText(/you can still let them in/i)).toBeInTheDocument();
    // Crucially, the confirm button stays enabled — the barrier is never blocked.
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
  });

  it('records an unregistered plate rather than refusing it', async () => {
    lookup({
      vehicleNumber: 'KA05ZZ9999',
      known: false,
      vehicle: null,
      bookingDate: '2026-08-03',
      hasBooking: false,
      booking: null,
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'KA05ZZ9999');

    expect(await screen.findByText(/not in the vehicle registry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
  });

  /**
   * `known` and `hasBooking` are independent, and the console used to conflate them: everything useful
   * — driver, "Booked today", the allocated slot — rendered only for a registry hit, so a plate typed
   * straight into the booking form arrived looking like a stranger while the API was already returning
   * its booking and slot. The guard saw "Not in the vehicle registry" and nothing else.
   */
  it('shows the driver and slot for an unregistered plate that still has a booking', async () => {
    lookup({
      vehicleNumber: 'KA05ZZ9999',
      known: false,
      vehicle: null,
      bookingDate: '2026-08-03',
      hasBooking: true,
      booking: {
        id: 'bk-9',
        status: 'ALLOCATED',
        bookingType: 'PRIMARY',
        allocatedSlotNumber: 'B1-07',
        employeeName: 'Rahul Mehta',
        contactNumber: '9822001102',
        companyId: 'mock-co',
        companyName: 'Mock Co',
        userId: 'usr-9',
      },
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'KA05ZZ9999');

    expect(await screen.findByText('Booked today')).toBeInTheDocument();
    // Scoped to the drawer: the slots panel behind it also names every company, so an unscoped query for
    // 'Mock Co' matches the capacity row too.
    const panel = screen.getByText('Booked today').closest('div.space-y-3') as HTMLElement;
    expect(within(panel).getByText('Rahul Mehta')).toBeInTheDocument();
    expect(within(panel).getByText('Mock Co')).toBeInTheDocument();
    expect(within(panel).getByText('B1-07')).toBeInTheDocument();
    // The registry note stays, but as a footnote that explains itself — not as the whole answer.
    expect(screen.getByText(/matched by the number on the booking/i)).toBeInTheDocument();
    // And no scary "no booking today" warning, because there IS one.
    expect(screen.queryByText(/you can still let them in/i)).not.toBeInTheDocument();
  });

  /**
   * The two queries behind the field answer different questions: the typeahead matches a substring, the
   * lookup matches the plate exactly. Typing a fragment of a registered plate therefore produces a
   * suggestion AND `known: false` — and the drawer used to render both, so it said "registered to Assent
   * user 1" directly above "Not in the vehicle registry", with Confirm still live.
   */
  describe('a half-typed plate', () => {
    const FULL = {
      id: 'veh-7',
      vehicleNumber: 'MH15LM7777',
      displayNumber: 'MH15LM7777',
      ownerName: 'Assent user 1',
      ownerEmail: 'user1',
      contactNumber: '9822001177',
      vehicleType: 'CAR',
      makeModel: null,
      colour: null,
      companyId: 'mock-co',
      companyName: 'Assent',
    };

    /** Substring search finds the car; exact lookup only resolves the complete plate. */
    function registryWith(vehicle: typeof FULL) {
      server.use(
        http.get('*/api/v1/vehicles', ({ request }) => {
          const term = (new URL(request.url).searchParams.get('search') ?? '').toUpperCase();
          const hit = term && vehicle.vehicleNumber.includes(term.replace(/[^A-Z0-9]/g, ''));
          return HttpResponse.json({ success: true, data: hit ? [vehicle] : [] });
        }),
        http.get('*/api/v1/vehicles/lookup', ({ request }) => {
          const plate = (new URL(request.url).searchParams.get('number') ?? '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
          const exact = plate === vehicle.vehicleNumber;
          return HttpResponse.json({
            success: true,
            data: {
              vehicleNumber: plate,
              known: exact,
              vehicle: exact ? vehicle : null,
              bookingDate: '2026-08-03',
              hasBooking: false,
              booking: null,
              openVisit: null,
            },
          });
        }),
      );
    }

    it('prompts instead of contradicting itself', async () => {
      registryWith(FULL);
      renderConsole();
      await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
      await userEvent.type(screen.getByLabelText(/car number/i), '7777');

      // The suggestion proves the car IS registered…
      expect(await screen.findByText('MH15LM7777')).toBeInTheDocument();
      // …so the drawer must not simultaneously declare it unregistered.
      expect(screen.queryByText(/not in the vehicle registry/i)).not.toBeInTheDocument();
      expect(screen.queryByText('No booking today')).not.toBeInTheDocument();
      expect(screen.queryByText(/you can still let them in/i)).not.toBeInTheDocument();

      // A prompt, and an honest statement of what confirming would do.
      expect(screen.getByText(/is not a full car number/i)).toBeInTheDocument();
      expect(screen.getByText(/record the visit against/i)).toBeInTheDocument();
      // Still submittable — the barrier is never blocked (D16).
      expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
    });

    it('resolves to the real verdict once the suggestion is picked', async () => {
      registryWith(FULL);
      renderConsole();
      await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
      await userEvent.type(screen.getByLabelText(/car number/i), '7777');

      await userEvent.click(await screen.findByRole('button', { name: /MH15LM7777/i }));

      expect(await screen.findByText('Assent user 1')).toBeInTheDocument();
      expect(screen.queryByText(/is not a full car number/i)).not.toBeInTheDocument();
    });

    it('still gives a plain verdict for a plate that is genuinely unknown', async () => {
      // No suggestions at all — nothing in the registry contains it, so the input is not a fragment of
      // anything and "not in the registry" is the correct, useful answer.
      registryWith(FULL);
      renderConsole();
      await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
      await userEvent.type(screen.getByLabelText(/car number/i), 'ZZ99QQ0000');

      expect(await screen.findByText(/not in the vehicle registry/i)).toBeInTheDocument();
      expect(screen.queryByText(/is not a full car number/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
    });
  });

  it('flags a car that is already inside', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234',
      known: true,
      vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03',
      hasBooking: true,
      booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: 'B1-03' },
      openVisit: { id: 'gate-1', checkInAt: '2026-08-03T03:30:00.000Z' },
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');
    expect(await screen.findByText(/already checked in/i)).toBeInTheDocument();
  });

  it('keeps the confirm button disabled until the number is long enough', async () => {
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12');
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
  });

  it('submits a check-in and closes the drawer', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234', known: true, vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03', hasBooking: true,
      booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: 'B1-03' },
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');
    await userEvent.click(screen.getByRole('button', { name: /confirm check in/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a check-out refusal for a car that is not inside', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234', known: true, vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03', hasBooking: false, booking: null, openVisit: null,
    });
    server.use(
      http.post('*/api/v1/gate/check-out', () =>
        HttpResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'MH12AB1234 is not currently checked in' } },
          { status: 404 },
        ),
      ),
    );
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check out$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');
    await userEvent.click(screen.getByRole('button', { name: /confirm check out/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not currently checked in/i);
  });

  it('lists today’s visits', async () => {
    server.use(
      http.get('*/api/v1/gate/events', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: 'gate-1', vehicleNumber: 'MH12AB1234', displayNumber: 'MH 12 AB 1234',
              ownerName: 'Aditi Rao', companyId: 'mock-co', companyName: 'Mock Co',
              bookingDate: '2026-08-03', bookingRequestId: 'bk-1', hadBooking: true,
              status: 'CHECKED_IN', checkInAt: '2026-08-03T03:30:00.000Z', checkOutAt: null, notes: null,
            },
            {
              id: 'gate-2', vehicleNumber: 'KA05ZZ9999', displayNumber: 'KA05ZZ9999',
              ownerName: null, companyId: null, companyName: null,
              bookingDate: '2026-08-03', bookingRequestId: null, hadBooking: false,
              status: 'CHECKED_OUT', checkInAt: '2026-08-03T04:00:00.000Z',
              checkOutAt: '2026-08-03T06:00:00.000Z', notes: null,
            },
          ],
          meta: { page: 1, pageSize: 20, total: 2 },
        }),
      ),
    );
    renderConsole();
    expect(await screen.findByText('MH 12 AB 1234')).toBeInTheDocument();
    expect(screen.getByText('Unregistered vehicle')).toBeInTheDocument();
    expect(screen.getByText(/1 inside/)).toBeInTheDocument();
    expect(screen.getByText(/1 without a booking/)).toBeInTheDocument();
  });
});
