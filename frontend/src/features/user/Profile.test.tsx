import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { Profile } from './Profile';

function renderProfile() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><Profile /></Wrap>);
}

const CAR = {
  id: 'veh-1',
  vehicleNumber: 'KA011234',
  displayNumber: 'KA 01 1234',
  ownerName: 'Aditi Rao',
  ownerEmail: 'aditi@assent.example',
  contactNumber: '9000000003',
  vehicleType: 'CAR',
  makeModel: 'Honda City',
  colour: 'Silver',
  companyId: 'co-1',
  companyName: 'Assent',
};

const oneCar = () => server.use(http.get('*/api/v1/me/vehicles', () => HttpResponse.json({ success: true, data: [CAR] })));

/** The row for a saved car — the edit form replaces it in place, so scope queries to it. */
const carRow = async (label: string) => {
  const heading = await screen.findByText(label);
  return heading.closest('li') as HTMLElement;
};

describe('Profile — saved cars', () => {
  it('offers edit alongside remove for each saved car', async () => {
    oneCar();
    renderProfile();

    const row = await carRow('KA 01 1234');
    expect(within(row).getByRole('button', { name: /edit KA 01 1234/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /remove KA 01 1234/i })).toBeInTheDocument();
  });

  it('opens an editor seeded with the saved values', async () => {
    oneCar();
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: /edit KA 01 1234/i }));

    // Seeded from the row, not blank — the user is correcting a car, not re-entering it.
    const row = screen.getByDisplayValue('KA 01 1234').closest('li') as HTMLElement;
    expect(within(row).getByDisplayValue('Honda City')).toBeInTheDocument();
    expect(within(row).getByDisplayValue('Silver')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /save car/i })).toBeInTheDocument();
  });

  it('PATCHes only the car being edited and closes the editor', async () => {
    oneCar();
    let patched: { url: string; body: unknown } | null = null;
    server.use(
      http.patch('*/api/v1/me/vehicles/:id', async ({ request, params }) => {
        patched = { url: String(params.id), body: await request.json() };
        return HttpResponse.json({ success: true, data: { ...CAR, makeModel: 'Hyundai i20' } });
      }),
    );
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: /edit KA 01 1234/i }));
    const model = screen.getByDisplayValue('Honda City');
    await userEvent.clear(model);
    await userEvent.type(model, 'Hyundai i20');
    await userEvent.click(screen.getByRole('button', { name: /save car/i }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.url).toBe('veh-1');
    expect(patched!.body).toMatchObject({ vehicleNumber: 'KA 01 1234', makeModel: 'Hyundai i20' });
    // Editor closes on success, so the row is back to its read-only form.
    await waitFor(() => expect(screen.queryByRole('button', { name: /save car/i })).not.toBeInTheDocument());
  });

  it('sends null rather than an empty string when a field is cleared', async () => {
    oneCar();
    let body: Record<string, unknown> | null = null;
    server.use(
      http.patch('*/api/v1/me/vehicles/:id', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { ...CAR, colour: null } });
      }),
    );
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: /edit KA 01 1234/i }));
    await userEvent.clear(screen.getByDisplayValue('Silver'));
    await userEvent.click(screen.getByRole('button', { name: /save car/i }));

    // `colour: ''` would fail the API's min-length rule; null is how the contract models "clear it".
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.colour).toBeNull();
  });

  it('surfaces a plate conflict and keeps the editor open so the number can be corrected', async () => {
    oneCar();
    server.use(
      http.patch('*/api/v1/me/vehicles/:id', () =>
        HttpResponse.json(
          { success: false, error: { code: 'CONFLICT', message: 'This car number is already registered in the vehicle registry' } },
          { status: 409 },
        ),
      ),
    );
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: /edit KA 01 1234/i }));
    const plate = screen.getByDisplayValue('KA 01 1234');
    await userEvent.clear(plate);
    await userEvent.type(plate, 'KA 05 9999');
    await userEvent.click(screen.getByRole('button', { name: /save car/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i);
    // Losing the typed number on a 409 would make the user start over.
    expect(screen.getByDisplayValue('KA 05 9999')).toBeInTheDocument();
  });

  it('abandons an edit on cancel without calling the API', async () => {
    oneCar();
    let called = false;
    server.use(
      http.patch('*/api/v1/me/vehicles/:id', () => {
        called = true;
        return HttpResponse.json({ success: true, data: CAR });
      }),
    );
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: /edit KA 01 1234/i }));
    await userEvent.clear(screen.getByDisplayValue('Honda City'));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(called).toBe(false);
    expect(screen.queryByRole('button', { name: /save car/i })).not.toBeInTheDocument();
    expect(await carRow('KA 01 1234')).toBeInTheDocument();
  });

  it('will not save an edit that blanks the car number', async () => {
    oneCar();
    renderProfile();

    await userEvent.click(await screen.findByRole('button', { name: /edit KA 01 1234/i }));
    await userEvent.clear(screen.getByDisplayValue('KA 01 1234'));
    expect(screen.getByRole('button', { name: /save car/i })).toBeDisabled();
  });
});
