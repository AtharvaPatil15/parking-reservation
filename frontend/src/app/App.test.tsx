import { render, screen } from '@testing-library/react';
import { App } from './App';

// Smoke test — proves the RTL + jsdom harness is wired for P5-14.
describe('App', () => {
  it('renders the app shell', () => {
    render(<App />);
    expect(screen.getByText('Parking Reservation')).toBeInTheDocument();
  });

  it('exposes a theme toggle', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /switch to .* theme/i })).toBeInTheDocument();
  });
});
