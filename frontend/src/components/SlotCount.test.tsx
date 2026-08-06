import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlotCount } from './SlotCount';
import type { components } from '../api/types';

type SlotBox = components['schemas']['SlotBox'];

const boxes = (states: SlotBox['state'][], slotNumbers?: (string | null)[]): SlotBox[] =>
  states.map((state, i) => ({ index: i + 1, state, slotNumber: slotNumbers?.[i] ?? null }));

describe('SlotCount', () => {
  it('shows the filled and empty counts as numbers, not one box per slot', () => {
    const { container } = render(<SlotCount boxes={boxes(['MINE', 'TAKEN', 'AVAILABLE'])} />);
    // The visible half of the readout (the other half is the screen-reader sentence below).
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toMatch(/2 filled.*1 empty/);
    // The grid is gone: no per-slot list items remain.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  // TAKEN and MINE both count as filled: whose booking it is belongs to the row's status badge, not
  // to a capacity count. The whole readout is also spoken as one sentence, so "·" is not read aloud.
  it('counts TAKEN and MINE together as filled, in one sentence for a screen reader', () => {
    render(<SlotCount boxes={boxes(['AVAILABLE', 'TAKEN', 'BLOCKED', 'MINE'])} />);
    expect(screen.getByText('2 of 4 slots filled, 1 empty, 1 blocked')).toBeInTheDocument();
  });

  it('leaves blocked out of the readout when there are none', () => {
    render(<SlotCount boxes={boxes(['TAKEN', 'AVAILABLE'])} />);
    expect(screen.getByText('1 of 2 slots filled, 1 empty')).toBeInTheDocument();
    expect(screen.queryByText(/blocked/)).not.toBeInTheDocument();
  });

  it('explains itself when the company has no quota for the date', () => {
    render(<SlotCount boxes={[]} />);
    expect(screen.getByText(/no slots are allotted/i)).toBeInTheDocument();
  });

  // The booking form renders this inside its date-row <button>, whose content model is phrasing
  // content — a <p> in there is invalid HTML. Both branches have to stay phrasing-level.
  it.each([
    ['with slots', boxes(['AVAILABLE', 'TAKEN'])],
    ['with no quota', [] as SlotBox[]],
  ])('renders no block-level element %s, so it is valid inside a button', (_label, given) => {
    const { container } = render(<SlotCount boxes={given} />);
    expect(container.querySelector('p, div')).toBeNull();
  });

  // D18/D22: a request is a queue entry, not a reservation, so an undecided date has nothing filled.
  it('reads 0 filled for a full quota that has not been allocated yet', () => {
    render(<SlotCount boxes={boxes(Array.from({ length: 12 }, () => 'AVAILABLE'))} />);
    expect(screen.getByText('0 of 12 slots filled, 12 empty')).toBeInTheDocument();
  });
});
