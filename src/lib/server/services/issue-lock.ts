/**
 * Process-wide async mutex that serialises every operation touching the
 * invoice number series: issuing, crediting, and editing next_invoice_number.
 * With a single Node process and a synchronous SQLite driver, this guarantees
 * that "read next number -> render PDF -> assign number in transaction" can
 * never interleave with another such sequence.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withIssueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}
