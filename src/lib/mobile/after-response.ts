import "server-only";

import { after } from "next/server";

/** Run a push (or any best-effort send) once the answer has gone; outside
    a request (a test, a script) straight away. A failure is logged, never
    thrown: nothing waits on it. */
export function afterResponse(fn: () => Promise<unknown>, what = "a push"): void {
  const run = () => fn().catch((err: unknown) => console.error(`[push] ${what} failed: ${err instanceof Error ? err.message : String(err)}`));
  try {
    after(run);
  } catch {
    void run();
  }
}
