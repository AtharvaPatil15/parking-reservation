import { describe, it, expect } from 'vitest';
import { normalizePlate } from '../src/lib/plate';
import { buildBoxes } from '../src/modules/bookings/bookings.availability';
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

describe('buildBoxes (D14 — grid is quota-sized)', () => {
  it('renders one box per quota slot', () => {
    expect(buildBoxes({ quota: 12, blocked: 0, taken: 0, mine: false })).toHaveLength(12);
  });

  it('fills left to right: mine, others, blocked, then free', () => {
    const boxes = buildBoxes({ quota: 12, blocked: 2, taken: 3, mine: true });
    expect(boxes.map((b) => b.state)).toEqual([
      'MINE',
      'TAKEN',
      'TAKEN',
      'BLOCKED',
      'BLOCKED',
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
    ]);
    // 12 − 2 blocked − 3 taken = 7 green.
    expect(boxes.filter((b) => b.state === 'AVAILABLE')).toHaveLength(7);
  });

  it('counts the caller inside `taken` rather than on top of it', () => {
    // taken=1 and it is mine → exactly one non-green box, not two.
    const boxes = buildBoxes({ quota: 4, blocked: 0, taken: 1, mine: true });
    expect(boxes.map((b) => b.state)).toEqual(['MINE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
  });

  it('shows an all-grey grid when the date is full', () => {
    const boxes = buildBoxes({ quota: 5, blocked: 1, taken: 4, mine: false });
    expect(boxes.some((b) => b.state === 'AVAILABLE')).toBe(false);
    expect(boxes).toHaveLength(5);
  });

  it('clamps to quota when quota was lowered after requests were taken, keeping MINE visible', () => {
    const boxes = buildBoxes({ quota: 3, blocked: 2, taken: 4, mine: true });
    expect(boxes).toHaveLength(3);
    expect(boxes[0].state).toBe('MINE');
    expect(boxes.some((b) => b.state === 'AVAILABLE')).toBe(false);
  });

  it('renders nothing when the company has no quota for the date', () => {
    expect(buildBoxes({ quota: 0, blocked: 0, taken: 0, mine: false })).toEqual([]);
  });

  it('numbers boxes from 1', () => {
    expect(buildBoxes({ quota: 3, blocked: 0, taken: 0, mine: false }).map((b) => b.index)).toEqual([1, 2, 3]);
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
    const { row } = toRow(['MH 12 AB 1234', 'Aditi Rao', 'ADITI@assent.example', 'CAR'], index);
    expect(row).toMatchObject({
      vehicleNumber: 'MH12AB1234',
      displayNumber: 'MH 12 AB 1234',
      ownerName: 'Aditi Rao',
      ownerEmail: 'aditi@assent.example', // lower-cased so the user match works
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
