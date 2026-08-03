/**
 * Pure CSV parsing + header mapping for the vehicle importer (Phase 7 §6). Kept apart from the CLI in
 * `import-vehicles.ts` so it is unit-testable without the CLI's argv handling and DB connection.
 */
import type { VehicleType } from '@prisma/client';
import { normalizePlate } from '../src/lib/plate';

/** Canonical field → accepted header spellings (compared after `squash`). */
export const HEADERS: Record<string, string[]> = {
  vehicleNumber: ['vehiclenumber', 'carnumber', 'vehicleno', 'carno', 'regno', 'registrationnumber', 'number', 'plate'],
  ownerName: ['ownername', 'name', 'employeename', 'owner', 'fullname'],
  ownerEmail: ['email', 'workemail', 'employeeemail', 'owneremail', 'emailid'],
  contactNumber: ['contact', 'contactnumber', 'mobile', 'phone', 'mobileno', 'phonenumber'],
  companyCode: ['company', 'companycode', 'companyname', 'organisation', 'organization'],
  vehicleType: ['vehicletype', 'type'],
  makeModel: ['make', 'model', 'makemodel', 'vehiclemodel', 'carmodel'],
  colour: ['colour', 'color'],
};

export const REQUIRED_FIELDS = ['vehicleNumber', 'ownerName'] as const;

const VEHICLE_TYPES: VehicleType[] = ['CAR', 'BIKE', 'EV_CAR', 'EV_BIKE', 'OTHER'];

/** Comparison key for header/company matching: lowercase, alphanumerics only. */
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Minimal RFC-4180 CSV parse: quoted fields, embedded commas/newlines, `""` escapes, CRLF, and the
 * UTF-8 BOM Excel writes. Hand-rolled to keep the import path dependency-free.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // swallow — the following \n ends the record
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Map the sheet's header row onto canonical field names; unrecognised columns are ignored. */
export function mapHeaders(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((raw, i) => {
    const key = squash(raw);
    for (const [field, aliases] of Object.entries(HEADERS)) {
      if (index[field] === undefined && aliases.includes(key)) index[field] = i;
    }
  });
  return index;
}

export interface ParsedVehicleRow {
  vehicleNumber: string;
  displayNumber: string;
  ownerName: string;
  ownerEmail: string | null;
  contactNumber: string | null;
  companyCode: string | null;
  vehicleType: VehicleType;
  makeModel: string | null;
  colour: string | null;
}

/**
 * Turn one CSV record into a row to upsert, or an explanation of why it was skipped. A bad row never
 * aborts the import — the sheet is maintained by hand and one malformed line should not block the rest.
 */
export function toRow(
  cells: string[],
  index: Record<string, number>,
): { row?: ParsedVehicleRow; error?: string } {
  const get = (field: string): string | null => {
    const i = index[field];
    if (i === undefined) return null;
    const v = (cells[i] ?? '').trim();
    return v === '' ? null : v;
  };

  const rawNumber = get('vehicleNumber');
  if (!rawNumber) return { error: 'missing car number' };
  const vehicleNumber = normalizePlate(rawNumber);
  if (vehicleNumber.length < 4) return { error: `car number "${rawNumber}" is too short to be real` };

  const ownerName = get('ownerName');
  if (!ownerName) return { error: `no owner name for ${rawNumber}` };

  const rawType = get('vehicleType');
  const typeGuess = rawType ? (rawType.toUpperCase().replace(/[^A-Z]/g, '_') as VehicleType) : 'CAR';

  return {
    row: {
      vehicleNumber,
      displayNumber: rawNumber,
      ownerName,
      // Lower-cased so the owner→User match is case-insensitive.
      ownerEmail: get('ownerEmail')?.toLowerCase() ?? null,
      contactNumber: get('contactNumber'),
      companyCode: get('companyCode'),
      vehicleType: VEHICLE_TYPES.includes(typeGuess) ? typeGuess : 'CAR',
      makeModel: get('makeModel'),
      colour: get('colour'),
    },
  };
}
