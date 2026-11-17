import { afterEach, describe, expect, it, vi } from 'vitest';
import { dentistJsonLd, hours, practice } from '../src/data/practice';

describe('practice facts', () => {
  it('keeps contact details exact', () => {
    expect(practice.phone.display).toBe('(425) 616-2331');
    expect(practice.phone.tel).toBe('+14256162331');
    expect(practice.email).toBe('info@splus.dental');
    expect(practice.links.booking).toBe('https://calendly.com/splus-manager/dental-appointment');
  });

  it('builds Dentist JSON-LD with opening hours for Tue–Fri only', () => {
    const ld = dentistJsonLd();
    expect(ld['@type']).toBe('Dentist');
    expect(ld.openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday'],
        opens: '08:00',
        closes: '17:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Friday'],
        opens: '07:00',
        closes: '14:00',
      },
    ]);
    expect(hours.map((h) => h.hours)).toContain('Closed');
  });
});

describe('robots.txt', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function robots(): Promise<string> {
    const { GET } = await import('../src/pages/robots.txt');
    const res = await (GET as (ctx: { site: URL }) => Response | Promise<Response>)({
      site: new URL('https://splus.dental'),
    });
    return res.text();
  }

  it('allows crawling and links the sitemap by default', async () => {
    vi.stubEnv('PUBLIC_NOINDEX', '');
    const body = await robots();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://splus.dental/sitemap-index.xml');
  });

  it('disallows everything when PUBLIC_NOINDEX=true', async () => {
    vi.stubEnv('PUBLIC_NOINDEX', 'true');
    const body = await robots();
    expect(body).toBe('User-agent: *\nDisallow: /\n');
  });
});
