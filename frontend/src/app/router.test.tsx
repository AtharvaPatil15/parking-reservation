import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('routing + guards (integration)', () => {
  it('dev sign-in as Super Admin lands on the admin area with a sign-out control', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /sign in as super admin/i }));
    expect(await screen.findByRole('heading', { name: /^super admin$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('signing out returns to the login page', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /sign in as user/i }));
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    // Exact match: /sign in/i alone also matches the "Developer sign-in" card title.
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });
});
