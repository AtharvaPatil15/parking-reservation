import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { API, DEV_PASSWORD } from './integration/helpers';

describe('POST /auth/refresh', () => {
  it('rotates the access token and returns the current user identity', async () => {
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@assent.example', password: DEV_PASSWORD })
      .expect(200);
    const cookie = login.headers['set-cookie'];

    const refresh = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookie).expect(200);

    expect(refresh.body.data.accessToken).toEqual(expect.any(String));
    expect(refresh.body.data.user).toMatchObject({
      id: login.body.data.user.id,
      role: 'COMPANY_ADMIN',
      companyId: login.body.data.user.companyId,
    });
  });
});
