import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getRequestContext } from './requestContext';
import { logger } from './logger';

export interface AuditEntry {
  actionType: string; // e.g. CONFIG_UPDATED, USER_APPROVAL, SLOT_BLOCKED
  entityType: string; // e.g. SystemConfiguration, User, SlotBlock
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Build the AuditLog create-input from an entry + the request-scoped AsyncLocalStorage context
 * (actor / ip / correlationId). Pass the result to `tx.auditLog.create({ data })` so the audit
 * row is written **inside the same transaction** as the mutation it records (atomic — P4-10).
 */
export function buildAuditData(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  const ctx = getRequestContext();
  return {
    actorUserId: ctx?.actorUserId ?? null,
    actionType: entry.actionType,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as Prisma.InputJsonValue),
    newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
    ipAddress: ctx?.ip ?? null,
    correlationId: ctx?.correlationId ?? null,
  };
}

/**
 * Best-effort standalone audit write (logs on failure, never throws). Prefer `buildAuditData`
 * inside the mutation's transaction; use this only for non-transactional/side-channel audits.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: buildAuditData(entry) });
  } catch (err) {
    logger.error({ err, actionType: entry.actionType }, 'Failed to write audit log');
  }
}
