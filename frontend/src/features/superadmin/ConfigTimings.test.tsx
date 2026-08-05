import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { ConfigTimings } from './ConfigTimings';

function renderConfig() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><ConfigTimings /></Wrap>);
}

describe('ConfigTimings', () => {
  it('renders allocation schedule and weight fields from the config', async () => {
    renderConfig();
    expect(await screen.findByLabelText(/automatic allocation run interval/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weekly allocation run day/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Monday' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Friday' })).toBeInTheDocument();
    expect(screen.getByLabelText(/weekly allocation run time/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight of the distance sub-score/i)).toBeInTheDocument();
    expect(screen.getByText(/next 5 runs/i)).toBeInTheDocument();
  });

  it('does not expose the raw config keys (function names) to the user', async () => {
    renderConfig();
    await screen.findByLabelText(/automatic allocation run interval/i);
    expect(screen.queryByText('booking.allocationRunFrequency')).not.toBeInTheDocument();
    expect(screen.queryByText('allocation.distanceWeight')).not.toBeInTheDocument();
    expect(screen.queryByText('carpool.maxPeople')).not.toBeInTheDocument();
  });

  it('does not show the old booking-window time card', async () => {
    renderConfig();
    await screen.findByLabelText(/automatic allocation run interval/i);
    expect(screen.queryByText(/^booking windows$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/primary window closes/i)).not.toBeInTheDocument();
  });

  it('flags an out-of-range weight inline', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '2' } });
    expect(await screen.findByText(/between 0 and 1/i)).toBeInTheDocument();
  });

  /**
   * The form must show the SERVER's values, not just render the right set of inputs.
   *
   * The bug this pins: `DEFAULT_RUN_ENTRIES` seeded the draft with a placeholder WEEKLY/SUNDAY before
   * `config.data` arrived. When the real config disagreed, the "don't clobber unsaved edits" guard read
   * that placeholder as a user edit and refused to re-seed — so every field fell back to `''` and the
   * page rendered blank against a perfectly good API response.
   *
   * The default mock happens to use SUNDAY too, which is why this went unnoticed: the placeholder
   * agreed with the server and the guard never tripped. A non-SUNDAY run day is the reproduction.
   */
  it('populates every field from the server config, even when the run day is not the fallback', async () => {
    server.use(
      http.get('*/api/v1/config', () =>
        HttpResponse.json({
          success: true,
          data: [
            { key: 'booking.allocationRunFrequency', value: 'WEEKLY', valueType: 'STRING', description: 'Automatic allocation run interval' },
            { key: 'booking.allocationRunDay', value: 'TUESDAY', valueType: 'STRING', description: 'Weekly allocation run day' },
            { key: 'booking.allocationRunTime', value: '20:56', valueType: 'TIME', description: 'Weekly allocation run time' },
            { key: 'allocation.carpoolWeight', value: '0.40', valueType: 'NUMBER', description: 'Weight of carpool score' },
            { key: 'allocation.distanceWeight', value: '0.60', valueType: 'NUMBER', description: 'Weight of distance score' },
            { key: 'allocation.maxDistanceKm', value: '40', valueType: 'NUMBER', description: 'Distance cap for full distance score' },
            { key: 'carpool.maxPeople', value: '4', valueType: 'NUMBER', description: 'Max people per car incl. driver' },
          ],
        }),
      ),
    );
    renderConfig();

    expect(await screen.findByLabelText(/weekly allocation run day/i)).toHaveValue('TUESDAY');
    expect(screen.getByLabelText(/weekly allocation run time/i)).toHaveValue('20:56');
    expect(screen.getByLabelText(/weight of carpool score/i)).toHaveValue(0.4);
    expect(screen.getByLabelText(/weight of distance score/i)).toHaveValue(0.6);
    expect(screen.getByLabelText(/distance cap/i)).toHaveValue(40);
    expect(screen.getByLabelText(/max people per car/i)).toHaveValue(4);
    // Save must stay disabled: showing the server's own values is not an edit.
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('derives the run preview from the server schedule, not the fallback', async () => {
    server.use(
      http.get('*/api/v1/config', () =>
        HttpResponse.json({
          success: true,
          data: [
            { key: 'booking.allocationRunFrequency', value: 'WEEKLY', valueType: 'STRING', description: 'Automatic allocation run interval' },
            { key: 'booking.allocationRunDay', value: 'TUESDAY', valueType: 'STRING', description: 'Weekly allocation run day' },
            { key: 'booking.allocationRunTime', value: '20:56', valueType: 'TIME', description: 'Weekly allocation run time' },
          ],
        }),
      ),
    );
    renderConfig();

    // Every previewed run must be a Tuesday. Reading SUNDAY off the placeholder produced a preview
    // that contradicted the saved config — the visible symptom that something was wrong.
    await screen.findByText(/next 5 runs/i);
    const runs = screen.getAllByRole('listitem').filter((li) => /IST$/.test(li.textContent ?? ''));
    expect(runs).toHaveLength(5);
    for (const li of runs) expect(li.textContent).toMatch(/^Tue/);
  });

  it('keeps an in-progress edit when the config is refetched in the background', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '0.9' } });

    // A refetch must not wipe what the user is typing — the guard the fix had to preserve.
    server.use(http.get('*/api/v1/config', () => HttpResponse.json({ success: true, data: [] })));
    expect(screen.getByLabelText(/weight of the distance sub-score/i)).toHaveValue(0.9);
  });

  it('saves a valid change and toasts', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '0.7' } });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/configuration saved/i)).toBeInTheDocument();
  });
});
