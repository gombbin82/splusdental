/**
 * Structured JSON logs on stdout; Cloud Logging picks up `severity` and `message`.
 * Never pass PHI, tokens, or Stripe secrets here. Staff email only on mutating actions.
 */
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogSink = (line: string) => void;

let sink: LogSink = (line) => process.stdout.write(line + '\n');

/** Test hook: redirect log output. Returns the previous sink. */
export function setLogSink(next: LogSink): LogSink {
  const prev = sink;
  sink = next;
  return prev;
}

export function log(severity: Severity, message: string, fields: Record<string, unknown> = {}) {
  sink(JSON.stringify({ severity, message, ...fields, time: new Date().toISOString() }));
}
