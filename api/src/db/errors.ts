// Postgres error helpers that work for both drivers. Drizzle wraps driver errors in a
// DrizzleQueryError whose message includes the SQL *parameters* (patient names, dates…), so
// never log `message` or `stack` of a database error: use `dbErrorCode` instead.

type MaybePgError = { code?: unknown; cause?: unknown; name?: unknown };

/** SQLSTATE of the first error in the cause chain that has one, e.g. '23505'. */
export function dbErrorCode(err: unknown): string | undefined {
  for (
    let e = err as MaybePgError | undefined, i = 0;
    e && i < 5;
    e = e.cause as MaybePgError, i++
  ) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => dbErrorCode(err) === '23505';
/** 23503 foreign_key_violation, or 23001 restrict_violation (ON DELETE RESTRICT). */
export const isForeignKeyViolation = (err: unknown) => {
  const code = dbErrorCode(err);
  return code === '23503' || code === '23001';
};

/** True for errors that came from the database layer (and so may carry parameter values). */
export function isDbError(err: unknown): boolean {
  const name = (err as MaybePgError | undefined)?.name;
  return name === 'DrizzleQueryError' || dbErrorCode(err) !== undefined;
}
