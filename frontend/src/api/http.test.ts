import { describe, expect, it } from 'vitest';
import { ApiError, unwrap } from './http';

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
