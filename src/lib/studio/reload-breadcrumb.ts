/* ── Why did the studio just go back to Home? ──

   The studio keeps everything it knows in client state, so when the tab does a
   full document load the design is gone from the screen and nothing on it says
   why. Isaac hit this repeatedly ("it jumps back to the design studio home page
   mid design") and the honest answer, after reading the code and the logs, was
   a shortlist rather than a cause: a deploy replacing the build under an open
   tab, a capability check that fails closed on a database blip, an auth gate
   that can turn a request into a hard navigation. All three produce the same
   silent, identical symptom.

   So this leaves a note. Each load records what the last one looked like when
   it ended, and each ending records enough to tell an ordinary departure from
   an abrupt one. The next time it happens the trail says which it was, instead
   of us reasoning about which it might have been.

   Deliberately local: localStorage only, no endpoint, no network, nothing
   personal — timestamps, a design id, and a build fingerprint. Read it with
   `__htDiag()` in the console. */

declare global {
  interface Window {
    /** the trail, for a person with a console open — see noteBoot */
    __htDiag?: () => BootNote[];
  }
}

/** what the app writes at each end of a session */
export interface Crumb {
  /** ISO time this was written */
  at: string;
  /** the design open at the time, if any — the thing whose loss is felt */
  design: string | null;
  /** short fingerprint of the JS build this tab was running */
  build: string;
  /** ms since the last real user gesture when the tab went away */
  sinceGesture: number | null;
  /** set when the page told us it was going (pagehide/beforeunload) */
  saidGoodbye: boolean;
}

/** what a fresh load concludes about the load before it */
export type Verdict =
  /** nothing to compare against — first visit on this machine */
  | "first-run"
  /** an ordinary in-app arrival: no prior tab was cut off */
  | "opened"
  /** the tab reloaded onto a DIFFERENT build — a deploy landed under it */
  | "reload-after-deploy"
  /** a full load on the same build, moments after a user gesture: they did it */
  | "reload-by-hand"
  /** a full load on the same build with nobody touching anything */
  | "reload-unexplained"
  /** the studio was torn down and rebuilt WITHOUT a document load — a very
      different animal from a reload, and the one the shell's pathname-keyed
      outlet produces. Worth its own name: the fixes are unrelated. */
  | "remount";

export interface BootNote {
  at: string;
  verdict: Verdict;
  /** how the browser says this document was loaded */
  navType: string;
  /** the design that was open when the previous session ended */
  lost: string | null;
  /** ms between the previous session's last sign of life and this load */
  gapMs: number | null;
  build: string;
  prevBuild: string | null;
}

const TRAIL_KEY = "ht-diag-trail";
const LAST_KEY = "ht-diag-last";
/** how many boots to keep — enough to see a pattern, small enough to ignore */
const TRAIL_MAX = 20;
/** a full load this soon after a gesture is the user's own doing (⌘R, a link) */
const BY_HAND_MS = 2500;

/* ── the decision, kept pure so it can be tested without a browser ── */
export function classify(input: {
  navType: string;
  prev: Crumb | null;
  build: string;
}): Verdict {
  const { navType, prev, build } = input;
  if (!prev) return "first-run";
  /* a client-side arrival is not a reload at all: the previous tab is this
     tab, still alive. Only a document load can lose the design. */
  if (navType !== "reload" && navType !== "navigate" && navType !== "back_forward") {
    return "opened";
  }
  if (navType === "back_forward") return "opened";
  /* nothing was open, so nothing was lost — the interesting cases all start
     with a design on screen */
  if (!prev.design) return "opened";
  /* both sides have to be KNOWN before a difference means anything — an
     unknown stamp compared against a real one is not evidence of a deploy */
  const known = prev.build !== UNKNOWN_BUILD && build !== UNKNOWN_BUILD;
  if (known && prev.build !== build) return "reload-after-deploy";
  if (prev.sinceGesture !== null && prev.sinceGesture <= BY_HAND_MS) return "reload-by-hand";
  return "reload-unexplained";
}

/** One line a person can read, rather than a shape they have to decode. */
export function describe(note: BootNote): string {
  switch (note.verdict) {
    case "reload-after-deploy":
      return `the tab reloaded onto a new build — a deploy landed under it (was on ${note.prevBuild}, now ${note.build})`;
    case "reload-by-hand":
      return "the tab reloaded right after a keypress or click — this one was you";
    case "reload-unexplained":
      return note.build === UNKNOWN_BUILD
        ? "the tab reloaded with nobody touching it — and this host publishes no build id, so a deploy can be neither blamed nor ruled out"
        : "the tab reloaded on the same build with nobody touching it — not a deploy, not you";
    case "remount":
      return "the studio was rebuilt without the page reloading — something remounted it, no document load involved";
    case "first-run":
      return "first visit on this machine — nothing to compare against";
    default:
      return "opened normally";
  }
}

/* ── browser bits ── */

/** The identity of the build this tab is running, handed down from the server
    (`VERCEL_DEPLOYMENT_ID`, the same value Skew Protection keys on). It is NOT
    derived from the page: the first attempt hashed the `<script src>` set,
    which changes the moment any lazily-loaded chunk arrives, so two loads of
    the SAME build disagreed and every reload read as a deploy. A diagnostic
    that cries wolf is worse than none.

    `UNKNOWN` when the host doesn't provide one — self-hosted, local, or the
    Vercel project's "Enable access to System Environment Variables" box left
    unchecked. An unknown build never accuses a deploy; it says it can't tell. */
export const UNKNOWN_BUILD = "?";
let buildStamp = UNKNOWN_BUILD;

export function setBuildStamp(stamp: string | null | undefined) {
  buildStamp = stamp || UNKNOWN_BUILD;
}

function buildPrint(): string {
  return buildStamp;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or a full quota — the trail is a nicety, never a duty */
  }
}

export function readTrail(): BootNote[] {
  return read<BootNote[]>(TRAIL_KEY) ?? [];
}

/** the last moment the person actually did something */
let lastGestureAt = 0;
export function noteGesture() {
  lastGestureAt = Date.now();
}

/** Write the "still here" / "going now" crumb. `saidGoodbye` separates a tab
    that was told it was closing from one that simply stopped existing. */
export function noteAlive(design: string | null, saidGoodbye: boolean) {
  const crumb: Crumb = {
    at: new Date().toISOString(),
    design,
    build: buildPrint(),
    sinceGesture: lastGestureAt ? Date.now() - lastGestureAt : null,
    saidGoodbye,
  };
  write(LAST_KEY, crumb);
}

/**
 * Called once when the studio mounts. Reads the previous session's last crumb,
 * decides what happened to it, appends that to the trail and says so once in
 * the console. Returns the note so a caller can act on it.
 */
/* One document, one boot. A second call means the studio was remounted inside
   a living page — which must NOT be read through `performance`'s navigation
   type, because that still describes the original document load and would
   dress a remount up as a reload. Telling those two apart is the entire point
   of this file, so the distinction is drawn here rather than inferred later.

   The 1s floor swallows React StrictMode's deliberate double-invoke in dev,
   which is not a remount anybody needs to hear about. */
let bootedAt = 0;

export function noteBoot(): BootNote | null {
  if (typeof window === "undefined") return null;
  if (bootedAt) {
    if (Date.now() - bootedAt < 1000) return null;
    const again: BootNote = {
      at: new Date().toISOString(),
      verdict: "remount",
      navType: "same-document",
      lost: read<Crumb>(LAST_KEY)?.design ?? null,
      gapMs: Date.now() - bootedAt,
      build: buildPrint(),
      prevBuild: null,
    };
    const t = readTrail();
    t.push(again);
    write(TRAIL_KEY, t.slice(-TRAIL_MAX));
    console.info(`[ht-diag] ${describe(again)}. Run __htDiag() for the trail.`);
    return again;
  }
  bootedAt = Date.now();
  const prev = read<Crumb>(LAST_KEY);
  const build = buildPrint();
  let navType = "unknown";
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav) navType = nav.type;
  } catch {
    /* no navigation timing — the verdict degrades, it doesn't fail */
  }
  const verdict = classify({ navType, prev, build });
  const note: BootNote = {
    at: new Date().toISOString(),
    verdict,
    navType,
    lost: prev?.design ?? null,
    gapMs: prev ? Date.now() - Date.parse(prev.at) : null,
    build,
    prevBuild: prev?.build ?? null,
  };
  const trail = readTrail();
  trail.push(note);
  write(TRAIL_KEY, trail.slice(-TRAIL_MAX));

  /* Only say something when something happened. A normal open is not news, and
     a console line per navigation would train everyone to ignore the one that
     matters. */
  if (verdict !== "opened" && verdict !== "first-run") {
    console.info(
      `[ht-diag] ${describe(note)}${note.lost ? ` — design ${note.lost} was open` : ""}. Run __htDiag() for the trail.`
    );
  }
  return note;
}
