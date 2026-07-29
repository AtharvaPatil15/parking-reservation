import { prisma } from '../../lib/prisma';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { Role } from '../../lib/roles';

const userInclude = { roles: { include: { role: true } }, company: true } as const;

interface Actor {
  id: string;
  role: Role;
  companyId: string;
}

/** Load a target user, enforcing tenant scope for non-super-admins (resource-level scoping). */
async function loadTargetUser(actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: userInclude,
  });
  if (!user) throw new NotFoundError('User not found');
  if (actor.role !== 'SUPER_ADMIN' && user.companyId !== actor.companyId) {
    // Hide cross-tenant existence — behave as not found.
    throw new NotFoundError('User not found');
  }
  return user;
}

export async function setApproval(actor: Actor, userId: string, decision: 'APPROVE' | 'REJECT') {
  const user = await loadTargetUser(actor, userId);
  if (user.status !== 'PENDING') {
    throw new ValidationError('Only PENDING users can be approved or rejected');
  }
  const newStatus = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
  await prisma.user.update({ where: { id: userId }, data: { status: newStatus } });
  await recordAudit({
    actionType: 'USER_APPROVAL',
    entityType: 'User',
    entityId: userId,
    oldValue: { status: user.status },
    newValue: { status: newStatus, decision },
  });
  return prisma.user.findFirstOrThrow({ where: { id: userId }, include: userInclude });
}

export async function setStatus(actor: Actor, userId: string, status: 'ACTIVE' | 'INACTIVE') {
  const user = await loadTargetUser(actor, userId);
  if (user.status === 'PENDING' || user.status === 'REJECTED') {
    throw new ValidationError(`Cannot set status from ${user.status}; approve or reject first`);
  }
  await prisma.user.update({ where: { id: userId }, data: { status } });
  await recordAudit({
    actionType: 'USER_STATUS_CHANGED',
    entityType: 'User',
    entityId: userId,
    oldValue: { status: user.status },
    newValue: { status },
  });
  return prisma.user.findFirstOrThrow({ where: { id: userId }, include: userInclude });
}

export type { Actor };
