import { describe, it, expect } from 'vitest';
import {
  distanceScore,
  carpoolScore,
  score,
  round4,
  compareCandidates,
  rankCandidates,
  secureUnitRandom,
  DEFAULT_WEIGHTS,
  DEFAULT_CAPS,
  type RankCandidate,
  type RankedResult,
} from '../src/modules/allocation/score';

/**
 * P4-11 — exhaustive unit tests for the pure allocation scoring function.
 * Pinned to decisions.md §3 (the authoritative formula), NOT the illustrative
 * breakdown table in phases-3-6-plan.md (whose finalScore example is inexact).
 */

describe('distanceScore — decisions §3 Step 1', () => {
  it('matches the documented bands (maxDistanceKm = 40)', () => {
    expect(distanceScore(0)).toBe(0);
    expect(distanceScore(10)).toBe(25);
    expect(distanceScore(20)).toBe(50);
    expect(distanceScore(30)).toBe(75);
    expect(distanceScore(40)).toBe(100);
  });

  it('clamps distances beyond the cap to 100', () => {
    expect(distanceScore(40.0001)).toBe(100);
    expect(distanceScore(45)).toBe(100);
    expect(distanceScore(200)).toBe(100);
  });

  it('clamps negative distance to 0', () => {
    expect(distanceScore(-1)).toBe(0);
    expect(distanceScore(-100)).toBe(0);
  });

  it('is linear between bands', () => {
    expect(distanceScore(5)).toBe(12.5);
    expect(distanceScore(38.1)).toBe(95.25); // Sara Khan example (distance sub-score)
    expect(distanceScore(12.4)).toBe(31); // Aditi Rao example (distance sub-score)
  });

  it('honours a configurable maxDistanceKm', () => {
    expect(distanceScore(10, 20)).toBe(50);
    expect(distanceScore(20, 20)).toBe(100);
    expect(distanceScore(30, 20)).toBe(100); // clamped
  });

  it('rejects a non-positive maxDistanceKm', () => {
    expect(() => distanceScore(10, 0)).toThrow(RangeError);
    expect(() => distanceScore(10, -5)).toThrow(RangeError);
  });
});

describe('carpoolScore — decisions §3 Step 2', () => {
  it('matches the documented bands (maxPeople = 4, includes driver)', () => {
    expect(carpoolScore(1)).toBe(0);
    expect(carpoolScore(2)).toBe(33.3333);
    expect(carpoolScore(3)).toBe(66.6667);
    expect(carpoolScore(4)).toBe(100);
  });

  it('clamps people beyond the cap to 100', () => {
    expect(carpoolScore(5)).toBe(100);
    expect(carpoolScore(10)).toBe(100);
  });

  it('clamps people below 1 to the driver-only score of 0', () => {
    expect(carpoolScore(0)).toBe(0);
    expect(carpoolScore(-3)).toBe(0);
  });

  it('honours a configurable maxPeople', () => {
    expect(carpoolScore(1, 3)).toBe(0);
    expect(carpoolScore(2, 3)).toBe(50);
    expect(carpoolScore(3, 3)).toBe(100);
    expect(carpoolScore(4, 3)).toBe(100); // clamped
  });

  it('rejects a maxPeople below 2', () => {
    expect(() => carpoolScore(2, 1)).toThrow(RangeError);
    expect(() => carpoolScore(2, 0)).toThrow(RangeError);
  });
});

describe('score — full breakdown & weighting (decisions §3 Step 3)', () => {
  it('applies the default 0.60 / 0.40 weighting', () => {
    // distance 20 → 50, people 2 → 33.3333; final = 0.6*50 + 0.4*33.3333 = 43.3333
    const b = score({ distanceKm: 20, people: 2 });
    expect(b.distanceScore).toBe(50);
    expect(b.carpoolScore).toBe(33.3333);
    expect(b.distanceWeight).toBe(0.6);
    expect(b.carpoolWeight).toBe(0.4);
    expect(b.finalScore).toBe(43.3333);
    expect(b.people).toBe(2);
  });

  it('scores the max case at 100', () => {
    const b = score({ distanceKm: 40, people: 4 });
    expect(b.distanceScore).toBe(100);
    expect(b.carpoolScore).toBe(100);
    expect(b.finalScore).toBe(100);
  });

  it('scores the min case at 0', () => {
    const b = score({ distanceKm: 0, people: 1 });
    expect(b.distanceScore).toBe(0);
    expect(b.carpoolScore).toBe(0);
    expect(b.finalScore).toBe(0);
  });

  it('reproduces the worked examples from the formula (not the plan doc)', () => {
    // Sara Khan: distance 38.1, people 3 → 0.6*95.25 + 0.4*66.6667 = 83.8167
    expect(score({ distanceKm: 38.1, people: 3 }).finalScore).toBe(83.8167);
    // Aditi Rao: distance 12.4, people 3 → 0.6*31 + 0.4*66.6667 = 45.2667
    expect(score({ distanceKm: 12.4, people: 3 }).finalScore).toBe(45.2667);
  });

  it('respects configurable weights', () => {
    const b = score({ distanceKm: 40, people: 1 }, { distanceWeight: 0.5, carpoolWeight: 0.5 });
    expect(b.finalScore).toBe(50); // 0.5*100 + 0.5*0
  });

  it('respects configurable caps', () => {
    const b = score({ distanceKm: 10, people: 2 }, DEFAULT_WEIGHTS, { maxDistanceKm: 20, maxPeople: 3 });
    expect(b.distanceScore).toBe(50); // 10/20
    expect(b.carpoolScore).toBe(50); // (2-1)/(3-1)
    expect(b.finalScore).toBe(50);
  });

  it('clamps and truncates the reported people count into [1, maxPeople]', () => {
    expect(score({ distanceKm: 0, people: 0 }).people).toBe(1);
    expect(score({ distanceKm: 0, people: 9 }).people).toBe(DEFAULT_CAPS.maxPeople);
    expect(score({ distanceKm: 0, people: 2.9 }).people).toBe(2);
  });
});

describe('round4', () => {
  it('rounds to 4 decimal places (persisted precision)', () => {
    expect(round4(66.666666)).toBe(66.6667);
    expect(round4(33.333333)).toBe(33.3333);
    expect(round4(83.816680000001)).toBe(83.8167);
    expect(round4(100)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tie-breakers (decisions §3): finalScore desc, then (1) people, (2) distance,
// (3) earlier submission, (4) fewer 30-day allocations, (5) secure random.
// ---------------------------------------------------------------------------

type Candidate = RankCandidate & { id: string };

const base: Omit<Candidate, 'id'> = {
  finalScore: 50,
  people: 2,
  distanceKm: 10,
  submittedAt: 1000,
  allocationsPrev30d: 0,
};

/** Ids in ranked order, from rankCandidates results. */
const ids = (results: RankedResult<Candidate>[]): string[] => results.map((r) => r.candidate.id);
/** Ids from a raw candidate array (for mutation checks). */
const rawIds = (cs: Candidate[]): string[] => cs.map((c) => c.id);

describe('compareCandidates — primary key', () => {
  it('orders by finalScore descending', () => {
    const hi: Candidate = { ...base, id: 'hi', finalScore: 80 };
    const lo: Candidate = { ...base, id: 'lo', finalScore: 60 };
    expect(compareCandidates(hi, lo)).toBeLessThan(0);
    expect(compareCandidates(lo, hi)).toBeGreaterThan(0);
  });

  it('treats finalScores equal at 4dp as a tie despite float noise', () => {
    // 0.1 + 0.2 = 0.30000000000000004 — must not out-rank a genuine 0.3.
    const a: Candidate = { ...base, id: 'a', finalScore: 0.1 + 0.2, people: 3 };
    const b: Candidate = { ...base, id: 'b', finalScore: 0.3, people: 2 };
    // finalScore ties → decided by people (a has more) → a ranks first.
    expect(compareCandidates(a, b)).toBeLessThan(0);
  });
});

describe('rankCandidates — tie-breaker ladder', () => {
  it('(1) more people wins when finalScore ties', () => {
    const few: Candidate = { ...base, id: 'few', people: 2 };
    const many: Candidate = { ...base, id: 'many', people: 4 };
    expect(ids(rankCandidates([few, many]))).toEqual(['many', 'few']);
  });

  it('(2) greater distance wins when finalScore + people tie', () => {
    const near: Candidate = { ...base, id: 'near', distanceKm: 5 };
    const far: Candidate = { ...base, id: 'far', distanceKm: 35 };
    expect(ids(rankCandidates([near, far]))).toEqual(['far', 'near']);
  });

  it('(3) earlier submission wins when finalScore + people + distance tie', () => {
    const late: Candidate = { ...base, id: 'late', submittedAt: 5000 };
    const early: Candidate = { ...base, id: 'early', submittedAt: 2000 };
    expect(ids(rankCandidates([late, early]))).toEqual(['early', 'late']);
  });

  it('(3) accepts Date and epoch-ms submittedAt interchangeably', () => {
    const late: Candidate = { ...base, id: 'late', submittedAt: new Date(5000) };
    const early: Candidate = { ...base, id: 'early', submittedAt: new Date(2000) };
    expect(ids(rankCandidates([late, early]))).toEqual(['early', 'late']);
  });

  it('(4) fewer 30-day allocations wins when all prior keys tie (fairness, D4)', () => {
    const heavy: Candidate = { ...base, id: 'heavy', allocationsPrev30d: 6 };
    const light: Candidate = { ...base, id: 'light', allocationsPrev30d: 1 };
    expect(ids(rankCandidates([heavy, light]))).toEqual(['light', 'heavy']);
  });

  it('applies the ladder in strict priority order', () => {
    // Lower finalScore but "better" on every downstream tie-breaker must still lose.
    const winner: Candidate = { ...base, id: 'winner', finalScore: 90, people: 2, distanceKm: 1, submittedAt: 9000, allocationsPrev30d: 9 };
    const loser: Candidate = { ...base, id: 'loser', finalScore: 80, people: 4, distanceKm: 40, submittedAt: 1, allocationsPrev30d: 0 };
    expect(ids(rankCandidates([loser, winner]))).toEqual(['winner', 'loser']);
  });
});

describe('rankCandidates — (5) secure random draw', () => {
  it('breaks a full tie using the injected rng (ascending draw)', () => {
    const x: Candidate = { ...base, id: 'x' };
    const y: Candidate = { ...base, id: 'y' };
    const z: Candidate = { ...base, id: 'z' };
    const draws = [0.9, 0.1, 0.5]; // assigned to x, y, z in input order
    let i = 0;
    const rng = () => draws[i++];
    expect(ids(rankCandidates([x, y, z], rng))).toEqual(['y', 'z', 'x']);
  });

  it('is deterministic for a given rng sequence', () => {
    const cs: Candidate[] = [
      { ...base, id: 'a' },
      { ...base, id: 'b' },
      { ...base, id: 'c' },
    ];
    const seq = [0.42, 0.07, 0.99];
    const make = () => {
      let i = 0;
      return () => seq[i++];
    };
    expect(ids(rankCandidates(cs, make()))).toEqual(ids(rankCandidates(cs, make())));
  });

  it('preserves input order when the draw itself ties (stable)', () => {
    const cs: Candidate[] = [
      { ...base, id: 'first' },
      { ...base, id: 'second' },
      { ...base, id: 'third' },
    ];
    expect(ids(rankCandidates(cs, () => 0.5))).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the input array', () => {
    const cs: Candidate[] = [
      { ...base, id: 'a', finalScore: 10 },
      { ...base, id: 'b', finalScore: 90 },
    ];
    const snapshot = rawIds(cs);
    rankCandidates(cs);
    expect(rawIds(cs)).toEqual(snapshot);
  });
});

describe('rankCandidates — surfaced draw, rank, and deterministic replay', () => {
  it('surfaces a fresh draw in [0, 1) for each candidate (default secure rng)', () => {
    const cs: Candidate[] = [
      { ...base, id: 'a' },
      { ...base, id: 'b' },
    ];
    for (const r of rankCandidates(cs)) {
      expect(r.randomDraw).toBeGreaterThanOrEqual(0);
      expect(r.randomDraw).toBeLessThan(1);
    }
  });

  it('returns the exact draw assigned to each candidate', () => {
    const x: Candidate = { ...base, id: 'x' };
    const y: Candidate = { ...base, id: 'y' };
    const z: Candidate = { ...base, id: 'z' };
    const draws = [0.9, 0.1, 0.5]; // x, y, z in input order
    let i = 0;
    const ranked = rankCandidates([x, y, z], () => draws[i++]);
    const drawFor = (id: string) => ranked.find((r) => r.candidate.id === id)!.randomDraw;
    expect(drawFor('x')).toBe(0.9);
    expect(drawFor('y')).toBe(0.1);
    expect(drawFor('z')).toBe(0.5);
  });

  it('assigns 1-based ranks in output order', () => {
    const hi: Candidate = { ...base, id: 'hi', finalScore: 90 };
    const lo: Candidate = { ...base, id: 'lo', finalScore: 10 };
    const ranked = rankCandidates([lo, hi]);
    expect(ranked.map((r) => [r.candidate.id, r.rank])).toEqual([
      ['hi', 1],
      ['lo', 2],
    ]);
  });

  it('uses a candidate-carried randomDraw instead of calling rng (replay)', () => {
    const a: Candidate = { ...base, id: 'a', randomDraw: 0.8 };
    const b: Candidate = { ...base, id: 'b', randomDraw: 0.2 };
    const throwRng = () => {
      throw new Error('rng must not be called when randomDraw is set');
    };
    const ranked = rankCandidates([a, b], throwRng);
    expect(ids(ranked)).toEqual(['b', 'a']); // lower draw ranks first
  });

  it('round-trips: draws captured on run 1 reproduce the identical order on replay', () => {
    const cs: Candidate[] = [
      { ...base, id: 'a' },
      { ...base, id: 'b' },
      { ...base, id: 'c' },
    ];
    const draws = [0.9, 0.1, 0.5]; // a, b, c
    let i = 0;
    const firstRun = rankCandidates(cs, () => draws[i++]);
    const order1 = ids(firstRun); // ['b', 'c', 'a']

    // Persist each candidate's draw, then replay from the ORIGINAL input order with an rng
    // that must never be consulted.
    const drawById = new Map(firstRun.map((r) => [r.candidate.id, r.randomDraw]));
    const persisted: Candidate[] = cs.map((c) => ({ ...c, randomDraw: drawById.get(c.id)! }));
    const throwRng = () => {
      throw new Error('rng must not be called on replay');
    };
    expect(ids(rankCandidates(persisted, throwRng))).toEqual(order1);
  });
});

describe('secureUnitRandom', () => {
  it('produces values within [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const r = secureUnitRandom();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});
