import 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      // Populated by auth middleware (P4-05/P4-06): the authenticated principal.
      user?: { id: string; role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER'; companyId: string };
    }
  }
}

export {};
