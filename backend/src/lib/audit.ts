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
 * Write an AuditLog row (P4-10). Actor / ip / correlationId come from the request-scoped
 * AsyncLocalStorage context. Best-effort: a failed audit write is logged, never throws
 * (must not break the underlying mutation).
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const ctx = getRequestContext();
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: ctx?.actorUserId ?? null,
        actionType: entry.actionType,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as Prisma.InputJsonValue),
        newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
        ipAddress: ctx?.ip ?? null,
        correlationId: ctx?.correlationId ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, actionType: entry.actionType }, 'Failed to write audit log');
  }
}
