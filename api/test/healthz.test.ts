import { describe, expect, it } from 'vitest';
import { testApp } from './helpers/app.js';

describe('GET /api/healthz', () => {
  it('returns ok', async () => {
    const res = await testApp().request('/api/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
