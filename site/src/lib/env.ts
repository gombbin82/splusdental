/**
 * Build-time flags.
 *
 * PUBLIC_NOINDEX=true (set for staging builds) adds `<meta name="robots" content="noindex">` to
 * every page, serves a disallow-all robots.txt.
 */
export const noindex: boolean = import.meta.env.PUBLIC_NOINDEX === 'true';

/**
 * GA4 measurement ID (PUBLIC_GA_ID, set only for prod builds). Empty = no analytics code at all.
 * Even when set, GA loads only after the visitor accepts the consent banner.
 */
const rawGaId = (import.meta.env.PUBLIC_GA_ID ?? '').trim();
export const gaId: string = /^G-[A-Z0-9]{4,20}$/.test(rawGaId) ? rawGaId : '';
