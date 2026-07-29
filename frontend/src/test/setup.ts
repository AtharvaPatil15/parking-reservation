import '@testing-library/jest-dom';
import { afterAll, afterEach } from 'vitest';
import { server } from '../mocks/node';
import { resetMockData } from '../mocks/handlers';

// jsdom doesn't implement matchMedia; stub it so components that read the OS theme
// preference render in tests.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// Global MSW node server lifecycle — 'bypass' keeps non-network tests unaffected.
// listen() runs eagerly (not inside beforeAll) so it patches globalThis.fetch before this
// file's importer (the test file, and anything it imports, e.g. the singleton API client)
// evaluates — otherwise openapi-fetch's `fetch: globalThis.fetch` default binds to the
// pre-MSW fetch at module-load time and every request bypasses the mock server.
server.listen({ onUnhandledRequest: 'bypass' });
afterEach(() => server.resetHandlers());
// Restore mutable mock state (bookings/config/companies/... mutated by stateful
// handlers) so one test's release/PATCH/approval can't leak into the next.
afterEach(() => resetMockData());
afterAll(() => server.close());

// Reset the API client's module-level singletons between tests — otherwise a token set
// (or an unauthorized handler registered) by one test can leak into an unrelated test.
// Imported dynamically, *after* server.listen() above, so this module's own top-level
// `createClient()` call (in ../api/client) doesn't run — and capture the pre-MSW
// `globalThis.fetch` — before MSW has patched it. A static import here would resolve
// before this file's own `server.listen()` statement runs (import resolution always
// precedes a module's other top-level statements), reintroducing the bug that eager
// `listen()` above was written to avoid.
const { setAccessToken, registerUnauthorizedHandler } = await import('../api/client');
afterEach(() => {
  setAccessToken(null);
  registerUnauthorizedHandler(null);
});
