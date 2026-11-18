import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsError,
  TrafficCache,
  dayList,
  getTraffic,
  ymd,
  type AnalyticsClient,
  type ReportRequest,
  type ReportResponse,
} from '../src/analytics.js';
import { setLogSink, type LogSink } from '../src/log.js';
import { ADMIN_TOKEN, authHeaders, testApp } from './helpers/app.js';

// 2026-11-18T20:00:00Z = Nov 18, 12:00 in Los Angeles; "yesterday" there is Nov 17.
const NOW = Date.UTC(2026, 10, 18, 20);

const row = (dims: string[], metrics: (string | number)[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: metrics.map((m) => ({ value: String(m) })),
});

/** Answers each runReport by looking at what it asks for, like the real API would. */
function fakeGa(): AnalyticsClient & { runReport: ReturnType<typeof vi.fn> } {
  const runReport = vi.fn(async (req: ReportRequest): Promise<ReportResponse> => {
    const dims = (req.dimensions ?? []).map((d) => d.name).join(',');
    const metadata = { timeZone: 'America/Los_Angeles' };
    if (req.dateRanges.length === 2) {
      return {
        metadata,
        rows: [
          row(['date_range_1'], [80, 50, 100, 300, 0.5, 90]),
          row(['date_range_0'], [120, 70, 150, 420, '0.61', '95.5']),
        ],
      };
    }
    if (dims === 'date') {
      return { metadata, rows: [row(['20261117'], [9, 11]), row(['20261115'], [4, 5])] };
    }
    if (dims === 'pagePath,pageTitle') {
      return {
        rows: [row(['/', 'S+ Dental'], [200, 90]), row(['/services', 'Services'], [60, 40])],
      };
    }
    if (dims === 'sessionDefaultChannelGroup') {
      return { rows: [row(['Organic Search'], [90, 70]), row(['Direct'], [40, 35])] };
    }
    if (dims === 'deviceCategory') return { rows: [row(['mobile'], [80]), row(['desktop'], [40])] };
    if (req.dimensionFilter) return { rows: [row([], [17])] };
    throw new Error(`unexpected report ${dims}`);
  });
  return { runReport };
}

describe('date helpers', () => {
  it('formats dates in the property time zone', () => {
    expect(ymd(Date.UTC(2026, 10, 18, 5), 'America/Los_Angeles')).toBe('2026-11-17');
    expect(ymd(Date.UTC(2026, 10, 18, 5), 'UTC')).toBe('2026-11-18');
  });

  it('lists calendar days across month ends', () => {
    expect(dayList('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
  });
});

describe('getTraffic', () => {
  it('maps the six reports and fills missing days with zeros', async () => {
    const ga = fakeGa();
    const t = await getTraffic(ga, 7, NOW);

    expect(ga.runReport).toHaveBeenCalledTimes(6);
    expect(ga.runReport.mock.calls[0]![0].dateRanges).toEqual([
      { startDate: '7daysAgo', endDate: 'yesterday' },
      { startDate: '14daysAgo', endDate: '8daysAgo' },
    ]);
    expect(t).toMatchObject({ days: 7, start: '2026-11-11', end: '2026-11-17' });
    expect(t.timeZone).toBe('America/Los_Angeles');
    expect(t.totals).toEqual({
      activeUsers: 120,
      newUsers: 70,
      sessions: 150,
      pageViews: 420,
      engagementRate: 0.61,
      avgSessionDuration: 95.5,
    });
    expect(t.previous.activeUsers).toBe(80);
    expect(t.daily).toHaveLength(7);
    expect(t.daily.at(-1)).toEqual({ date: '2026-11-17', users: 9, sessions: 11 });
    expect(t.daily.find((d) => d.date === '2026-11-15')).toEqual({
      date: '2026-11-15',
      users: 4,
      sessions: 5,
    });
    expect(t.daily.find((d) => d.date === '2026-11-16')).toEqual({
      date: '2026-11-16',
      users: 0,
      sessions: 0,
    });
    expect(t.pages[0]).toEqual({ path: '/', title: 'S+ Dental', views: 200, users: 90 });
    expect(t.sources.map((s) => s.channel)).toEqual(['Organic Search', 'Direct']);
    expect(t.devices[0]).toEqual({ device: 'mobile', users: 80 });
    expect(t.bookingClicks).toBe(17);
  });

  it('copes with an empty property (no rows at all)', async () => {
    const t = await getTraffic({ runReport: async () => ({}) }, 28, NOW);
    expect(t.totals.activeUsers).toBe(0);
    expect(t.daily).toHaveLength(28);
    expect(t.timeZone).toBe('UTC');
    expect(t.pages).toEqual([]);
    expect(t.bookingClicks).toBe(0);
  });
});

describe('TrafficCache', () => {
  it('reuses a result for 10 minutes, per range', async () => {
    const cache = new TrafficCache();
    const load = vi.fn(async () => ({ days: 7 }) as never);
    await cache.get(7, 0, load);
    await cache.get(7, 9 * 60_000, load);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get(28, 9 * 60_000, load);
    await cache.get(7, 11 * 60_000, load);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('GET /api/admin/traffic', () => {
  let lines: string[];
  let prevSink: LogSink;
  beforeEach(() => {
    lines = [];
    prevSink = setLogSink((l) => lines.push(l));
  });
  afterEach(() => {
    setLogSink(prevSink);
  });

  const admin = { headers: authHeaders({}, ADMIN_TOKEN) };

  it('401 without a token, 403 for staff', async () => {
    const app = testApp(undefined, undefined, { analytics: fakeGa() });
    expect((await app.request('/api/admin/traffic')).status).toBe(401);
    const res = await app.request('/api/admin/traffic', { headers: authHeaders() });
    expect(res.status).toBe(403);
  });

  it('503 when GA4 is not configured', async () => {
    const res = await testApp().request('/api/admin/traffic', admin);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'analytics_disabled' });
  });

  it('returns traffic for an admin, defaulting to 28 days', async () => {
    const ga = fakeGa();
    const res = await testApp(undefined, undefined, { analytics: ga }).request(
      '/api/admin/traffic',
      admin,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(28);
    expect(body.totals.activeUsers).toBe(120);
    expect(ga.runReport.mock.calls[0]![0].dateRanges[0].startDate).toBe('28daysAgo');
  });

  it('400 for an unsupported range', async () => {
    const app = testApp(undefined, undefined, { analytics: fakeGa() });
    expect((await app.request('/api/admin/traffic?days=365', admin)).status).toBe(400);
  });

  it('reports a missing GA4 permission distinctly', async () => {
    const ga = {
      runReport: async () => {
        throw new AnalyticsError(403);
      },
    };
    const res = await testApp(undefined, undefined, { analytics: ga }).request(
      '/api/admin/traffic?days=7',
      admin,
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'analytics_forbidden' });
    expect(lines.join('\n')).toContain('analytics_failed');
  });
});
