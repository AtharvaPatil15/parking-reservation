import { describe, expect, it } from 'vitest';
import { ApiError, unwrap, unwrapPage } from './http';

const res = (status: number) => ({ status }) as Response;

describe('unwrap', () => {
  it('returns data.data on a success envelope', async () => {
    const out = await unwrap<{ x: number }>(
      Promise.resolve({ data: { success: true, data: { x: 1 } }, response: res(200) }),
    );
    expect(out).toEqual({ x: 1 });
  });

  it('throws ApiError from the openapi-fetch error slot (non-2xx body)', async () => {
    const promise = unwrap(
      Promise.resolve({
        error: { success: false, error: { code: 'UNAUTHENTICATED', message: 'nope' } },
        response: res(401),
      }),
    );
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      code: 'UNAUTHENTICATED',
      status: 401,
    });
  });

  it('throws ApiError when success is false in the data slot', async () => {
    await expect(
      unwrap(
        Promise.resolve({
          data: { success: false, error: { code: 'CONFLICT', message: 'dup' } },
          response: res(409),
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
});

describe('unwrapPage', () => {
  it('returns items + meta on success', async () => {
    const out = await unwrapPage<{ id: string }>(
      Promise.resolve({
        data: { success: true, data: [{ id: 'a' }], meta: { page: 1, pageSize: 10, total: 1 } },
        response: res(200),
      }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.meta.total).toBe(1);
  });

  it('defaults meta when absent', async () => {
    const out = await unwrapPage(Promise.resolve({ data: { success: true, data: [] }, response: res(200) }));
    expect(out.meta).toEqual({ page: 1, pageSize: 0, total: 0 });
  });

  it('throws ApiError on error', async () => {
    await expect(
      unwrapPage(
        Promise.resolve({ error: { success: false, error: { code: 'X', message: 'y' } }, response: res(500) }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
