import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlotGrid, SlotGridLegend } from './SlotGrid';
import type { components } from '../api/types';

type SlotBox = components['schemas']['SlotBox'];

const boxes = (states: SlotBox['state'][]): SlotBox[] =>
  states.map((state, i) => ({ index: i + 1, state }));

describe('SlotGrid', () => {
  it('renders one box per slot with an accessible name for the group', () => {
    render(<SlotGrid boxes={boxes(['AVAILABLE', 'TAKEN', 'BLOCKED', 'MINE'])} />);
    expect(screen.getByLabelText('4 parking slots')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('names each box state in text, not colour alone', () => {
    // Colour is not the only signal: a screen-reader user and a colour-blind user both need this.
    render(<SlotGrid boxes={boxes(['AVAILABLE', 'TAKEN', 'BLOCKED', 'MINE'])} />);
    expect(screen.getByText('Slot 1: Available')).toBeInTheDocument();
    expect(screen.getByText('Slot 2: Booked')).toBeInTheDocument();
    expect(screen.getByText('Slot 3: Blocked')).toBeInTheDocument();
    expect(screen.getByText('Slot 4: Your booking')).toBeInTheDocument();
  });

  it('distinguishes booked from blocked visually as well as in text', () => {
    render(<SlotGrid boxes={boxes(['TAKEN', 'BLOCKED'])} />);
    const [taken, blocked] = screen.getAllByRole('listitem');
    // Both grey, but blocked is dashed — so the two are tellable apart without another colour.
    expect(taken.className).not.toContain('border-dashed');
    expect(blocked.className).toContain('border-dashed');
  });

  it('explains itself when the company has no quota for the date', () => {
    render(<SlotGrid boxes={[]} />);
    expect(screen.getByText(/no slots are allotted/i)).toBeInTheDocument();
  });

  it('renders a 12-box grid, as the requirement specifies for the demo quota', () => {
    render(<SlotGrid boxes={boxes(Array.from({ length: 12 }, () => 'AVAILABLE'))} />);
    expect(screen.getByLabelText('12 parking slots')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });
});

describe('SlotGridLegend', () => {
  it('names every state the grid can show', () => {
    render(<SlotGridLegend />);
    for (const label of ['Available', 'Booked', 'Blocked', 'Your booking']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
