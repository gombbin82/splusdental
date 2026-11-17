/**
 * Build-time flags.
 *
 * PUBLIC_NOINDEX=true (set for staging builds) adds `<meta name="robots" content="noindex">` to
 * every page, serves a disallow-all robots.txt.
 */
export const noindex: boolean = import.meta.env.PUBLIC_NOINDEX === 'true';
