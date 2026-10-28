import type { AskSourceItem } from "./ask-client";

/* TIFF'S THREADS: what one is, where the browser keeps it, and how the
   browser's copy and the server's agree.

   A thread is a person's conversation with Tiff. The Library's ask and v2's
   Conversations show the same threads (components/tiff/assistant.tsx). They
   lived in localStorage alone, which lost them at the cutover and kept them
   on one device; docs/migrations/tiff_threads.sql gives them a table, NOT
   YET APPLIED. Until it is, the browser's copy is the only one and nothing
   here changes how the page behaves.

   With the table, localStorage stays the copy the page reads and writes at
   once, and the server copy follows it (thread-sync.ts). This file is the
   part both sides share, kept pure so it can be proven without a network:
   the shape, the check a server runs on what a browser sends, and the merge. */

export type TiffMsg = {
  role: "user" | "tiff";
  text: string;
  at: number;
  /** True when this answer was drawn from the library rather than general knowledge. */
  researched?: boolean;
  /** True when research found nothing and the answer is general knowledge anyway. */
  missed?: boolean;
  /** The document that covered nothing, when the search widened past it. */
  widenedFrom?: string;
  /** True when the answer hit the token ceiling and stops mid-thought. */
  truncated?: boolean;
  sources?: AskSourceItem[];
  /** What Tiff did before she answered, ticked in grey (Conversations). */
  steps?: string[];
  /** The email to Tiff this answer is about (email_in_messages.id): its job
      card is drawn under the words, its state read from the email's row. */
  email?: string;
};

export type TiffThread = { id: string; title: string; updatedAt: number; messages: TiffMsg[] };

/* v2: v1 rows are ignored rather than migrated (assistant.tsx says why). */
export const STORE_KEY = "heytiff.tiff.threads.v2";

/** Who this browser last kept threads for on the server, and what it sent. */
export const SYNCED_KEY = "heytiff.tiff.threads.synced.v1";

export const THREAD_ID_MAX = 80;
export const THREAD_TITLE_MAX = 200;
export const THREAD_MESSAGES_MAX = 400;
/** A thread as JSON, at most: sources carry their passages, so allow for long ones. */
export const THREAD_BYTES_MAX = 600_000;
/** Threads sent in one request, at most. */
export const THREADS_PER_CALL = 40;

const ID = /^[\w-]+$/;

/** The thread's id as the table takes it, or null. */
export function threadIdOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= THREAD_ID_MAX && ID.test(v) ? v : null;
}

function msgOf(v: unknown): TiffMsg | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (m.role !== "user" && m.role !== "tiff") return null;
  if (typeof m.text !== "string" || typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
  const out: TiffMsg = { role: m.role, text: m.text, at: m.at };
  if (m.researched === true) out.researched = true;
  if (m.missed === true) out.missed = true;
  if (typeof m.widenedFrom === "string") out.widenedFrom = m.widenedFrom;
  if (m.truncated === true) out.truncated = true;
  if (Array.isArray(m.sources)) out.sources = m.sources as AskSourceItem[];
  if (Array.isArray(m.steps) && m.steps.every((s) => typeof s === "string")) out.steps = m.steps as string[];
  if (typeof m.email === "string" && /^[0-9a-f-]{36}$/i.test(m.email)) out.email = m.email;
  return out;
}

/** A thread as a browser sent it, checked: the shape, the id, and the size. Null when it isn't one. */
export function threadOf(v: unknown): TiffThread | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const id = threadIdOf(t.id);
  const title = typeof t.title === "string" ? t.title.trim().slice(0, THREAD_TITLE_MAX) : "";
  if (!id || !title || typeof t.updatedAt !== "number" || !Number.isFinite(t.updatedAt)) return null;
  if (!Array.isArray(t.messages) || t.messages.length > THREAD_MESSAGES_MAX) return null;
  const messages: TiffMsg[] = [];
  for (const raw of t.messages) {
    const m = msgOf(raw);
    if (!m) return null;
    messages.push(m);
  }
  const thread: TiffThread = { id, title, updatedAt: t.updatedAt, messages };
  if (JSON.stringify(thread).length > THREAD_BYTES_MAX) return null;
  return thread;
}

/* ── the browser's copy ─────────────────────────────────────────────────── */

export function loadThreads(): TiffThread[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveThreads(next: TiffThread[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the threads just won't survive a refresh */
  }
}

/* ── the two copies, agreeing ───────────────────────────────────────────── */

/** What the server was last sent for each thread, and for whom. */
export type SyncedMark = { who: string; sigs: Record<string, string> };

/** Enough of a thread to tell that it changed: when it last moved, its name, its length. */
export const threadSig = (t: TiffThread): string => `${t.updatedAt}:${t.messages.length}:${t.title}`;

export const sigsOf = (threads: TiffThread[]): Record<string, string> =>
  Object.fromEntries(threads.map((t) => [t.id, threadSig(t)]));

const newestFirst = (a: TiffThread, b: TiffThread) => b.updatedAt - a.updatedAt;

/* THE MERGE, on first open and every open after.

   `mark` is what this browser last sent, and for whom; null means it never
   sent anything, which is the cutover: everything it holds goes up, once.

   - A thread on both sides: the one that moved last wins. On a tie, the
     browser's copy wins only when it changed since it was sent (a rename,
     which doesn't move a thread).
   - A thread only the browser has: new here, so it goes up, unless the
     server had it once (it is in the mark) and has it no more, which means
     it was deleted on another device, and it goes here too.
   - A thread only the server has: from another device, so it comes down.
   - The browser's copy belongs to someone else (the mark names another
     person): it is set aside and the server's threads are shown. Nothing of
     theirs is sent up under this person's name. */
export function mergeThreads(
  local: TiffThread[],
  server: TiffThread[],
  mark: SyncedMark | null,
  who: string,
): { threads: TiffThread[]; upload: TiffThread[] } {
  if (mark && mark.who !== who) return { threads: [...server].sort(newestFirst), upload: [] };

  const byId = new Map(server.map((t) => [t.id, t]));
  const out = new Map<string, TiffThread>();
  const upload: TiffThread[] = [];

  for (const l of local) {
    const s = byId.get(l.id);
    if (s) {
      const changedHere = !mark || mark.sigs[l.id] !== threadSig(l);
      const keepLocal = l.updatedAt > s.updatedAt || (l.updatedAt === s.updatedAt && changedHere);
      const kept = keepLocal ? l : s;
      out.set(l.id, kept);
      if (keepLocal && threadSig(l) !== threadSig(s)) upload.push(l);
      continue;
    }
    if (mark && l.id in mark.sigs) continue; // deleted on another device
    out.set(l.id, l);
    upload.push(l);
  }
  for (const s of server) if (!out.has(s.id)) out.set(s.id, s);

  return { threads: [...out.values()].sort(newestFirst), upload };
}

/** What has changed in the browser since the server was last sent it. */
export function pendingChanges(threads: TiffThread[], mark: SyncedMark): { upsert: TiffThread[]; remove: string[] } {
  const ids = new Set(threads.map((t) => t.id));
  return {
    upsert: threads.filter((t) => mark.sigs[t.id] !== threadSig(t)),
    remove: Object.keys(mark.sigs).filter((id) => !ids.has(id)),
  };
}
