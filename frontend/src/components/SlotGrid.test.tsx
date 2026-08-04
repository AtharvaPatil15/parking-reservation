import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlotGrid, SlotGridLegend } from './SlotGrid';
import type { components } from '../api/types';

type SlotBox = components['schemas']['SlotBox'];

const boxes = (states: SlotBox['state'][], slotNumbers?: (number | null)[]): SlotBox[] =>
  states.map((state, i) => ({ index: i + 1, state, slotNumber: slotNumbers?.[i] ?? null }));

describe('SlotGrid', () => {
  it('renders one box per slot with an accessible name for the group', () => {
    render(<SlotGrid phase="DECIDED" boxes={boxes(['AVAILABLE', 'TAKEN', 'BLOCKED', 'MINE'])} />);
    expect(screen.getByLabelText('4 parking slots')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('names each box state in text, not colour alone', () => {
    // Colour is not the only signal: a screen-reader user and a colour-blind user both need this.
    render(<SlotGrid phase="DECIDED" boxes={boxes(['AVAILABLE', 'TAKEN', 'BLOCKED', 'MINE'])} />);
    expect(screen.getByText('Slot 1: Available')).toBeInTheDocument();
    expect(screen.getByText('Slot 2: Booked')).toBeInTheDocument();
    expect(screen.getByText('Slot 3: Blocked')).toBeInTheDocument();
    expect(screen.getByText('Slot 4: Your booking')).toBeInTheDocument();
  });

  it('distinguishes booked from blocked visually as well as in text', () => {
    render(<SlotGrid phase="DECIDED" boxes={boxes(['TAKEN', 'BLOCKED'])} />);
    const [taken, blocked] = screen.getAllByRole('listitem');
    // Both grey, but blocked is dashed — so the two are tellable apart without another colour.
    expect(taken.className).not.toContain('border-dashed');
    expect(blocked.className).toContain('border-dashed');
  });

  it('explains itself when the company has no quota for the date', () => {
    render(<SlotGrid phase="OPEN" boxes={[]} />);
    expect(screen.getByText(/no slots are allotted/i)).toBeInTheDocument();
  });

  it('renders a 12-box grid, as the requirement specifies for the demo quota', () => {
    render(<SlotGrid phase="OPEN" boxes={boxes(Array.from({ length: 12 }, () => 'AVAILABLE'))} />);
    expect(screen.getByLabelText('12 parking slots')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });

  // Phase 8 (D18/D22): requests never take a box pre-run, so OPEN never renders TAKEN/MINE.
  it('renders no TAKEN or MINE boxes while phase is OPEN', () => {
    render(<SlotGrid phase="OPEN" boxes={boxes(['AVAILABLE', 'BLOCKED', 'AVAILABLE'])} />);
    expect(screen.queryByText(/Booked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your booking/)).not.toBeInTheDocument();
  });

  it('shows the real slot number, not the grid index, once DECIDED', () => {
    render(
      <SlotGrid
        phase="DECIDED"
        boxes={boxes(['MINE', 'TAKEN', 'AVAILABLE'], [7, 12, null])}
      />,
    );
    expect(screen.getByText('Slot 7: Your booking')).toBeInTheDocument();
    expect(screen.getByText('Slot 12: Booked')).toBeInTheDocument();
    // The visible glyph inside the box is the slot number, not the 1-based grid position.
    const [mine, taken] = screen.getAllByRole('listitem');
    expect(mine.textContent).toContain('7');
    expect(taken.textContent).toContain('12');
  });

  it('falls back to the grid index for MINE/TAKEN when no slotNumber is present', () => {
    render(<SlotGrid phase="DECIDED" boxes={boxes(['MINE'], [null])} />);
    expect(screen.getByText('Slot 1: Your booking')).toBeInTheDocument();
  });
});

describe('SlotGridLegend', () => {
  it('names every state the grid can show once DECIDED', () => {
    render(<SlotGridLegend phase="DECIDED" />);
    for (const label of ['Available', 'Booked', 'Blocked', 'Your booking']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  // D22: a legend listing "Booked" pre-run would teach the user requests take a box.
  it('shows only Available and Blocked while phase is OPEN', () => {
    render(<SlotGridLegend phase="OPEN" />);
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.queryByText('Booked')).not.toBeInTheDocument();
    expect(screen.queryByText('Your booking')).not.toBeInTheDocument();
  });
});
