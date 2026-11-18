/**
 * Single source of truth for S+ Dental business facts.
 *
 * Every page, the footer, and the schema.org JSON-LD read from here. When a fact changes
 * (hours, phone, links), change it once in this file.
 *
 * Source: docs/context.md and docs/content/current-site.md. Do not add facts that the practice
 * has not confirmed (insurance plans, financing providers, prices, credentials).
 */

export const SITE_URL = 'https://splus.dental';

export const practice = {
  name: 'S+ Dental',
  opened: 'June 2023',
  foundingDate: '2023-06',
  areaServed: ['Mountlake Terrace', 'Lynnwood'],
  phone: {
    display: '(425) 616-2331',
    tel: '+14256162331',
    schema: '+1-425-616-2331',
  },
  email: 'info@splus.dental',
  address: {
    street: '21005 44th Ave W',
    suite: 'Ste 103',
    city: 'Mountlake Terrace',
    region: 'WA',
    postalCode: '98043',
    country: 'US',
  },
  links: {
    booking: 'https://calendly.com/splus-manager/dental-appointment',
    googleMaps: 'https://goo.gl/maps/mRpPGHKfpXgz9KFJA',
    facebook: 'https://www.facebook.com/splusdental',
    newPatientPacket: 'https://drive.google.com/file/d/1R8DTyoYjLkDz5TgfAMeJMU9DSFFoCTK_/view',
  },
  dentist: {
    name: 'Dr. Stephanie Kang',
    credential: 'DMD',
    school: 'Tufts University School of Dental Medicine',
  },
} as const;

/** One line, Google Business Profile format: "21005 44th Ave W Ste 103, Mountlake Terrace, WA 98043". */
export const addressOneLine = `${practice.address.street} ${practice.address.suite}, ${practice.address.city}, ${practice.address.region} ${practice.address.postalCode}`;

/** Map embed (no API key): the classic `output=embed` URL. */
export const mapEmbedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(
  `${practice.name}, ${addressOneLine}`,
)}&output=embed`;

type SchemaDay = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface HoursRow {
  /** Label shown to patients. */
  days: string;
  /** Human-readable hours, or a note like "Closed". */
  hours: string;
  /** For JSON-LD. Omit for rows without fixed hours (closed / by appointment). */
  schema?: { dayOfWeek: SchemaDay[]; opens: string; closes: string };
}

export const hours: HoursRow[] = [
  {
    days: 'Tuesday – Thursday',
    hours: '8 AM – 5 PM',
    schema: { dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday'], opens: '08:00', closes: '17:00' },
  },
  {
    days: 'Friday',
    hours: '7 AM – 2 PM',
    schema: { dayOfWeek: ['Friday'], opens: '07:00', closes: '14:00' },
  },
  { days: 'Saturday', hours: 'By appointment only' },
  { days: 'Sunday & Monday', hours: 'Closed' },
];

export interface ServiceGroup {
  title: string;
  services: string[];
}

/** The 12 services listed on the current site, lightly grouped. Names only — no clinical claims. */
export const serviceGroups: ServiceGroup[] = [
  {
    title: 'Exams and cleanings',
    services: ['Comprehensive dental exam', 'Preventive care', 'Deep cleaning', '3D x-ray'],
  },
  {
    title: 'Restoring teeth',
    services: ['Dental fillings', 'Crowns and bridges', 'Root canal treatment', 'Extractions'],
  },
  {
    title: 'Replacing teeth',
    services: ['Dental implants', 'Full and partial dentures'],
  },
  {
    title: 'Cosmetic and alignment',
    services: ['Teeth whitening', 'Clear aligners'],
  },
];

/** Primary navigation, in display order (mirrors the current site). */
export interface InsurancePlan {
  name: string;
  /**
   * Optional logo in site/public/insurance/ (e.g. '/insurance/aetna.svg'). Use only files the
   * insurer provides to network dentists (provider portal / brand kit). Without one, the name is
   * shown as text.
   */
  logo?: string;
}

/**
 * Dental insurance networks the practice is in, confirmed by the practice 2026-11-18.
 * Logos: Anthem, Cigna, Premera, Regence and TRICARE files from the practice (2026-11-18); the rest
 * from Wikimedia Commons (public-domain marks). Replace any of them with provider-portal files.
 */
const plans: InsurancePlan[] = [
  { name: 'Aetna', logo: '/insurance/aetna.svg' },
  { name: 'Anthem', logo: '/insurance/anthem.svg' },
  { name: 'Cigna', logo: '/insurance/cigna.png' },
  { name: 'Delta Dental', logo: '/insurance/delta-dental.svg' },
  { name: 'Humana', logo: '/insurance/humana.svg' },
  { name: 'Premera', logo: '/insurance/premera.png' },
  { name: 'Principal', logo: '/insurance/principal.svg' },
  { name: 'Regence', logo: '/insurance/regence.png' },
  { name: 'TRICARE', logo: '/insurance/tricare.svg' },
  { name: 'United Concordia', logo: '/insurance/united-concordia.png' },
  { name: 'UnitedHealthcare', logo: '/insurance/unitedhealthcare.svg' },
  { name: 'Unum', logo: '/insurance/unum.svg' },
];

/** In-network plans, alphabetical (case-insensitive). */
export const insurancePlans: readonly InsurancePlan[] = [...plans].sort((a, b) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
);

export const nav = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About us' },
  { href: '/services', label: 'Services' },
  { href: '/new-patients', label: 'New patients' },
  { href: '/patient-resources', label: 'Patient resources' },
  { href: '/contact', label: 'Contact us' },
] as const;

/** Stable @id values so the JSON-LD nodes on different pages refer to the same entities. */
const ORG_ID = `${SITE_URL}/#dentist`;
const DOCTOR_ID = `${SITE_URL}/about#dr-kang`;

/**
 * schema.org `Dentist` (a LocalBusiness) structured data. Rendered on every page.
 * Pass `withServices` on /services to list the services as offers.
 * No geo coordinates, ratings or review counts: only facts the practice has published.
 */
export function dentistJsonLd({ withServices = false } = {}): Record<string, unknown> {
  const doctor = {
    '@type': 'Person',
    '@id': DOCTOR_ID,
    name: practice.dentist.name,
    honorificSuffix: practice.dentist.credential,
    jobTitle: 'Dentist',
    alumniOf: { '@type': 'CollegeOrUniversity', name: practice.dentist.school },
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    '@id': ORG_ID,
    name: practice.name,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/logo.png`,
    image: `${SITE_URL}/og-image.png`,
    telephone: practice.phone.schema,
    email: practice.email,
    foundingDate: practice.foundingDate,
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${practice.address.street} ${practice.address.suite}`,
      addressLocality: practice.address.city,
      addressRegion: practice.address.region,
      postalCode: practice.address.postalCode,
      addressCountry: practice.address.country,
    },
    areaServed: practice.areaServed.map((name) => ({
      '@type': 'City',
      name: `${name}, ${practice.address.region}`,
    })),
    hasMap: practice.links.googleMaps,
    openingHoursSpecification: hours.flatMap((row) =>
      row.schema
        ? [
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: row.schema.dayOfWeek,
              opens: row.schema.opens,
              closes: row.schema.closes,
            },
          ]
        : [],
    ),
    founder: doctor,
    employee: doctor,
    sameAs: [practice.links.facebook, practice.links.googleMaps],
    ...(withServices
      ? {
          makesOffer: serviceGroups.flatMap((g) =>
            g.services.map((name) => ({
              '@type': 'Offer',
              itemOffered: { '@type': 'Service', name },
            })),
          ),
        }
      : {}),
  };
}

/** schema.org `WebSite` for the home page. */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: practice.name,
    url: `${SITE_URL}/`,
    publisher: { '@id': ORG_ID },
    inLanguage: 'en-US',
  };
}

/** schema.org `BreadcrumbList`: Home > page. */
export function breadcrumbJsonLd(name: string, path: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name, item: `${SITE_URL}${path}` },
    ],
  };
}
