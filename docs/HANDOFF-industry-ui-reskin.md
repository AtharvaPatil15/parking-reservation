# Handoff — Industry UI reskin (`feat/industry-ui-reskin`, PR #46)

**Written:** 2026-08-05
**Branch:** `feat/industry-ui-reskin` @ `5ace367` (pushed; local == remote)
**PR:** [#46](https://github.com/Pranayku/parking-reservation/pull/46) — **DRAFT**, titled `[DO NOT MERGE]`
**Status:** 12 commits ahead of `origin/master`, **11 behind**. `mergeable_state: dirty` (14 conflicts).

> **Standing constraint from the branch owner: never merge this PR to `master`, and never push to
> `master`.** It is a style-only preview, deliberately kept as a draft so GitHub disables the merge
> button. Keep it that way unless the owner says otherwise.

---

## 1. What this branch is

Restyles the frontend to the **"Industry" design system** delivered in
`C:\Users\AtharvaP\Downloads\Parking reservation redesign` (not in the repo — it's a local folder of
`.dc.html` mockups plus `_ds/industry-*/styles.css`).

The look: near-white technical ground, one steel-blue accent, **square corners**, hairline-bordered
transparent panels wearing `+` **corner registration marks**, Barlow Condensed headings over Barlow,
and a **persistent dark left nav rail** that replaced the old top bar.

Full design rationale and the decisions taken:
[`docs/superpowers/specs/2026-08-03-industry-ui-reskin-design.md`](superpowers/specs/2026-08-03-industry-ui-reskin-design.md).

### Scope rules this branch has followed

**Untouched on purpose:** `backend/**`, `src/mocks/**`, `src/app/router.tsx`, form schemas
(`bookingSchema`, `registerSchema`, `configValidation`), `lib/auth`, `lib/guards`, `lib/roles`, and
**every `*.test.ts(x)` — no test has been edited to make anything pass.** When a test failed, the
code was fixed instead. Please keep this rule; it's the main reason the branch is trustworthy.

**Two deliberate exceptions**, both requested or justified:
1. `src/api/hooks/` — pagination standardised to `DEFAULT_PAGE_SIZE = 10` (`src/api/pagination.ts`).
2. `AppShell` hamburger gating — a functional bug fix (see §5).

---

## 2. Commits on the branch (oldest → newest)

| SHA | What |
|---|---|
| `d08c10b` | docs: the design spec |
| `aa6f9ab` | Industry tokens, type scale, component grammar (`Blueprint`, square corners, Barlow) |
| `a994c60` | Replace top bar with the steel rail + crumb strip |
| `ae60908` | Drop registration marks from the modal panel |
| `e627350` | **Correct the app ground** (the big one — see §3), full-bleed, type scale |
| `6b46fc6` | Cap/centre content column; wide tables scroll on mobile |
| `95d5606` | Left-align content; rebuild the user dashboard hero |
| `187e2c8` | Make back links visible and left-aligned |
| `c6f6c11` | **merge origin/master (Phase 8)** — 23 upstream commits |
| `c9821af` | Fix findings from 3 code reviews (nav blocker, contrast, focus, drift) |
| `1fb2234` | Populate the rail for every role and page (`roleNav.ts`, live counts) |
| `5ace367` | Fix findings from 3 visual/UI audits (mobile tables, disabled buttons, dark mode) |

---

## 3. The one thing to understand before touching the CSS

The redesign's CSS has **two greys and they are easy to swap**:

- `--pg` `#dcdde0` (darker) is the **design-doc desk** — the surface the mockup screenshot sits on.
- `--sf` `#f2f2f3` (near-white) is `.frame`, the **actual app window**.

Panels are `background: transparent`, so they read as **white against the near-white app**. An early
version of this branch mapped the app body to `--pg`, which made every panel grey and produced three
separate complaints ("the white background is missing", "fonts don't match", "doesn't fill the
screen"). Fixed in `e627350`. **Do not reintroduce `#dcdde0` as the app background.**

Tokens live in `frontend/src/styles/theme.css`; Tailwind maps them in `tailwind.config.ts`. The
design system's own `styles.css` is deliberately **not** imported — its *values* were ported into the
existing token layer instead, so there is only one styling system.

---

## 4. IMMEDIATE TASK A — merge `origin/master` (11 commits, 14 conflicts)

Surveyed on 2026-08-05 in a throwaway worktree. Fork point: `cf4252d`.

### Upstream commits you'll be pulling in

```
1eba0f0  Merge PR #47 from phase-8
c7fdd0f  fix: reduce default page size from 20 to 10 in allocations and bookings
d2ba4bf  Merge PR #45 fix-scheduler-band-anchor
27d58d6  Merge PR #44 feat/phase8-followup
a42de67  fix(ui): unwrap slot labels, align hinted fields, always show nav, land on dashboards
2087752  fix(a11y): style navigation links as buttons instead of nesting button in anchor
044add3  fix(ui): readable long countdown, align card insets, harden modal and pager
439622d  fix(allocation): anchor the automatic run on the slot it fires for
6d8319e  fix(ui): live run countdown, admin details popup, shared pager, mobile fits
```

### Conflicted files, with hunk counts

| File | Hunks | Guidance |
|---|---|---|
| `app/AppShell.tsx` | 2 | ⚠️ **See trap #1 below** |
| `app/roleNav.ts` | 1 | ⚠️ **See trap #2 below** |
| `features/user/UserDashboard.tsx` | 3 | Take upstream logic, re-apply the hero plate |
| `components/Modal.tsx` | 3 | Take upstream's flex/scroll hardening; keep square corners, no corner marks |
| `components/Card.tsx` | 2 | Take upstream's responsive insets; keep `Blueprint` + transparent fill |
| `components/Table.tsx` | 2 | ⚠️ **See trap #3 below** |
| `components/Button.tsx` | 1 | Keep our `disabled:` treatment and `text-primary-ink` (§5) |
| `components/SlotGrid.tsx` | 1 | Keep upstream's real-slot-number logic + our condensed numerals |
| `features/shared/BookingList.tsx` | 1 | Take upstream; re-apply `stackedBare` on identity/action columns |
| `features/superadmin/AdminShell.tsx` | 1 | Should just read `ROLE_NAV.SUPER_ADMIN` |
| `features/companyadmin/CompanyShell.tsx` | 1 | Should just read `ROLE_NAV.COMPANY_ADMIN` |
| `features/user/UserShell.tsx` | 1 | Should just read `ROLE_NAV.USER` |
| `api/hooks/allocation.ts` | 1 | Trivial — both sides moved 20 → 10; keep `DEFAULT_PAGE_SIZE` |
| `api/hooks/bookings.ts` | 1 | Same |

**General rule that has worked twice on this branch:** where upstream rewrote *logic*, **take
upstream wholesale and re-apply the reskin on top as styling.** Do not hand-merge Phase 8 logic.

### ⚠️ Trap #1 — `AppShell.tsx`: upstream still has a `TopBar`

`origin/master`'s `AppShell` renders `<TopBar />`. Ours renders the dark rail (`AppSidebar`) plus a
52px crumb strip. **A careless "accept theirs" silently deletes the reskin's single most visible
change.** Keep our side; port anything genuinely new from their `TopBar` into the rail instead (that
is exactly how the rail gained its `/profile` link during the previous merge).

### ⚠️ Trap #2 — `roleNav.ts`: both sides created this file independently, and **upstream changed the admin routes**

Upstream restructured super-admin routing:

| Route | Ours (`5ace367`) | Upstream (`origin/master`) |
|---|---|---|
| `/admin` index | `WeeklyRun` | **`SuperAdminDashboard`** |
| `/admin/weekly-run` | *does not exist* | **`WeeklyRun`** (new) |

So our `ROLE_NAV.SUPER_ADMIN` — which labels `/admin` as "Weekly run" — becomes **factually wrong**
after the merge. Take **upstream's route/label structure** (including the new `/admin/weekly-run`
entry and their per-role `Profile` item), then re-add **our** additions:
- `icon:` on every item (`navIcons.tsx`),
- `dividerBefore: true` on the first cross-role booking link,
- `count?:` support, fed by `useNavCounts.ts`.

Also reconcile: ours puts `Profile` in the rail's **account footer** for all roles; upstream puts a
`Profile` item in each role's nav list. Pick one — don't ship both, or it appears twice.

### ⚠️ Trap #3 — `Table.tsx`: do not "simplify" the two layouts back into one

`Table` renders **either** a stacked card list (< 768px) **or** a real `<table>` (≥ 768px), chosen in
JS via `lib/useMediaQuery.ts` — never both. This looks like it could be done with
`hidden md:block`, and that was the first attempt. It **broke 31 tests**, and for a real reason:
rendering both puts every cell in the DOM twice, so a screen reader announces each row twice.

Related: `lib/useMediaQuery.ts` deliberately falls back to `defaultValue` when `matchMedia` can't
really answer. jsdom's stub in `src/test/setup.ts` answers `false` to *every* query, which for a
`min-width` query would wrongly mean "narrow" and render the mobile layout in all tests. The hook
detects that by also querying the negation. Keep that guard.

---

## 5. IMMEDIATE TASK B — 4 unresolved Copilot review comments on PR #46

All four are legitimate. All are still open as of 2026-08-05.

**1. `features/shared/SlotSplit.tsx:69` — rounding makes small segments vanish.**
`share()` rounds to an integer and is used for the bar's segment **widths**, so a small non-zero
category can render at `0%` width and disappear, misrepresenting the counts.
*Fix:* use the unrounded percentage for widths; keep rounding only for the displayed label.
[thread](https://github.com/Pranayku/parking-reservation/pull/46#discussion_r3711671726)

**2. `features/superadmin/SuperAdminDashboard.tsx:36` — page heading is still `h2`.**
Nine other pages were promoted to `h1`; these two dashboards were missed. Since the rail carries an
`h1` for the role, the page title must also be `h1`.
[thread](https://github.com/Pranayku/parking-reservation/pull/46#discussion_r3711671764)

**3. `features/companyadmin/CompanyDashboard.tsx:37` — same `h2` problem.**
[thread](https://github.com/Pranayku/parking-reservation/pull/46#discussion_r3711671796)

**4. `styles/theme.css:50` — comment is factually wrong.**
It claims the rail tokens are "identical in both modes", but the dark block *does* override
`--field`, `--field-ink*` and `--field-accent`. Either make them identical or fix the comment.
(The dark overrides are intentional — so fix the comment.)
[thread](https://github.com/Pranayku/parking-reservation/pull/46#discussion_r3711671832)

### How to reply

Reply **inline in each review thread** (GitHub MCP `add_reply_to_pull_request_comment`, or the
thread's Reply box), saying what changed and in which commit. **Do not post standalone PR comments** —
that is an explicit preference of the branch owner. After pushing, re-request the Copilot review.

---

## 6. Bugs this branch fixed that you must not regress

These were found by review/audit and each one is easy to undo by accident.

| Fix | Why it matters |
|---|---|
| **Hamburger is unconditional** (`AppShell`) | It used to be gated on the role shell registering nav items. Five routes mount `AppShell` with no role shell (`/security`, `/book`, `/booking/:id`, `/my-bookings`, `/profile`), so below `lg` they had no nav — and **SECURITY, whose only route is `/security`, could not sign out at all, at any width.** |
| **Mobile tables stack** (`Table`) | The scrolled table sliced status pills in half and pushed Approve/Reject/Details off-screen with no affordance. **A company admin could not approve anyone on a phone.** |
| **`disabled:` drops the fill** (`Button`) | `opacity-45` on a steel button still read as a paler steel button, so "unavailable" and "primary action" looked identical. |
| **`--primary-ink` token** | Dark mode's primary fill is *pale*, so `text-surface` (near-black there) made the primary button look ghosted/disabled. |
| **`color-scheme` per theme** (`index.css`) | Without it, native date/select controls keep light UA chrome in dark mode — a white box was the brightest object on several dark screens. |
| **Rail-scoped focus ring** (`index.css`) | `ring-offset-canvas` is invisible on the rail: in dark mode `--canvas` and `--field` are 1.06:1 apart. |
| **`--accent` at ramp step 700** | Step 500 measured 3.71:1 on the ground and 3.36:1 on `--accent-subtle`, both under 4.5:1, while carrying body-size text. |
| **Occupancy bar steps off ink** (`SlotSplit`) | `bg-primary` is pale in dark mode, so "Booked" became the *lightest* segment and the full→empty ramp ran backwards. |
| **`enumLabel()`** (`lib/enumLabel.ts`) | `COMMON_POOL` / `COMPANY_EVENT` were reaching employees verbatim. |
| **`bg-surface-muted` → `bg-surface-2`** | That class has never existed, so the "next 5 runs" chips rendered with no fill. |

---

## 7. Known-open items (not blockers, owner's call)

From the visual audit — these are **design decisions**, not defects:

1. **Security gate screen is under-designed.** It's a tablet at a barrier; targets should be far
   larger and the plate field is currently behind a click. It is also ~65% empty.
2. **Several screens sit two-thirds empty** (`/security`, `/my-bookings`).
3. **Form rows don't share a baseline** — a field with hint text is taller than one without, so
   `items-end` rows stagger. Worst: "Add company" (`Companies.tsx`), "Add area" (`Slots.tsx`),
   `Blocks.tsx`. Upstream added an `Input` `hintReserve` prop that may already solve this — check
   after merging.
4. **A few `+` corner marks are misaligned** by a pixel or two, and two panels side by side can have
   marks at different heights.
5. **Missing mono eyebrow/kicker** above the `h1` on ~10 screens; only the dashboards have it.

---

## 8. How to run and verify

```bash
cd frontend
npm install                 # if the CodeArtifact token has expired, see the note below
npm run dev -- --port 5173 --strictPort
```

**Sample logins** (`frontend/SAMPLE_LOGINS.md`): MSW mocks pick the role from the **email prefix**,
any non-empty password.

| Role | Email |
|---|---|
| Super admin | `admin@acme.test` |
| Company admin | `company@acme.test` |
| Security | `security@acme.test` |
| Employee | `user@acme.test` |

### The verification gate this branch has held to

```bash
npx tsc -b                      # clean
npx vitest run                  # 201/201, and NO test file edited
npm run build                   # clean
npx eslint . --ext .ts,.tsx     # 0 errors (6 pre-existing react-refresh warnings are fine)
```

Then **actually drive the app in a browser** — screenshots of static page loads are not enough. Two
real bugs (clipped modal corner marks; unreachable mobile actions) were only visible when clicking
through. Check both themes and 390 / 1280 / 1920 widths.

### Gotchas when driving it with Playwright

- **Auth is in `sessionStorage`**, not `localStorage`. `/login` redirects to the role home when a
  session exists, so **clear `sessionStorage` before each login** or every login after the first
  finds no form. This cost an hour once: 12 "failures" that were all the harness, not the app.
- **"Sign out" lives in the rail**, which is hidden below `lg`. At mobile widths wait on the
  "Open navigation menu" button as the signed-in signal instead.
- **Don't screenshot immediately after a navigation** — you can catch a mid-transition frame. A
  "blank login page" was reported by three reviewers and was purely this.
- Dev server drifts to 5174/5175 if 5173 is taken; kill strays and use `--strictPort`.

### Environment notes

- **npm CodeArtifact token expires.** If `npm install` fails with `E401`, fall back to
  `--registry=https://registry.npmjs.org/`.
- **The test suite is flaky under parallel load** — `GateConsole`, `AdminApprovals` and
  `BookingStatus` have each timed out once in a full run and passed in isolation. Pre-existing, not
  caused by this branch. Re-run before assuming a real failure.
- Verified against **MSW mocks only**, never against the live backend (`VITE_USE_MOCKS=false`).

---

## 9. Untracked files in the working tree

`docs/DEMO_FAQ.md` and `docs/PROJECT_OVERVIEW.md` are untracked and were **not** created by this
work. They have been deliberately left alone — decide whether they belong in a commit.

---

## 10. Suggested order of work

1. Merge `origin/master`, minding traps #1–#3 (§4). Commit the merge on its own.
2. Fix the 4 Copilot comments (§5). Note #2 and #3 may already be touched by the merge.
3. Run the full gate (§8), including a real browser pass in both themes.
4. Push, then reply **inline** to each of the 4 threads with the commit SHA, and re-request Copilot.
5. Leave PR #46 as a **draft** titled `[DO NOT MERGE]`.
