import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('License Endpoints', () => {
  describe('POST /api/v1/licenses', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/v1/licenses')
        .send({
          title: 'Test License',
          licenseType: 'standard',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/licenses')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          title: 'Test License',
          licenseType: 'standard',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/licenses/me', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await request(app).get('/api/v1/licenses/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });
});
