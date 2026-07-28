# Implementation Plan — Task Tracker (source of truth)

This folder is the **executable plan** for the Parking POC. The design specs live one level up
([`../decisions.md`](../decisions.md), [`../phase-1-requirements-architecture.md`](../phase-1-requirements-architecture.md),
[`../phase-2-database-design.md`](../phase-2-database-design.md), [`../phases-3-6-plan.md`](../phases-3-6-plan.md),
[`../notification-service-plan.md`](../notification-service-plan.md)); **this folder is what we build against
and check readiness against.**

## Files
| File | Phase | Primary owner(s) |
|------|-------|------------------|
| [`phase-3-api.md`](phase-3-api.md) | API contract (`openapi.yaml`) | Devashish (lead) + Prithviraj |
| [`phase-4-backend.md`](phase-4-backend.md) | Backend | Devashish (platform/admin) · Prithviraj (booking/allocation) |
| [`phase-5-frontend.md`](phase-5-frontend.md) | Frontend | Atharva |
| [`phase-6-setup.md`](phase-6-setup.md) | Setup & deploy | Devashish + shared |

## How each phase file is organized
Every phase has: **Goal → Owners → Entry criteria → Task list → Phase Definition of Done.**
Each **task** is a self-contained, checkable unit:

```
#### <ID> · <title>  ·  Owner: <name> · Tag: <DEMO|MVP|Later> · Deps: <IDs>
<one-line description>
- **AC:** <acceptance criteria — concrete, verifiable>
- **Evidence:** <where a reviewer/agent looks in the codebase>
- **Status:** ☐
```

### Legends
- **Task ID:** `P<phase>-<nn>` (e.g. `P4-13`).
- **Status:** ☐ not started · ◐ in progress · ☑ done · ⊘ deferred (Later, intentionally not built yet).
- **Tag:** `DEMO` (in the 30 Jul hero-flow demo) · `MVP` (full first version) · `Later` (subsequent).

### Rule of the repo
When you finish a task, **tick its checkbox in the phase file and commit it in the same PR as the code.**
The plan and the code stay in sync, so a readiness check is always meaningful.

## Ownership summary
- **Atharva** → all of Phase 5 (UI: design, dev, tests).
- **Devashish** → Phase 3 contract (lead), Phase 4 foundation + auth + companies/users/slots/quota/blocking +
  config + dashboards + audit, Phase 6.
- **Prithviraj** → Phase 4 allocation engine + booking + scheduler + notifications + backend integration tests.

## Frozen contracts (don't drift without a reviewed change)
1. **DB schema** — [`../../prisma/schema.prisma`](../../prisma/schema.prisma) (done, validated).
2. **API contract** — `backend/openapi.yaml` (produced in Phase 3, frozen at M0).
3. **Decisions** — [`../decisions.md`](../decisions.md) (quota model, scoring formula §3, no geolocation,
   Mon–Fri, configurable timings D8).

---

## Running a readiness / gap check
Point an agent (or a teammate) at your codebase and this folder. Copy-paste prompt:

> **Hi, I'm `<name>`.** Please read my codebase at `<repo path>` and check it against `docs/plan/` — our main
> implementation plan — and the frozen contracts (`prisma/schema.prisma`, `backend/openapi.yaml`,
> `docs/decisions.md`).
>
> For **my assigned tasks** (Owner: `<name>`), report each task as **DONE / PARTIAL / MISSING** with
> **evidence** (`file:line`) mapped to its Acceptance Criteria. Then give me:
> 1. **Gaps** — ACs not yet met, ranked by what blocks the demo hero flow.
> 2. **Diffs** — anything implemented that contradicts a frozen contract or a decision (e.g. wrong scoring
>    weights, missing tenant scoping, hardcoded timings).
> 3. **Scope drift** — code that isn't in the plan.
>
> Only judge against DEMO-tagged tasks unless I say otherwise.

### What a good readiness answer looks like
- A table of your tasks with status + evidence + the specific gap.
- Contract diffs called out explicitly (schema field mismatch, endpoint shape ≠ `openapi.yaml`, scoring ≠
  decisions §3, timing hardcoded instead of `SystemConfiguration`).
- A short "to be demo-ready you still need: …" list.

### Demo-readiness bar (what "ready" means on 30 Jul)
All **DEMO**-tagged tasks are ☑, the golden path runs on one `docker compose up`, and the allocation scoring
unit tests pass. Everything else may be ☐/⊘ without blocking the demo.
