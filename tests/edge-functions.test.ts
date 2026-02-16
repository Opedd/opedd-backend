import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Integration tests for Opedd Supabase Edge Functions.
 * These test the deployed endpoints on the live Supabase project.
 *
 * Run with: npx vitest run tests/edge-functions.test.ts
 */

const BASE_URL = 'https://djdzcciayennqchjgybx.supabase.co/functions/v1';
const API_KEY = 'op_5909a1b5aff49395ccf40b3614b96e13';
const TEST_ARTICLE_ID = 'c41371c2-842d-4bc1-acd0-40466ad34e99';
const PUBLISHER_ID = '8268c353-ffa3-4db3-bbb2-90ddbbb43e41';

// Helper to make requests
async function apiRequest(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
) {
  const { method = 'GET', body, headers = {} } = options || {};
  const res = await fetch(`${BASE_URL}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  return { status: res.status, data, contentType: res.headers.get('content-type') };
}

// ==========================================
// API Endpoint Tests
// ==========================================
describe('Programmatic API (?action=...)', () => {
  describe('GET ?action=docs', () => {
    it('returns API documentation without auth', async () => {
      const { status, data } = await apiRequest('api?action=docs');
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.openapi).toBe('3.0.0');
      expect(data.data.endpoints).toHaveProperty('articles');
      expect(data.data.endpoints).toHaveProperty('purchase');
      expect(data.data.endpoints).toHaveProperty('batch_purchase');
      expect(data.data.endpoints).toHaveProperty('verify');
    });
  });

  describe('No action — default response', () => {
    it('returns API summary', async () => {
      const { status, data } = await apiRequest('api');
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('Opedd Programmatic API');
      expect(data.data.actions).toHaveProperty('docs');
    });
  });

  describe('Authentication', () => {
    it('rejects requests without API key', async () => {
      const { status, data } = await apiRequest('api?action=articles');
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('rejects requests with invalid API key', async () => {
      const { status, data } = await apiRequest('api?action=articles', {
        headers: { 'X-API-Key': 'op_invalidkey' },
      });
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('accepts requests with valid API key', async () => {
      const { status, data } = await apiRequest('api?action=articles', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('GET ?action=articles', () => {
    it('lists articles with pagination', async () => {
      const { status, data } = await apiRequest('api?action=articles&limit=5', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('articles');
      expect(data.data).toHaveProperty('total');
      expect(data.data.limit).toBe(5);
    });
  });

  describe('GET ?action=article', () => {
    it('requires id parameter', async () => {
      const { status, data } = await apiRequest('api?action=article', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('returns article details', async () => {
      const { status, data } = await apiRequest(`api?action=article&id=${TEST_ARTICLE_ID}`, {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.article.id).toBe(TEST_ARTICLE_ID);
      expect(data.data.article.pricing).toHaveProperty('human');
      expect(data.data.article.pricing).toHaveProperty('ai');
    });

    it('returns 404 for non-existent article', async () => {
      const { status, data } = await apiRequest('api?action=article&id=00000000-0000-0000-0000-000000000000', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(404);
      expect(data.success).toBe(false);
    });
  });

  describe('POST ?action=purchase — validation', () => {
    it('requires POST method', async () => {
      const { status, data } = await apiRequest('api?action=purchase', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(405);
      expect(data.success).toBe(false);
    });

    it('requires article_id', async () => {
      const { status, data } = await apiRequest('api?action=purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: { license_type: 'human', buyer_email: 'test@test.com' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('requires valid buyer_email', async () => {
      const { status, data } = await apiRequest('api?action=purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: { article_id: TEST_ARTICLE_ID, license_type: 'human', buyer_email: 'not-an-email' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('requires valid license_type', async () => {
      const { status, data } = await apiRequest('api?action=purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: { article_id: TEST_ARTICLE_ID, license_type: 'invalid', buyer_email: 'test@test.com' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('validates intended_use enum', async () => {
      const { status, data } = await apiRequest('api?action=purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: {
          article_id: TEST_ARTICLE_ID,
          license_type: 'human',
          buyer_email: 'test@test.com',
          intended_use: 'invalid_use',
        },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('POST ?action=batch_purchase — validation', () => {
    it('requires items array', async () => {
      const { status, data } = await apiRequest('api?action=batch_purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: { buyer_email: 'test@test.com' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('rejects empty items array', async () => {
      const { status, data } = await apiRequest('api?action=batch_purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: { items: [], buyer_email: 'test@test.com' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('validates individual item fields', async () => {
      const { status, data } = await apiRequest('api?action=batch_purchase', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: {
          items: [{ article_id: TEST_ARTICLE_ID, license_type: 'invalid' }],
          buyer_email: 'test@test.com',
        },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('GET ?action=usage', () => {
    it('returns usage stats', async () => {
      const { status, data } = await apiRequest('api?action=usage', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('publisher');
      expect(data.data).toHaveProperty('transactions');
      expect(data.data).toHaveProperty('rate_limits');
      expect(data.data.transactions).toHaveProperty('total');
      expect(data.data.transactions).toHaveProperty('via_api');
    });
  });

  describe('Unknown action', () => {
    it('returns error for unknown action', async () => {
      const { status, data } = await apiRequest('api?action=nonexistent', {
        headers: { 'X-API-Key': API_KEY },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });
  });
});

// ==========================================
// Verify License Tests
// ==========================================
describe('Verify License', () => {
  it('requires license key parameter', async () => {
    const { status, data } = await apiRequest('api?action=verify');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('requires OP- prefix', async () => {
    const { status, data } = await apiRequest('api?action=verify&key=INVALID');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('returns 404 for non-existent key', async () => {
    const { status, data } = await apiRequest('api?action=verify&key=OP-FAKE-KEY1');
    expect(status).toBe(404);
    expect(data.success).toBe(false);
  });
});

// ==========================================
// Registry Tests
// ==========================================
describe('Registry of Proof', () => {
  it('returns global feed with no params', async () => {
    const { status, data } = await apiRequest('registry');
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('feed');
    expect(data.data).toHaveProperty('global_stats');
  });

  it('returns publisher registry', async () => {
    const { status, data } = await apiRequest(`registry?publisher_id=${PUBLISHER_ID}`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('publisher');
    expect(data.data).toHaveProperty('stats');
  });

  it('returns article registry', async () => {
    const { status, data } = await apiRequest(`registry?article_id=${TEST_ARTICLE_ID}`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('article');
    expect(data.data).toHaveProperty('stats');
    expect(data.data).toHaveProperty('licenses');
  });

  it('returns 404 for invalid license key', async () => {
    const { status, data } = await apiRequest('registry?license_key=OP-FAKE-KEY1');
    expect(status).toBe(404);
    expect(data.success).toBe(false);
  });

  it('rejects invalid key format', async () => {
    const { status, data } = await apiRequest('registry?license_key=INVALID');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('rejects non-GET methods', async () => {
    const { status, data } = await apiRequest('registry', { method: 'POST', body: {} });
    expect(status).toBe(405);
    expect(data.success).toBe(false);
  });
});

// ==========================================
// AI Defense Policy Tests
// ==========================================
describe('AI Defense Policy', () => {
  it('requires publisher_id', async () => {
    const { status, data } = await apiRequest('ai-defense-policy');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('returns JSON policy', async () => {
    const { status, data } = await apiRequest(`ai-defense-policy?publisher_id=${PUBLISHER_ID}`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('policy');
    expect(data.data).toHaveProperty('ai_crawlers_blocked');
    expect(data.data.ai_crawlers_blocked.length).toBeGreaterThan(0);
  });

  it('returns robots.txt format', async () => {
    const res = await fetch(`${BASE_URL}/ai-defense-policy?publisher_id=${PUBLISHER_ID}&format=robots`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('User-agent:');
    expect(text).toContain('Opedd Protocol');
  });

  it('returns ai.txt format', async () => {
    const res = await fetch(`${BASE_URL}/ai-defense-policy?publisher_id=${PUBLISHER_ID}&format=ai_txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('License-Protocol: opedd/1.0');
  });

  it('returns 404 for non-existent publisher', async () => {
    const { status, data } = await apiRequest('ai-defense-policy?publisher_id=00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
    expect(data.success).toBe(false);
  });
});

// ==========================================
// Certificate PDF Tests
// ==========================================
describe('Certificate PDF', () => {
  it('requires key parameter', async () => {
    const { status, data } = await apiRequest('certificate');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('requires OP- prefix', async () => {
    const { status, data } = await apiRequest('certificate?key=INVALID');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('returns 404 for non-existent key', async () => {
    const { status, data } = await apiRequest('certificate?key=OP-FAKE-KEY1');
    expect(status).toBe(404);
    expect(data.success).toBe(false);
  });

  it('returns PDF for valid license key', async () => {
    // Use a key we know exists from batch purchase test
    const res = await fetch(`${BASE_URL}/certificate?key=OP-SK68-W56V`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000); // PDF should be at least 1KB
  });
});

// ==========================================
// Widget Tests
// ==========================================
describe('Widget JS', () => {
  it('serves JavaScript', async () => {
    const res = await fetch(`${BASE_URL}/widget`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    const text = await res.text();
    expect(text).toContain('opedd-widget');
    expect(text).toContain('data-asset-id');
  });

  it('includes all display modes', async () => {
    const res = await fetch(`${BASE_URL}/widget`);
    const text = await res.text();
    expect(text).toContain("mode === 'badge'");
    expect(text).toContain("mode === 'compact'");
    expect(text).toContain('renderWidget');
    expect(text).toContain('showFreeForm');
  });

  it('includes auto-registration functions', async () => {
    const res = await fetch(`${BASE_URL}/widget`);
    const text = await res.text();
    expect(text).toContain('getPageMeta');
    expect(text).toContain('getPageMetadata');
    expect(text).toContain('autoRegister');
    expect(text).toContain('getCategoryFromUrl');
  });
});

// ==========================================
// Lookup Article Tests
// ==========================================
describe('Lookup Article', () => {
  it('requires url parameter', async () => {
    const { status, data } = await apiRequest('lookup-article');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('returns 404 for non-existent URL', async () => {
    const { status, data } = await apiRequest('lookup-article?url=https://example.com/does-not-exist');
    expect(status).toBe(404);
    expect(data.success).toBe(false);
  });

  // POST: Auto-registration tests
  describe('POST — auto-registration', () => {
    it('requires publisher_id, url, and title', async () => {
      const { status, data } = await apiRequest('lookup-article', {
        method: 'POST',
        body: { url: 'https://example.com/article' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('rejects missing url', async () => {
      const { status, data } = await apiRequest('lookup-article', {
        method: 'POST',
        body: { publisher_id: PUBLISHER_ID, title: 'Test Article' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('rejects missing title', async () => {
      const { status, data } = await apiRequest('lookup-article', {
        method: 'POST',
        body: { publisher_id: PUBLISHER_ID, url: 'https://example.com/article' },
      });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('returns 404 for non-existent publisher', async () => {
      const { status, data } = await apiRequest('lookup-article', {
        method: 'POST',
        body: {
          publisher_id: '00000000-0000-0000-0000-000000000000',
          url: 'https://example.com/test-article',
          title: 'Test Article',
        },
      });
      expect(status).toBe(404);
      expect(data.success).toBe(false);
    });

    it('rejects domain mismatch (no Origin header)', async () => {
      const { status, data } = await apiRequest('lookup-article', {
        method: 'POST',
        body: {
          publisher_id: PUBLISHER_ID,
          url: 'https://wrong-domain.com/article',
          title: 'Test Article',
        },
      });
      // No Origin header → domain mismatch → 403
      expect(status).toBe(403);
      expect(data.success).toBe(false);
    });

    it('rejects domain mismatch (wrong Origin header)', async () => {
      const { status, data } = await apiRequest('lookup-article', {
        method: 'POST',
        headers: { 'Origin': 'https://wrong-domain.com' },
        body: {
          publisher_id: PUBLISHER_ID,
          url: 'https://wrong-domain.com/article',
          title: 'Test Article',
        },
      });
      expect(status).toBe(403);
      expect(data.success).toBe(false);
    });
  });
});

// ==========================================
// Checkout Status Tests
// ==========================================
describe('Checkout Status', () => {
  it('requires session_id parameter', async () => {
    const { status, data } = await apiRequest('checkout-status');
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('returns not found for invalid session', async () => {
    const { status, data } = await apiRequest('checkout-status?session_id=cs_invalid');
    expect(status).toBe(404);
    expect(data.success).toBe(false);
  });
});

// ==========================================
// Issue License (free) — validation only
// ==========================================
describe('Issue License — validation', () => {
  it('rejects GET method', async () => {
    const { status, data } = await apiRequest('issue-license');
    expect(status).toBe(405);
    expect(data.success).toBe(false);
  });

  it('requires article_id', async () => {
    const { status, data } = await apiRequest('issue-license', {
      method: 'POST',
      body: { buyer_email: 'test@test.com', license_type: 'human' },
    });
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('requires valid email', async () => {
    const { status, data } = await apiRequest('issue-license', {
      method: 'POST',
      body: { article_id: TEST_ARTICLE_ID, buyer_email: 'bad', license_type: 'human' },
    });
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });
});
