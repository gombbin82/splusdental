import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/healthz', () => {
  it('returns ok', async () => {
    const res = await createApp().request('/api/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
