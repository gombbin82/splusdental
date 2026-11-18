// Website traffic for the admin, read from the GA4 Data API.
//
// Auth: the Cloud Run runtime service account (Application Default Credentials, no key file) with
// the `analytics.readonly` scope. The SA must be added as a Viewer on the GA4 property (GA → Admin
// → Property access management); see infra/README.md. Only aggregate numbers come back: no user
// IDs, no IP addresses. Visitors are counted only if they accepted analytics on the public site.
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';

export const trafficQuery = z.object({
  days: z.enum(['7', '28', '90']).default('28').transform(Number),
});

/** Minimal GA4 `runReport` request/response shapes (only the fields we use). */
export interface ReportRequest {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
}

export interface ReportResponse {
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  metadata?: { timeZone?: string };
}

export interface AnalyticsClient {
  runReport(req: ReportRequest): Promise<ReportResponse>;
}

export class AnalyticsError extends Error {
  constructor(readonly status: number) {
    super(`GA4 Data API failed (${status})`);
  }
}

export interface Totals {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  /** 0..1 */
  engagementRate: number;
  /** Seconds. */
  avgSessionDuration: number;
}

export interface Traffic {
  days: number;
  /** YYYY-MM-DD in the property's time zone; the range ends yesterday (complete days only). */
  start: string;
  end: string;
  timeZone: string;
  totals: Totals;
  /** Same metrics for the preceding period of equal length. */
  previous: Totals;
  daily: { date: string; users: number; sessions: number }[];
  pages: { path: string; title: string; views: number; users: number }[];
  sources: { channel: string; sessions: number; users: number }[];
  devices: { device: string; users: number }[];
  /** Clicks on "Make an appointment" (GA4 outbound clicks to Calendly; needs enhanced measurement). */
  bookingClicks: number;
  /**
   * Visits from the Google Business Profile website link, which is tagged utm_campaign=gbp.
   * Current and previous period.
   */
  gbp: { sessions: number; users: number; previousSessions: number };
}

/** utm_campaign on the Google Business Profile website link. */
export const GBP_CAMPAIGN = 'gbp';

const TOTAL_METRICS = [
  'activeUsers',
  'newUsers',
  'sessions',
  'screenPageViews',
  'engagementRate',
  'averageSessionDuration',
] as const;

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toTotals(values: { value: string }[] | undefined): Totals {
  const v = (i: number) => num(values?.[i]?.value);
  return {
    activeUsers: v(0),
    newUsers: v(1),
    sessions: v(2),
    pageViews: v(3),
    engagementRate: v(4),
    avgSessionDuration: v(5),
  };
}

/** YYYY-MM-DD for `ms` in `timeZone`. */
export function ymd(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/** Calendar days ending at `end` (inclusive), oldest first. Pure date math, no time zone. */
export function dayList(end: string, days: number): string[] {
  const base = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(base - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

const gaDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export async function getTraffic(
  client: AnalyticsClient,
  days: number,
  now: number,
): Promise<Traffic> {
  const current = { startDate: `${days}daysAgo`, endDate: 'yesterday' };
  const previous = { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` };
  const byDesc = (metric: string) => [{ metric: { metricName: metric }, desc: true }];

  const [totalsRes, dailyRes, pagesRes, sourcesRes, devicesRes, bookingRes, gbpRes] =
    await Promise.all([
      client.runReport({
        dateRanges: [current, previous],
        metrics: TOTAL_METRICS.map((name) => ({ name })),
      }),
      client.runReport({
        dateRanges: [current],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        limit: 400,
      }),
      client.runReport({
        dateRanges: [current],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
        orderBys: byDesc('screenPageViews'),
        limit: 10,
      }),
      client.runReport({
        dateRanges: [current],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: byDesc('sessions'),
        limit: 8,
      }),
      client.runReport({
        dateRanges: [current],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: byDesc('activeUsers'),
      }),
      client.runReport({
        dateRanges: [current],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              { filter: { fieldName: 'eventName', stringFilter: { value: 'click' } } },
              {
                filter: {
                  fieldName: 'linkDomain',
                  stringFilter: { matchType: 'CONTAINS', value: 'calendly.com' },
                },
              },
            ],
          },
        },
      }),
      client.runReport({
        dateRanges: [current, previous],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        dimensionFilter: {
          filter: { fieldName: 'sessionCampaignName', stringFilter: { value: GBP_CAMPAIGN } },
        },
      }),
    ]);

  // With two date ranges GA adds a `dateRange` dimension: date_range_0 = current, _1 = previous.
  const rangeRow = (res: ReportResponse, name: string) =>
    res.rows?.find((r) => r.dimensionValues?.[0]?.value === name)?.metricValues;
  const totalsRow = (name: string) => rangeRow(totalsRes, name);
  const gbpNow = rangeRow(gbpRes, 'date_range_0');

  const timeZone = dailyRes.metadata?.timeZone || totalsRes.metadata?.timeZone || 'UTC';
  const end = ymd(now - 86_400_000, timeZone);
  const dates = dayList(end, days);
  const byDate = new Map(
    (dailyRes.rows ?? []).map((r) => [
      gaDate(r.dimensionValues?.[0]?.value ?? ''),
      { users: num(r.metricValues?.[0]?.value), sessions: num(r.metricValues?.[1]?.value) },
    ]),
  );

  return {
    days,
    start: dates[0] ?? end,
    end,
    timeZone,
    totals: toTotals(totalsRow('date_range_0')),
    previous: toTotals(totalsRow('date_range_1')),
    daily: dates.map((date) => ({ date, ...(byDate.get(date) ?? { users: 0, sessions: 0 }) })),
    pages: (pagesRes.rows ?? []).map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? '',
      title: r.dimensionValues?.[1]?.value ?? '',
      views: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
    })),
    sources: (sourcesRes.rows ?? []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value ?? '',
      sessions: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
    })),
    devices: (devicesRes.rows ?? []).map((r) => ({
      device: r.dimensionValues?.[0]?.value ?? '',
      users: num(r.metricValues?.[0]?.value),
    })),
    bookingClicks: num(bookingRes.rows?.[0]?.metricValues?.[0]?.value),
    gbp: {
      sessions: num(gbpNow?.[0]?.value),
      users: num(gbpNow?.[1]?.value),
      previousSessions: num(rangeRow(gbpRes, 'date_range_1')?.[0]?.value),
    },
  };
}

/** Caches reports per range so page refreshes don't burn GA4 quota. In-memory, per instance. */
export class TrafficCache {
  private readonly entries = new Map<number, { at: number; data: Traffic }>();
  constructor(private readonly ttlMs = 10 * 60_000) {}

  async get(days: number, now: number, load: () => Promise<Traffic>): Promise<Traffic> {
    const hit = this.entries.get(days);
    if (hit && now - hit.at < this.ttlMs) return hit.data;
    const data = await load();
    this.entries.set(days, { at: now, data });
    return data;
  }
}

/** Production wiring: the runtime SA via Application Default Credentials. */
export function createGa4Client(
  propertyId: string,
  fetchImpl: typeof fetch = fetch,
): AnalyticsClient {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  return {
    async runReport(req) {
      const token = await auth.getAccessToken();
      if (!token) throw new AnalyticsError(0);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new AnalyticsError(res.status);
      return (await res.json()) as ReportResponse;
    },
  };
}
