/**
 * Vehicle registry importer CLI (Phase 7 §6 / D17).
 *
 *   npm run import:vehicles -- ./fixtures/vehicles.sample.csv
 *   npm run import:vehicles -- ./vehicles.csv --dry
 *
 * Reads a CSV exported from the building's Excel sheet and upserts `Vehicle` rows keyed on the
 * NORMALIZED plate, so re-running after corrections updates in place instead of duplicating.
 *
 * CSV rather than .xlsx on purpose: it needs no runtime dependency, and "Save As → CSV UTF-8" is one
 * step in Excel. Header matching is case/space/punctuation-insensitive with aliases (see
 * `vehicleCsv.HEADERS`), so a sheet usually imports without being reshaped first.
 *
 * `ownerEmail` is resolved against active users — that link is what lets the gate screen answer
 * "who is this?" from a plate alone. Unmatched emails are kept as text and reported, since
 * contractors and ex-employees legitimately have no account.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import {
  HEADERS,
  REQUIRED_FIELDS,
  mapHeaders,
  parseCsv,
  squash,
  toRow,
  type ParsedVehicleRow,
} from './vehicleCsv';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: npm run import:vehicles -- <path-to-csv> [--dry]');
    process.exit(1);
  }

  const path = resolve(process.cwd(), file);
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length < 2) {
    console.error(`${path}: need a header row plus at least one data row`);
    process.exit(1);
  }

  const index = mapHeaders(rows[0]);
  const missing = REQUIRED_FIELDS.filter((f) => index[f] === undefined);
  if (missing.length) {
    console.error(`${path}: could not find column(s) for ${missing.join(', ')}.`);
    console.error(`Header seen: ${rows[0].join(' | ')}`);
    console.error('Accepted spellings:');
    for (const f of missing) console.error(`  ${f}: ${HEADERS[f].join(', ')}`);
    process.exit(1);
  }

  // Resolve company codes/names and owner emails in bulk rather than per row.
  const companies = await prisma.company.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  const companyByKey = new Map<string, string>();
  for (const c of companies) {
    companyByKey.set(squash(c.code), c.id);
    companyByKey.set(squash(c.name), c.id);
  }

  const parsed: ParsedVehicleRow[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // 1-based, +1 for the header row
    const { row, error } = toRow(cells, index);
    if (!row) {
      skipped.push({ line, reason: error ?? 'unparseable' });
      return;
    }
    if (seen.has(row.vehicleNumber)) {
      skipped.push({ line, reason: `duplicate of an earlier row (${row.vehicleNumber})` });
      return;
    }
    seen.add(row.vehicleNumber);
    parsed.push(row);
  });

  const emails = [...new Set(parsed.map((r) => r.ownerEmail).filter((e): e is string => e !== null))];
  const users = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, email: true, companyId: true },
      })
    : [];
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  let created = 0;
  let updated = 0;
  const unmatchedEmails = new Set<string>();
  const unknownCompanies = new Set<string>();

  for (const row of parsed) {
    const user = row.ownerEmail ? userByEmail.get(row.ownerEmail) : undefined;
    if (row.ownerEmail && !user) unmatchedEmails.add(row.ownerEmail);

    // Prefer the company the matched user actually belongs to; fall back to the sheet's column.
    let companyId = user?.companyId ?? null;
    if (!companyId && row.companyCode) {
      companyId = companyByKey.get(squash(row.companyCode)) ?? null;
      if (!companyId) unknownCompanies.add(row.companyCode);
    }

    const existing = await prisma.vehicle.findUnique({
      where: { vehicleNumber: row.vehicleNumber },
      select: { id: true },
    });
    if (existing) updated++;
    else created++;
    if (dry) continue;

    const data = {
      displayNumber: row.displayNumber,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      contactNumber: row.contactNumber,
      companyId,
      userId: user?.id ?? null,
      vehicleType: row.vehicleType,
      makeModel: row.makeModel,
      colour: row.colour,
      isActive: true,
    };
    await prisma.vehicle.upsert({
      where: { vehicleNumber: row.vehicleNumber },
      update: data,
      create: { vehicleNumber: row.vehicleNumber, ...data },
    });
  }

  console.log(`\n${dry ? '[dry run] ' : ''}${path}`);
  console.log(`  rows read      : ${rows.length - 1}`);
  console.log(`  created        : ${created}`);
  console.log(`  updated        : ${updated}`);
  console.log(`  linked to users: ${parsed.filter((r) => r.ownerEmail && userByEmail.has(r.ownerEmail)).length}`);
  if (skipped.length) {
    console.log(`  skipped        : ${skipped.length}`);
    for (const s of skipped.slice(0, 20)) console.log(`      line ${s.line}: ${s.reason}`);
    if (skipped.length > 20) console.log(`      … and ${skipped.length - 20} more`);
  }
  if (unmatchedEmails.size) {
    console.log(`  emails with no active account (kept as text): ${unmatchedEmails.size}`);
  }
  if (unknownCompanies.size) {
    console.log(`  unknown companies (left unassigned): ${[...unknownCompanies].join(', ')}`);
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
