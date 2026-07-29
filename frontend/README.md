# frontend — API codegen bootstrap (P3-10)

This is the **contract-generated** frontend foundation. Atharva's Vite scaffold (P5-01) merges on top of this
(adds React, Tailwind, router, etc.) — it should keep the `src/api` and `src/mocks` layout.

## Generated from `../backend/openapi.yaml` (the frozen contract)
| Path | What | How |
|------|------|-----|
| `src/api/types.ts` | Typed request/response models for every endpoint | `npm run gen:types` (openapi-typescript) |
| `src/api/client.ts` | `openapi-fetch` typed client (`api`) + `setAccessToken()` | hand-written wrapper |
| `src/mocks/handlers.js` | 38 MSW request handlers (faker data) | `npm run gen:mocks` (msw-auto-mock) |
| `src/mocks/{browser,node}.js` | MSW `worker` / `server` setup | generated |

Regenerate everything after a contract change: `npm run gen:api`.

## Usage (once the Vite app exists)
```ts
import { api, setAccessToken } from './api/client';
const { data, error } = await api.POST('/auth/login', { body: { email, password } });
```
Mock-first dev (browser): after `npx msw init public/`, start the worker in dev:
```ts
import { worker } from './mocks/browser';
if (import.meta.env.DEV) await worker.start();
```

## Running against the live backend (P5-13)

The app is mock-first by default. To run the hero flow (login → book → run allocation →
breakdown → config) against the real backend instead of MSW:

1. Start the backend so it serves `http://localhost:4000/api/v1` (seed a super-admin +
   a company + slots/quota so allocation has data).
2. In `frontend/`, copy `.env.example` → `.env` and enable the live path (recommended,
   proxy-based, no CORS):
   ```
   VITE_USE_MOCKS=false
   VITE_API_PROXY_TARGET=http://localhost:4000
   ```
3. `npm run dev` and sign in. With mocks off, every request hits the live API through the
   Vite proxy; MSW never starts (see `src/main.tsx`).

Setting `VITE_API_BASE_URL` to an absolute URL also disables MSW and points the client
straight at that origin (backend CORS must allow it). The config screen uses the real
backend keys (`booking.*`, `allocation.*`, …), so it drives both MSW and the live API
unchanged.

## Notes
- `types.ts` and the `mocks/*.js` are generated artifacts, committed for review and so teammates don't need
  to run codegen to start. Re-run `gen:api` whenever `openapi.yaml` changes.
- Refresh-token rotation is [MVP]; the client sends `credentials: 'include'` so the HttpOnly refresh cookie
  flows once the backend sets it.
