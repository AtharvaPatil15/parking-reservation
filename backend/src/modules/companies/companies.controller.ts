import type { Company, CompanyStatus, UserStatus } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { parsePagination } from '../../lib/pagination';
import { toUserProfile } from '../../lib/dto';
import * as service from './companies.service';

const toCompany = (c: Company) => ({
  id: c.id,
  name: c.name,
  code: c.code,
  status: c.status,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const createCompany = asyncHandler(async (req, res) => {
  const c = await service.createCompany(req.body as { name: string; code: string });
  sendSuccess(res, toCompany(c), 201);
});

export const listCompanies = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listCompanies({
    status: req.query.status as CompanyStatus | undefined,
    ...p,
  });
  sendSuccess(res, rows.map(toCompany), 200, { page: p.page, pageSize: p.pageSize, total });
});

export const listActiveCompanies = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listActiveCompanies());
});

export const quotaSummary = asyncHandler(async (req, res) => {
  const dateStr = req.query.date as string | undefined;
  // Default to "today" (UTC midnight) when no date is supplied; the effective-quota lookup is date-only.
  const date = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();
  sendSuccess(res, await service.quotaSummary(date));
});

export const getCompany = asyncHandler(async (req, res) => {
  sendSuccess(res, toCompany(await service.getCompany(req.params.id)));
});

export const updateCompany = asyncHandler(async (req, res) => {
  const c = await service.updateCompany(req.params.id, req.body as { name: string });
  sendSuccess(res, toCompany(c));
});

export const setCompanyStatus = asyncHandler(async (req, res) => {
  const c = await service.setCompanyStatus(req.params.id, (req.body as { status: CompanyStatus }).status);
  sendSuccess(res, toCompany(c));
});

export const deleteCompany = asyncHandler(async (req, res) => {
  const c = await service.deleteCompany(req.params.id);
  sendSuccess(res, toCompany(c));
});

export const listCompanyUsers = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listCompanyUsers(req.params.id, {
    status: req.query.status as UserStatus | undefined,
    ...p,
  });
  sendSuccess(res, rows.map(toUserProfile), 200, { page: p.page, pageSize: p.pageSize, total });
});

export const assignCompanyAdmin = asyncHandler(async (req, res) => {
  const result = await service.assignCompanyAdmin(
    req.params.id,
    (req.body as { userId: string }).userId,
    req.user?.id,
  );
  sendSuccess(res, result);
});
