import { randomInt } from 'node:crypto';

/**
 * Allocation scoring — pure functions (P4-11), no DB, no side effects.
 *
 * Formula (decisions §3 / D3):
 *   distanceScore = (min(distanceKm, maxDistanceKm) / maxDistanceKm) * 100
 *   carpoolScore  = ((min(people, maxPeople) - 1) / (maxPeople - 1)) * 100
 *   finalScore    = distanceWeight * distanceScore + carpoolWeight * carpoolScore
 *
 * `people` = 1 (driver/owner, always person 1) + number of *scored* carpool members
 * (same-company employees validated by email — F4). Weights and caps are configurable via
 * SystemConfiguration; defaults below mirror `prisma/seed.ts`.
 *
 * Ranking (decisions §3): by finalScore desc, then tie-breakers in order —
 *   (1) more people  (2) greater distance  (3) earlier submission
 *   (4) fewer allocations in the previous 30 days  (5) secure random draw.
 */

/** Canonical stored precision — AllocationScoreBreakdown persists scores as Decimal(10,4). */
export const SCORE_DECIMALS = 4;

export interface ScoreWeights {
  /** allocation.distanceWeight — default 0.60 */
  distanceWeight: number;
  /** allocation.carpoolWeight — default 0.40 */
  carpoolWeight: number;
}

export interface ScoreCaps {
  /** allocation.maxDistanceKm — default 40 */
  maxDistanceKm: number;
  /** carpool.maxPeople — default 4 (includes the driver) */
  maxPeople: number;
}

export interface ScoreInput {
  /** Snapshotted travel distance in km (F5/F6). */
  distanceKm: number;
  /** 1 (driver) + scored carpool members. Clamped to >= 1. */
  people: number;
}

export interface ScoreBreakdown {
  distanceScore: number;
  carpoolScore: number;
  distanceWeight: number;
  carpoolWeight: number;
  finalScore: number;
  people: number;
}

/** Defaults mirror the seeded SystemConfiguration values. */
export const DEFAULT_WEIGHTS: ScoreWeights = { distanceWeight: 0.6, carpoolWeight: 0.4 };
export const DEFAULT_CAPS: ScoreCaps = { maxDistanceKm: 40, maxPeople: 4 };

/** Round to the persisted precision (4 dp) using round-half-up on the absolute value. */
export function round4(n: number): number {
  const f = 10 ** SCORE_DECIMALS;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Distance sub-score, 0–100. Distance is clamped to [0, maxDistanceKm]. */
export function distanceScore(distanceKm: number, maxDistanceKm: number = DEFAULT_CAPS.maxDistanceKm): number {
  if (!(maxDistanceKm > 0)) throw new RangeError('maxDistanceKm must be > 0');
  const clamped = Math.min(Math.max(distanceKm, 0), maxDistanceKm);
  return round4((clamped / maxDistanceKm) * 100);
}

/** Carpool sub-score, 0–100. People is clamped to [1, maxPeople]. */
export function carpoolScore(people: number, maxPeople: number = DEFAULT_CAPS.maxPeople): number {
  if (!(maxPeople >= 2)) throw new RangeError('maxPeople must be >= 2');
  const clamped = Math.min(Math.max(people, 1), maxPeople);
  return round4(((clamped - 1) / (maxPeople - 1)) * 100);
}

/** Compute the full per-booking score breakdown. Pure. */
export function score(
  input: ScoreInput,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  caps: ScoreCaps = DEFAULT_CAPS,
): ScoreBreakdown {
  const ds = distanceScore(input.distanceKm, caps.maxDistanceKm);
  const cs = carpoolScore(input.people, caps.maxPeople);
  const finalScore = round4(weights.distanceWeight * ds + weights.carpoolWeight * cs);
  const people = Math.min(Math.max(Math.trunc(input.people), 1), caps.maxPeople);
  return {
    distanceScore: ds,
    carpoolScore: cs,
    distanceWeight: weights.distanceWeight,
    carpoolWeight: weights.carpoolWeight,
    finalScore,
    people,
  };
}

// ---------------------------------------------------------------------------
// Ranking + tie-breakers
// ---------------------------------------------------------------------------

/** Signals needed to rank one booking against another (decisions §3). */
export interface RankCandidate {
  /** finalScore from `score()`. */
  finalScore: number;
  /** People count (1 + scored members). Tie-breaker 1: more is better. */
  people: number;
  /** Snapshotted distance km. Tie-breaker 2: greater is better. */
  distanceKm: number;
  /** Submission time. Tie-breaker 3: earlier is better. Date or epoch ms. */
  submittedAt: Date | number;
  /** Allocations granted to this user in the previous 30 days. Tie-breaker 4: fewer is better (fairness, D4). */
  allocationsPrev30d: number;
  /**
   * Pre-assigned step-(5) random draw in [0, 1) for deterministic replay. Leave unset on a first
   * run — `rankCandidates` draws a fresh value via `rng` and returns it, which the caller persists
   * into `AllocationScoreBreakdown.tieBreakerData`. On a re-run, set this from the persisted value
   * so the identical tie resolution is reproduced (idempotency, spec §4.5). When set, `rng` is not
   * consulted for this candidate.
   */
  randomDraw?: number;
}

const asMillis = (t: Date | number): number => (t instanceof Date ? t.getTime() : t);

/**
 * Deterministic comparator for tie-breakers (1)–(4) plus the finalScore primary key.
 * Returns <0 if `a` ranks ahead of `b`, >0 if behind, 0 if tied through step (4)
 * (i.e. resolvable only by the step-(5) random draw). Suitable for Array.prototype.sort.
 */
export function compareCandidates(a: RankCandidate, b: RankCandidate): number {
  // Primary: finalScore desc (compared at persisted precision to avoid float noise).
  const fs = round4(b.finalScore) - round4(a.finalScore);
  if (fs !== 0) return fs;
  // (1) more people
  if (a.people !== b.people) return b.people - a.people;
  // (2) greater distance
  if (a.distanceKm !== b.distanceKm) return b.distanceKm - a.distanceKm;
  // (3) earlier submission
  const at = asMillis(a.submittedAt);
  const bt = asMillis(b.submittedAt);
  if (at !== bt) return at - bt;
  // (4) fewer allocations in the previous 30 days
  if (a.allocationsPrev30d !== b.allocationsPrev30d) return a.allocationsPrev30d - b.allocationsPrev30d;
  // fully tied → step (5) random draw, handled by rankCandidates
  return 0;
}

/** Secure unit random in [0, 1). Used for the step-(5) tie-break draw. */
export function secureUnitRandom(): number {
  return randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
}

/**
 * A ranked candidate: the candidate itself, its 1-based rank, and the step-(5) random draw used.
 * Persist `randomDraw` (into `AllocationScoreBreakdown.tieBreakerData`) so every outcome is
 * explainable (decisions §3) and can be replayed deterministically by feeding it back as
 * `RankCandidate.randomDraw` on a re-run.
 */
export interface RankedResult<T> {
  candidate: T;
  /** 1-based position after ranking (rank 1 = best / first-served). */
  rank: number;
  /** The random draw in [0, 1) used for this candidate's step-(5) tie-break. */
  randomDraw: number;
}

/**
 * Rank candidates best-first: finalScore desc, then tie-breakers (1)–(4), then (5) a random draw
 * for any candidates still tied. Returns each candidate with its rank and the draw used, so the
 * caller can persist the draw (explainability) and replay deterministically.
 *
 * Each candidate's draw is `candidate.randomDraw` when set (replay), otherwise `rng()`. `rng` is
 * injectable for tests and defaults to a cryptographically-secure source. Stable: on an exact draw
 * tie, input order is preserved. Does not mutate the input array or its candidates.
 */
export function rankCandidates<T extends RankCandidate>(
  candidates: readonly T[],
  rng: () => number = secureUnitRandom,
): RankedResult<T>[] {
  const decorated = candidates.map((c, index) => ({
    c,
    index,
    r: c.randomDraw ?? rng(),
  }));
  decorated.sort((x, y) => {
    const cmp = compareCandidates(x.c, y.c);
    if (cmp !== 0) return cmp;
    if (x.r !== y.r) return x.r - y.r; // (5) random draw
    return x.index - y.index; // stable fallback when the draw ties
  });
  return decorated.map((d, i) => ({ candidate: d.c, rank: i + 1, randomDraw: d.r }));
}
