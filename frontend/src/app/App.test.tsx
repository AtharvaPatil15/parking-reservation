import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

// Smoke test — unauthenticated boot lands on the login page.
describe('App', () => {
  it('shows the login page when unauthenticated', () => {
    render(<App />);
    // Exact match: /sign in/i alone also matches the "Developer sign-in" card title.
    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('exposes a theme toggle', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /switch to .* theme/i })).toBeInTheDocument();
  });
});
