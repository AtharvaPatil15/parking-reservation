import '@testing-library/jest-dom';
import { afterAll, afterEach } from 'vitest';
import { server } from '../mocks/node';

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
afterAll(() => server.close());
