/* The measuring switches. Isomorphic — no imports, no browser API at module
   scope, so the server actions that validate these can share the same list
   as the browser that sets them.

   WHY THESE EXIST AT ALL: both settings they override are BUILD-TIME. The
   voice transport is a `NEXT_PUBLIC_` flag inlined at build; the routing
   effort is a constant in `note-brain.ts`. Comparing either one against the
   other would mean a redeploy of production per measurement, which is not a
   way anyone finds out whether a change was worth it. A query parameter that
   lasts the browser session is.

   sessionStorage, not localStorage, and that is the whole safety story: an
   override is for an afternoon of measuring, and one that outlived the tab
   would eventually have somebody debugging a transport or an effort level
   nobody remembers choosing. `?voice=` or `?effort=` with an unrecognised
   value clears it, so there is always a way back without clearing storage.

   READ THESE IN EVENT HANDLERS, NEVER DURING RENDER. They differ between
   server and client by construction; a value that reached the markup would
   tear hydration. */

/** One override. Returns the stored choice, or null for "use the default". */
function sessionOverride(key: string, param: string, allowed: readonly string[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    const asked = new URLSearchParams(window.location.search).get(param);
    if (asked !== null) {
      if (allowed.includes(asked)) sessionStorage.setItem(key, asked);
      else sessionStorage.removeItem(key);
    }
    const chosen = sessionStorage.getItem(key);
    return chosen && allowed.includes(chosen) ? chosen : null;
  } catch {
    /* private mode, or storage disabled — the build-time default decides */
    return null;
  }
}

/* ── the voice transport ── */

const TRANSPORT_KEY = "heytiff.voice.transport";
const TRANSPORTS = ["live", "batch"] as const;

/** Inlined at build time — a live transcript is opt-in per deployment. */
const REALTIME = process.env.NEXT_PUBLIC_VOICE_REALTIME === "1";

/** True when dictation should stream. `?voice=live` / `?voice=batch` beats
    the build flag for the rest of the browser session. */
export function transportChoice(): boolean {
  const chosen = sessionOverride(TRANSPORT_KEY, "voice", TRANSPORTS);
  if (chosen === "live") return true;
  if (chosen === "batch") return false;
  return REALTIME;
}

/* ── the routing call's effort ── */

/** The five levels Claude Opus 5 accepts, verified against the Anthropic API
    reference on 2026-08-04 (house rule: a vendor's enum is fetched, never
    recalled). `high` is both the API default and what `note-brain.ts` ships. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** The house guard convention (cf. `isSeverity`): the list and the test that
    narrows to it live together, so adding a level is one edit rather than
    three. Exported because the SERVER re-checks whatever the client sends —
    an effort level is a cost lever, and a route handler is reachable
    directly. */
export const isEffort = (v: unknown): v is Effort =>
  (EFFORTS as readonly unknown[]).includes(v);

const EFFORT_KEY = "heytiff.note.effort";

/** The effort to route this note at, or null to use the shipped default.
    `?effort=low|medium|high|xhigh|max`. */
export function effortChoice(): Effort | null {
  const chosen = sessionOverride(EFFORT_KEY, "effort", EFFORTS);
  return isEffort(chosen) ? chosen : null;
}
