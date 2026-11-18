import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  addressOneLine,
  breadcrumbJsonLd,
  dentistJsonLd,
  hours,
  nav,
  practice,
  serviceGroups,
  websiteJsonLd,
} from '../src/data/practice';

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

describe('structured data', () => {
  it('has the required LocalBusiness fields and no invented ratings', () => {
    const ld = dentistJsonLd();
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      name: 'S+ Dental',
      url: 'https://splus.dental/',
      telephone: '+1-425-616-2331',
      foundingDate: '2023-06',
      address: {
        streetAddress: '21005 44th Ave W Ste 103',
        addressLocality: 'Mountlake Terrace',
        addressRegion: 'WA',
        postalCode: '98043',
      },
      founder: {
        name: 'Dr. Stephanie Kang',
        alumniOf: { name: 'Tufts University School of Dental Medicine' },
      },
    });
    expect(ld.sameAs).toEqual([practice.links.facebook, practice.links.googleMaps]);
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld).not.toHaveProperty('geo');
    expect(ld).not.toHaveProperty('makesOffer');
  });

  it('lists all 12 services as offers on /services', () => {
    const offers = dentistJsonLd({ withServices: true }).makesOffer as unknown[];
    expect(offers).toHaveLength(12);
    expect(serviceGroups.flatMap((g) => g.services)).toHaveLength(12);
  });

  it('builds breadcrumbs and WebSite nodes', () => {
    expect(breadcrumbJsonLd('Services', '/services').itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://splus.dental/' },
      { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://splus.dental/services' },
    ]);
    expect(websiteJsonLd()['@type']).toBe('WebSite');
  });

  it('uses the Google Business Profile address format and the current site navigation', () => {
    expect(addressOneLine).toBe('21005 44th Ave W Ste 103, Mountlake Terrace, WA 98043');
    expect(nav.map((n) => n.href)).toEqual([
      '/',
      '/about',
      '/services',
      '/new-patients',
      '/patient-resources',
      '/contact',
    ]);
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

describe('analytics flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async (value: string) => {
    vi.resetModules();
    vi.stubEnv('PUBLIC_GA_ID', value);
    return (await import('../src/lib/env')).gaId;
  };

  it('is off unless a GA4 measurement ID is set (staging/dev builds)', async () => {
    expect(await load('')).toBe('');
  });

  it('accepts a GA4 measurement ID and rejects anything else', async () => {
    expect(await load('G-XT2LGD6KEM')).toBe('G-XT2LGD6KEM');
    expect(await load('UA-12345-1')).toBe('');
    expect(await load('G-XT2"><script>')).toBe('');
  });
});

describe('analytics consent', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('loads Google only after consent and honours Global Privacy Control', () => {
    const src = read('../src/components/AnalyticsConsent.astro');
    // The gtag script tag is created only inside load(); there is no static <script src=...gtag>.
    expect(src).not.toMatch(/<script[^>]+googletagmanager/);
    expect(src).toContain("if (choice === 'granted') load();");
    expect(src).toContain('navigator.globalPrivacyControl');
    expect(src).toContain('allow_google_signals: false');
    expect(src).toContain('allow_ad_personalization_signals: false');
  });

  it('skips analytics on pages excluded from search (payment return, 404)', () => {
    const layout = read('../src/layouts/BaseLayout.astro');
    expect(layout).toContain("const analytics = gaId && !noindex ? gaId : '';");
    expect(read('../src/pages/thank-you.astro')).toMatch(/<BaseLayout[^>]*\bnoindex\b/);
  });

  it('links the consumer health data policy from every page footer', () => {
    expect(read('../src/components/Footer.astro')).toContain('href="/consumer-health-data"');
  });
});
