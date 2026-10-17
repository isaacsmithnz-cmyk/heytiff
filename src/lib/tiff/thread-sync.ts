"use client";

import {
  SYNCED_KEY,
  THREADS_PER_CALL,
  loadThreads,
  mergeThreads,
  pendingChanges,
  saveThreads,
  sigsOf,
  threadOf,
  threadSig,
  type SyncedMark,
  type TiffThread,
} from "./threads";

/* THE SERVER'S COPY OF TIFF'S THREADS, following the browser's.

   localStorage stays what the page reads and writes, at once and offline;
   this sends it up behind the page and brings other devices' threads down.
   `/api/tiff/threads` answers 503 until docs/migrations/tiff_threads.sql is
   applied (it is NOT YET), and then nothing here does anything at all: the
   threads stay on this device, as they always have.

   Two doors. `pullThreads` on first open: read the server's, merge them with
   this browser's (threads.ts, `mergeThreads`), and send up what the server
   doesn't have, which on the first open after the cutover is everything this
   browser held. `pushThreads` after every change, a moment after the last
   one: whatever changed since the server was last sent it. */

export const THREADS_ENDPOINT = "/api/tiff/threads";

/** How long the threads have to sit still before they go up. */
export const PUSH_PAUSE_MS = 700;

/** Whom the server keeps threads for in this tab; null until it said it does. */
let keptFor: string | null = null;

/** The server keeps this person's threads, so they follow them to other devices. */
export const threadsKept = (): boolean => keptFor !== null;

function readMark(): SyncedMark | null {
  try {
    const raw = localStorage.getItem(SYNCED_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as SyncedMark;
    return m && typeof m.who === "string" && m.sigs && typeof m.sigs === "object" ? m : null;
  } catch {
    return null;
  }
}

function writeMark(m: SyncedMark): void {
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify(m));
  } catch {
    /* without the mark the next open merges again, which is safe */
  }
}

const canFetch = () => typeof fetch === "function" && typeof window !== "undefined";

async function send(upsert: TiffThread[], remove: string[]): Promise<boolean> {
  for (let i = 0; i < Math.max(upsert.length, remove.length); i += THREADS_PER_CALL) {
    const res = await fetch(THREADS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upsert: upsert.slice(i, i + THREADS_PER_CALL), remove: remove.slice(i, i + THREADS_PER_CALL) }),
    });
    if (!res.ok) return false;
  }
  return true;
}

let flushing: Promise<void> | null = null;
let again = false;

/** Send up what changed since the server was last sent it. */
async function flush(): Promise<void> {
  if (!keptFor || !canFetch()) return;
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        again = false;
        const mark = readMark();
        if (!mark || mark.who !== keptFor) return;
        const threads = loadThreads();
        const { upsert, remove } = pendingChanges(threads, mark);
        if (upsert.length === 0 && remove.length === 0) return;
        if (!(await send(upsert, remove))) return;
        const sigs = { ...mark.sigs };
        for (const t of upsert) sigs[t.id] = threadSig(t);
        for (const id of remove) delete sigs[id];
        writeMark({ who: mark.who, sigs });
      } while (again);
    } catch {
      /* offline: the browser's copy holds, and the next change tries again */
    }
  })().finally(() => {
    /* after the assignment, never inside it: a run with nothing to send
       finishes before `flushing` is even set, and an inner `finally` would
       clear it first and leave the finished run standing in the way */
    flushing = null;
  });
  return flushing;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** The threads changed: send them up once they have sat still a moment. */
export function pushThreads(): void {
  if (!keptFor) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, PUSH_PAUSE_MS);
}

/* Read the server's threads and merge them with this browser's. Null when
   the server doesn't keep them (no table yet, signed out, offline), and the
   page carries on with what this browser holds. */
export async function pullThreads(): Promise<TiffThread[] | null> {
  if (!canFetch()) return null;
  try {
    const res = await fetch(THREADS_ENDPOINT, { headers: { accept: "application/json" } });
    if (!res.ok) {
      keptFor = null;
      return null;
    }
    const body = (await res.json()) as { ok?: boolean; who?: unknown; threads?: unknown };
    if (!body?.ok || typeof body.who !== "string" || !Array.isArray(body.threads)) {
      keptFor = null;
      return null;
    }
    const server = body.threads.map(threadOf).filter((t): t is TiffThread => t !== null);
    /* read the browser's copy NOW, after the round trip, so a question sent
       while the server was answering is in what is merged */
    const { threads } = mergeThreads(loadThreads(), server, readMark(), body.who);
    saveThreads(threads);
    keptFor = body.who;
    // the server holds what it sent; everything else goes up with the next flush
    writeMark({ who: body.who, sigs: sigsOf(server) });
    await flush();
    return threads;
  } catch {
    keptFor = null;
    return null;
  }
}

/** For tests: forget whom this tab keeps threads for. */
export function resetThreadSync(): void {
  keptFor = null;
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = null;
  again = false;
}
