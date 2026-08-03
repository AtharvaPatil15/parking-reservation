# Industry UI reskin — design

**Date:** 2026-08-03
**Scope:** Frontend presentation only. Restyle the existing React app to the "Industry"
design system delivered in `C:\Users\AtharvaP\Downloads\Parking reservation redesign`.

## Goal

Adopt the redesign's visual language across all 16 routes without changing application
behavior. The app should look like the mockups; it should behave exactly as it does today.

## Hard boundary — what must not change

These are the constraints that define the work. A change here means the reskin is wrong.

- `src/api/**` — no edits. No hook, query key, client, or generated type touched.
- `src/mocks/**` and `backend/**` — no edits.
- `src/app/router.tsx` — no route added, removed, renamed, or reordered.
- Form schemas — `bookingSchema.ts`, `registerSchema.ts`, `configValidation.ts` unchanged.
- `lib/auth.tsx`, `lib/guards.tsx`, `lib/roles.ts` — unchanged.
- No component's props contract changes, so no call site's logic changes.
- **All 165 tests in 36 files must pass without being edited.** Baseline captured
  2026-08-03 before any change: 36 passed / 165 passed. If a test fails, fix the code,
  never the test.

Permitted: CSS tokens, Tailwind config, `className` values, presentational markup
(wrappers, corner marks, headings), and the new sidebar chrome.

## Decisions

Recorded because the delivered designs are internally inconsistent and the choices were
not self-evident.

### 1. Sidebar: dark steel rail everywhere

The redesign ships two rails. `AppSidebar` is a light text-only rail used by the Employee
Flow; `AppSidebarClassic` is a 248px dark steel rail with icons and counts, used by the
Company Admin and both Super Admin flows.

**Chosen:** `AppSidebarClassic` for all roles. It is what 3 of 4 flow mockups show, and its
icons, role code, and item counts serve the admin-heavy screens. One consistent nav.

Note: `AppSidebarClassic`'s source comment calls itself "the original steel rail, kept for
the three files still on the dense blueprint design," implying the light rail was the newer
direction. That was weighed and set aside in favor of consistency with the majority of
flows and with decision 2.

### 2. Visual grammar: blueprint everywhere

The delivered files contain two languages:

- **Employee Flow** — "minimal and spatial: panels carry no borders or corner marks — they
  float on a recessive ground in three depth planes." 0 corner marks.
- **Three admin flows** — dense blueprint: hairline-bordered panels with `+` registration
  marks. 70 corner marks total.

**Chosen:** blueprint for all screens. It matches the rail from decision 1, covers 3 of 4
flows as drawn, and is what the Industry `readme.md` mandates ("Do not drop the
registration marks from a framed element"). The 6 employee screens are translated into
blueprint.

### 3. Terminology: new intent, existing words

The mockups rename UI nouns. **Existing terminology is kept so current users are not
confused.** Structural ideas from the design (kicker line, crumb strip, tabular figures,
metric plate) are adopted; the nouns are not.

| Mockup says | App keeps |
| --- | --- |
| "Today" / "Overview" | **Dashboard** |
| "Quota blocks" | **Blocks** |
| "User approvals" | **Approvals** |
| "Allocation" as `/admin` home | **Weekly run** (`/admin` index) + **Run by date** |
| "bay B-014" | **slot** |

`Admin requests`, `Companies`, `Slots`, `Config`, `Book a slot`, `My bookings`, and
`History` already match and are unchanged.

### 4. Unmocked routes: restyle by extrapolation

`/security` (GateConsole), `/company/allocations`, and `/admin` (WeeklyRun — the mockup
shows an "Allocation" screen instead) have no mockup. They receive the same tokens,
typography, and panel grammar, keeping their existing layout, labels, and behavior.

### 5. Dark mode: preserved

Industry defines no dark ramp, but the mockups derive one for their own chrome. Those
derived values are ported into the theme tokens so the existing toggle keeps working. No
dark values are invented.

### 6. Declined from the mockups

Both are information-architecture changes, not UI, and both would alter behavior:

1. **Merging `/company` with `/company/approvals`** (mockup `1m`). Both routes stay
   separate and keep their current content.
2. **The 3-step register wizard on mobile** (mockup `1b`). `/register` stays one form;
   splitting it would change the validation flow.

## Architecture

The token layer already in place is the seam that makes this safe. `theme.css` holds
tokens, `tailwind.config.ts` maps them to utilities, components consume utilities. Token
*names* do not change — only their values — so component structure need not change.

The design system's own `styles.css` is **not** imported, and its `.btnp` / `.bp` class
names are not introduced. Doing so would create two parallel styling systems. Its *values*
are ported into the existing tokens instead.

### Tokens

From the mockups' semantic layer, both modes:

| App token | Light | Dark | Mockup source |
| --- | --- | --- | --- |
| `--canvas` | `#dcdde0` | `#0c0e10` | `--pg` |
| `--surface` | `#f2f2f3` | `#15181b` | `--sf` |
| `--surface-2` | `#e9e9ea` | `#1c2024` | `--sf1` |
| `--border` | `rgba(29,31,32,.20)` | `rgba(232,234,236,.17)` | `--ln2` |
| `--text` | `#1d1f20` | `#e8eaec` | `--ink` |
| `--text-muted` | `#5c5d60` | `#939497` | `--ink2` |
| `--primary` | `#416180` | `#7ba3cc` | `--acc-solid` |
| `--primary-hover` | `#2c455d` | `#8fb3d8` | `--acc-solid-h` |
| `--primary-subtle` | `#eef6ff` | `#1b2836` | `--acc-t` |

Steel accent replaces blue `#1F5EDC`. Status colors (`success`/`warning`/`danger`) are
retuned for the new ground but keep their roles — `statusTone.ts` maps booking states onto
them, so their meaning must not shift.

Additions for the rail: `--field`, `--field-ink`, `--field-ink2`, `--field-ink3`,
`--field-ln`, `--field-ln2`, `--field-acc`.

### Type

Barlow Condensed headings over Barlow body, **self-hosted** via `@fontsource` rather than
the design system's Google Fonts `@import` — a CDN `@import` in `index.css` is
render-blocking and fails offline. Falls back to `system-ui`.

### Geometry

`borderRadius.control` and `borderRadius.card` both become `0`. Square corners are the
system's defining move, and this single config change reskins every control.

### Blueprint frame

A new presentational `<Blueprint>` in `components/` renders the hairline border plus four
corner registration marks. `Card` composes it internally, so all existing `<Card>` usages
gain the frame with no call-site edits. Cards become transparent line drawings; the primary
button remains the one solid accent object.

### Density

The mockups run tighter than the app (34px controls vs 40px, 13.5px body vs 14px). Adopted
via `fontSize` and spacing tokens, with two floors held: hit targets do not go below 34px,
and keyboard focus keeps the 2px accent `:focus-visible` ring the system mandates.

## Chrome — the one structural change

Today: sticky top bar plus hamburger drawer. New: persistent 248px dark steel rail plus a
52px crumb strip showing `Role / Section` on the left and context on the right.

This reuses the existing seam. `useNavDrawerItems()` already lets role shells register nav
items; the sidebar renders those items differently. `AppShell.tsx` and `chrome.tsx` change;
`UserShell` / `CompanyShell` / `AdminShell` keep their labels and only gain icon keys.
Routing is untouched.

Below 1024px the rail collapses to the off-canvas drawer, reusing the existing `Drawer`
component and its open/close state, so mobile does not regress.

## Components

14 files in `components/`, each a restyle with no props change:

| Component | Treatment |
| --- | --- |
| `Card` | Composes `Blueprint`; transparent, square, `.chd`-style header with monospace meta slot |
| `Button` | Square, Barlow Condensed; accent fill primary, hairline secondary |
| `Input`, `Select` | 34px, `--surface-2` fill, hairline border, 10px uppercase label |
| `Table` | Monospace uppercase headers, hairline row rules, `tabular-nums` |
| `Badge` | Square tag from the accent/neutral ramps |
| `Modal` | `.dialog` grammar at top elevation, with blueprint frame |
| `SlotGrid` | Plan-view treatment. **Only file with class-based tests — preserve queryable structure.** |
| `StatTiles` | The `.plate` grid: one bordered plate of equal cells, large condensed figures |
| `Drawer`, `Toast`, `Spinner`, `Pager`, `States` | Token and geometry pass |

## Screens

Each of the 16 routes gets the kicker + `h1` + sub header pattern and its mockup's layout,
retaining existing copy and data bindings.

Mockup coverage: Employee Flow (`/login`, `/register`, `/app`, `/book`, `/booking/:id`,
`/my-bookings`), Company Admin Flow (`/company`, `/company/blocks`), Super Admin
Operations (`/admin/allocation`, `/admin/dashboard`), Super Admin Administration
(`/admin/companies`, `/admin/slots`, `/admin/admin-requests`, `/admin/config`).
Extrapolated: `/security`, `/company/allocations`, `/admin`.

## Phasing

Tests run at each phase so breakage is caught against a small diff.

1. **Tokens and type** — `theme.css`, `tailwind.config.ts`, `index.css`, fonts.
2. **Components** — the 14 files, plus new `Blueprint`.
3. **Chrome** — sidebar, crumb strip, shells' icon keys.
4. **Screens** — the 16 routes.

## Verification

- `npx vitest run` — 36 files / 165 tests green, **unedited**.
- `npm run build` — clean `tsc -b` and Vite build.
- `npx eslint . --ext .ts,.tsx` — clean.
- Launch the app and view every route in both light and dark mode.

## Risks

- **Visual jump.** Steel / condensed / square is a large departure from blue / Inter /
  rounded. Intended, but users will notice immediately.
- **Darker ground.** `--canvas` at `#dcdde0` is notably darker than today's near-white.
  Required for transparent line-drawing cards to read.
- **Contrast.** Industry's accent-to-ground pair is tuned to ~3:1 — adequate for chrome and
  large text, not for body copy. Body text in accent must use a deep ramp step
  (`--color-accent-700` or darker on the light ground).
- **`SlotGrid` tests.** The one component whose tests inspect classes; its structure needs
  care during restyle.
