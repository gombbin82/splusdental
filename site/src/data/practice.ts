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
  tagline: 'Your neighborhood dentist in Mountlake Terrace and Lynnwood',
  opened: 'June 2023',
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
  },
} as const;

/** One line, e.g. "21005 44th Ave W, Ste 103, Mountlake Terrace, WA 98043". */
export const addressOneLine = `${practice.address.street}, ${practice.address.suite}, ${practice.address.city}, ${practice.address.region} ${practice.address.postalCode}`;

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

export interface Service {
  name: string;
  /** Plain-language description of what the service is (general, not a clinical claim). */
  blurb: string;
}

export interface ServiceGroup {
  title: string;
  services: Service[];
}

/** The services listed on the current site, grouped for readability. */
export const serviceGroups: ServiceGroup[] = [
  {
    title: 'Exams and prevention',
    services: [
      {
        name: 'Comprehensive dental exam',
        blurb: 'A thorough first look at your teeth and gums, with a plan made for you.',
      },
      {
        name: 'Preventive care',
        blurb: 'Regular cleanings and check-ups to keep small problems small.',
      },
      {
        name: 'Deep cleaning',
        blurb: 'Cleaning below the gumline when gums need more than a routine cleaning.',
      },
      { name: '3D x-ray', blurb: 'Detailed three-dimensional imaging taken in the office.' },
    ],
  },
  {
    title: 'Repairing teeth',
    services: [
      { name: 'Dental fillings', blurb: 'Repair teeth damaged by cavities.' },
      { name: 'Crowns and bridges', blurb: 'Cover a weakened tooth or bridge a gap.' },
      {
        name: 'Root canal treatment',
        blurb: 'Treat infection inside a tooth so the tooth can be kept.',
      },
      { name: 'Extractions', blurb: 'Remove a tooth when it cannot be saved.' },
    ],
  },
  {
    title: 'Replacing teeth',
    services: [
      { name: 'Dental implants', blurb: 'A long-term replacement for a missing tooth.' },
      {
        name: 'Full and partial dentures',
        blurb: 'Removable replacements for some or all of your teeth.',
      },
    ],
  },
  {
    title: 'Straighter, brighter smiles',
    services: [
      { name: 'Clear aligners', blurb: 'Straighten teeth with removable clear trays.' },
      { name: 'Teeth whitening', blurb: 'Lighten stained or discolored teeth.' },
    ],
  },
];

/** Primary navigation, in display order. */
export const nav = [
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About' },
  { href: '/new-patients', label: 'New patients' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/patient-resources', label: 'Resources' },
  { href: '/contact', label: 'Contact' },
] as const;

/** schema.org `Dentist` structured data for the home page. */
export function dentistJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    name: practice.name,
    url: `${SITE_URL}/`,
    telephone: practice.phone.schema,
    email: practice.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${practice.address.street} ${practice.address.suite}`,
      addressLocality: practice.address.city,
      addressRegion: practice.address.region,
      postalCode: practice.address.postalCode,
      addressCountry: practice.address.country,
    },
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
    founder: {
      '@type': 'Person',
      name: practice.dentist.name,
      honorificSuffix: practice.dentist.credential,
    },
    sameAs: [practice.links.facebook],
  };
}
