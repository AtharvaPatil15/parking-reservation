import 'express';
import type { Role } from '../lib/roles';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      // Populated by auth middleware (P4-05/P4-06): the authenticated principal. `Role` is imported
      // rather than inlined so adding a role (e.g. Phase 7's SECURITY) cannot drift from lib/roles.
      user?: { id: string; role: Role; companyId: string };
    }
  }
}

export {};
