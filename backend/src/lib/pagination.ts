export interface PageArgs {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Parse `?page`/`?pageSize` (defaults 1/20, pageSize capped at 100). */
export function parsePagination(query: Record<string, unknown>): PageArgs {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
