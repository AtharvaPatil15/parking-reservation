import { describe, it, expect } from 'vitest';
import { normalizePlate } from '../src/lib/plate';
import { buildDecidedBoxes, buildOpenBoxes } from '../src/modules/bookings/bookings.availability';
import { parseCsv, mapHeaders, toRow } from '../scripts/vehicleCsv';

/** Phase 7 — the pure pieces of the slot grid, plate handling, and the Excel/CSV import. */

describe('normalizePlate', () => {
  it('collapses every way a plate gets typed into one key', () => {
    const forms = ['MH 12 AB 1234', 'mh12ab1234', 'MH-12-AB-1234', ' MH.12 ab.1234 ', 'Mh12Ab1234'];
    for (const f of forms) expect(normalizePlate(f)).toBe('MH12AB1234');
  });

  it('drops anything that is not a letter or digit', () => {
    expect(normalizePlate('MH#12@AB/1234')).toBe('MH12AB1234');
    expect(normalizePlate('   ')).toBe('');
  });
});

/**
 * Phase 8 (D22) split the one box builder in two, because the grid means different things before and
 * after a date is decided. These tests were previously the `buildBoxes` suite, which asserted the
 * Phase 7 model — that a live *request* turned a box grey. They now assert the opposite for `OPEN`,
 * and the outcome-derived grid for `DECIDED`.
 */
const alloc = (slotNumber: string, userId: string) => ({ slotNumber, userId });
const ME = 'user-me';
const THEM = 'user-them';

describe('buildOpenBoxes — capacity only, before the date is decided (D22)', () => {
  it('renders one box per quota slot', () => {
    expect(buildOpenBoxes({ quota: 12, blocked: 0 })).toHaveLength(12);
  });

  it('shows blocked slots then free ones, and NOTHING else', () => {
    const boxes = buildOpenBoxes({ quota: 5, blocked: 2 });
    expect(boxes.map((b) => b.state)).toEqual(['BLOCKED', 'BLOCKED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
  });

  it('never emits TAKEN or MINE, however many people are queued', () => {
    // This is the whole point of the phase: a queued request occupies no box, so there is no box to
    // race for. `buildOpenBoxes` cannot even express "taken" — it takes no request count at all.
    const boxes = buildOpenBoxes({ quota: 3, blocked: 0 });
    expect(boxes.some((b) => b.state === 'TAKEN' || b.state === 'MINE')).toBe(false);
  });

  it('carries no slot number — nothing is assigned yet', () => {
    expect(buildOpenBoxes({ quota: 3, blocked: 1 }).every((b) => b.slotNumber === null)).toBe(true);
  });

  it('clamps blocked to quota rather than growing the grid', () => {
    const boxes = buildOpenBoxes({ quota: 3, blocked: 9 });
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.state === 'BLOCKED')).toBe(true);
  });

  it('renders nothing when the company has no quota for the date', () => {
    expect(buildOpenBoxes({ quota: 0, blocked: 0 })).toEqual([]);
  });

  it('numbers boxes from 1', () => {
    expect(buildOpenBoxes({ quota: 3, blocked: 0 }).map((b) => b.index)).toEqual([1, 2, 3]);
  });
});

describe('buildDecidedBoxes — outcomes, after the run (D22)', () => {
  it('fills left to right: mine, others, blocked, then unclaimed', () => {
    const boxes = buildDecidedBoxes({
      quota: 6,
      blocked: 2,
      allocations: [alloc('A-01', THEM), alloc('A-02', ME), alloc('A-03', THEM)],
      viewerId: ME,
    });
    expect(boxes.map((b) => b.state)).toEqual(['MINE', 'TAKEN', 'TAKEN', 'BLOCKED', 'BLOCKED', 'AVAILABLE']);
  });

  it('carries the real slot number on every assigned box, and none on the rest', () => {
    const boxes = buildDecidedBoxes({
      quota: 4,
      blocked: 1,
      allocations: [alloc('B-07', ME), alloc('B-08', THEM)],
      viewerId: ME,
    });
    expect(boxes[0]).toMatchObject({ state: 'MINE', slotNumber: 'B-07' });
    expect(boxes[1]).toMatchObject({ state: 'TAKEN', slotNumber: 'B-08' });
    expect(boxes[2]).toMatchObject({ state: 'BLOCKED', slotNumber: null });
    expect(boxes[3]).toMatchObject({ state: 'AVAILABLE', slotNumber: null });
  });

  it('marks nothing as MINE when the viewer was not allocated', () => {
    const boxes = buildDecidedBoxes({
      quota: 3,
      blocked: 0,
      allocations: [alloc('C-01', THEM), alloc('C-02', THEM)],
      viewerId: ME,
    });
    expect(boxes.some((b) => b.state === 'MINE')).toBe(false);
    expect(boxes.filter((b) => b.state === 'TAKEN')).toHaveLength(2);
  });

  it('keeps MINE visible when quota was lowered after allocation', () => {
    // Ordering caller-first exists for exactly this: the clamp drops other people's boxes, never the
    // viewer's own. Not being able to find yourself in your own grid is the worst failure here.
    const boxes = buildDecidedBoxes({
      quota: 2,
      blocked: 2,
      allocations: [alloc('D-01', THEM), alloc('D-02', THEM), alloc('D-03', ME)],
      viewerId: ME,
    });
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ state: 'MINE', slotNumber: 'D-03' });
  });

  it('stays exactly quota boxes wide (D14)', () => {
    for (const quota of [0, 1, 5, 12]) {
      const boxes = buildDecidedBoxes({
        quota,
        blocked: 3,
        allocations: [alloc('E-01', ME), alloc('E-02', THEM)],
        viewerId: ME,
      });
      expect(boxes).toHaveLength(quota);
    }
  });
});

describe('parseCsv', () => {
  it('parses a plain sheet', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles CRLF line endings from Windows Excel', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the UTF-8 BOM Excel writes, so the first header still matches', () => {
    const rows = parseCsv('﻿Car Number,Owner Name\nMH12AB1234,Aditi\n');
    expect(rows[0][0]).toBe('Car Number');
  });

  it('respects quoted fields containing commas and escaped quotes', () => {
    expect(parseCsv('a,b\n"Rao, Aditi","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['Rao, Aditi', 'say "hi"'],
    ]);
  });

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('mapHeaders (aliases so an untouched Excel export imports)', () => {
  it('matches regardless of case, spaces and punctuation', () => {
    const idx = mapHeaders(['Car Number', 'Owner  Name', 'E-mail', 'Mobile No', 'Company Code']);
    expect(idx).toMatchObject({
      vehicleNumber: 0,
      ownerName: 1,
      ownerEmail: 2,
      contactNumber: 3,
      companyCode: 4,
    });
  });

  it('recognises the alternative spellings the sheets actually use', () => {
    expect(mapHeaders(['Registration Number', 'Employee Name'])).toMatchObject({
      vehicleNumber: 0,
      ownerName: 1,
    });
    expect(mapHeaders(['vehicle no', 'full name'])).toMatchObject({ vehicleNumber: 0, ownerName: 1 });
  });

  it('ignores columns it does not know', () => {
    const idx = mapHeaders(['Car Number', 'Owner Name', 'Parking Sticker Serial']);
    expect(Object.values(idx)).not.toContain(2);
  });
});

describe('toRow', () => {
  const index = mapHeaders(['Car Number', 'Owner Name', 'Email', 'Vehicle Type']);

  it('normalizes the plate but keeps the readable form', () => {
    const { row } = toRow(['MH 12 AB 1234', 'Aditi Rao', 'ADITI', 'CAR'], index);
    expect(row).toMatchObject({
      vehicleNumber: 'MH12AB1234',
      displayNumber: 'MH 12 AB 1234',
      ownerName: 'Aditi Rao',
      ownerEmail: 'aditi', // lower-cased so the user match works
      vehicleType: 'CAR',
    });
  });

  it('defaults an unrecognised vehicle type to CAR rather than failing the row', () => {
    expect(toRow(['MH12AB1234', 'Aditi', '', 'sedan'], index).row?.vehicleType).toBe('CAR');
    expect(toRow(['MH12AB1234', 'Aditi', '', 'ev car'], index).row?.vehicleType).toBe('EV_CAR');
  });

  it('rejects rows that cannot identify a car or an owner', () => {
    expect(toRow(['', 'Aditi', '', 'CAR'], index).error).toMatch(/missing car number/);
    expect(toRow(['MH12AB1234', '', '', 'CAR'], index).error).toMatch(/no owner name/);
    expect(toRow(['MH1', 'Aditi', '', 'CAR'], index).error).toMatch(/too short/);
  });

  it('treats empty optional cells as null, not empty strings', () => {
    const { row } = toRow(['MH12AB1234', 'Aditi', '   ', ''], index);
    expect(row?.ownerEmail).toBeNull();
  });
});
