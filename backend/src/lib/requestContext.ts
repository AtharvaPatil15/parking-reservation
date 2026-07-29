import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request context available to services (for audit): actor + ip + correlation id. */
export interface RequestContext {
  actorUserId?: string;
  ip?: string;
  correlationId?: string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}
