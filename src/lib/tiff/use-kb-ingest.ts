"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* The client half of ingestion: WATCHING the server read a document, and
   restarting it if nobody is.

   THE SERVER FINISHES WHAT IT STARTS. A call no longer means "do one batch" —
   it means "read this document until you run out of invocation", and the
   answer says `continuing` when work carries on behind it. So this loop is no
   longer the engine; it is the progress display, plus the thing that starts a
   document nobody is reading. Closing the tab costs the WATCHING, not the
   work.

   A `busy` ANSWER IS NORMAL, AND MUST NOT BE A HOT LOOP. Whoever holds the
   claim is working; asking again immediately would spin at network speed for
   the length of a 400-page manual. So a busy answer waits before the next
   ask — and it is still an ASK rather than a passive poll, because if the
   invocation that held the claim died, this is what takes it over.

   ONE DOCUMENT AT A TIME, ALWAYS. Two loops running together would each read
   the page allowance before either had spent it, so an org near its cap would
   overspend by a whole batch per parallel document — and the second one would
   then park at `paused` having already been billed. The queue is therefore a
   real queue: everything enqueued anywhere on the page joins the same line.

   THE DECISIONS ARE PURE. `driveDocument` and `runIngestQueue` take a `post`
   and know nothing about React, fetch or routing, because "did the loop stop
   at the right moment, in the right order" is the part that must never be
   wrong and the part a browser makes hardest to observe. */

export type KbIngestStatus = "processing" | "paused" | "ready" | "failed";

export type KbIngestProgress = {
  status: KbIngestStatus;
  /** Pages read so far, across every batch. */
  pagesDone: number;
  /** Null until the document has been opened once. */
  pageCount: number | null;
  chunkCount?: number;
  /** Set when paused: the day the page allowance resets. */
  resetsOn?: string;
  /** Set when failed. */
  error?: string;
  /** Somebody else holds the claim — this is the row's state, not new work. */
  busy?: boolean;
  /** The server is reading on after answering; nothing more to start. */
  continuing?: boolean;
};

export const INGEST_ENDPOINT = "/api/tiff/ingest";

/* A ceiling on how many times one document may be asked for. The bookmark
   advances every successful batch, so a real document always terminates; this
   only catches a server answering `processing` forever, which would otherwise
   be an infinite loop in a browser tab. 400 batches is 8,000 pages — far past
   anything that fits the bucket's 50 MB. */
export const MAX_BATCHES = 400;

/** How long to wait before asking again about a document somebody else is
    reading. Long enough not to spin, short enough that a batch finishing is
    visible on the row about when it happens. */
export const POLL_MS = 4_000;

const TERMINAL: readonly KbIngestStatus[] = ["ready", "paused", "failed"];

const num = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The route's answer, trusted only for the shape it promised. */
export function asProgress(raw: unknown): KbIngestProgress {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = String(r.status) as KbIngestStatus;
  return {
    status: TERMINAL.includes(status) || status === "processing" ? status : "failed",
    pagesDone: num(r.pagesDone),
    pageCount: r.pageCount === null || r.pageCount === undefined ? null : num(r.pageCount),
    chunkCount: num(r.chunkCount),
    ...(typeof r.resetsOn === "string" ? { resetsOn: r.resetsOn } : {}),
    ...(typeof r.error === "string" && r.error ? { error: r.error } : {}),
    ...(r.busy === true ? { busy: true } : {}),
    ...(r.continuing === true ? { continuing: true } : {}),
  };
}

/* One batch. Every failure that isn't an abort comes back as a `failed`
   progress rather than a throw: the row has a place to show a sentence, and
   the queue must carry on to the next document either way. */
export async function postIngestBatch(
  documentId: string,
  signal?: AbortSignal
): Promise<KbIngestProgress> {
  let res: Response;
  try {
    res = await fetch(INGEST_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { status: "failed", pagesDone: 0, pageCount: null, error: "Couldn't reach the server." };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const error = (body as { error?: unknown })?.error;
    return {
      status: "failed",
      pagesDone: 0,
      pageCount: null,
      error: typeof error === "string" && error ? error : "That document couldn't be processed.",
    };
  }

  return asProgress(body);
}

export type IngestDeps = {
  /** One batch for this document. */
  post: (documentId: string) => Promise<KbIngestProgress>;
  onProgress?: (documentId: string, progress: KbIngestProgress) => void;
  /** Called once per document, when it reaches ready / paused / failed. */
  onSettled?: (documentId: string, progress: KbIngestProgress) => void;
  /** True once the caller has gone away — checked between batches, never mid-flight. */
  stopped?: () => boolean;
  maxBatches?: number;
  /** Injected so a test can drive the wait without a real timer. */
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Ask until this document stops being `processing`. Returns the last progress
    seen, or null if it was stopped before the first ask.

    Every pass is an ASK, not a poll: if the answer is `busy` the server is
    already reading and this waits, but if the invocation that held the claim
    died, the same call takes the claim over and the document carries on. That
    is the whole recovery story — there is no other retry anywhere. */
export async function driveDocument(
  documentId: string,
  deps: IngestDeps
): Promise<KbIngestProgress | null> {
  const limit = deps.maxBatches ?? MAX_BATCHES;
  const wait = deps.wait ?? sleep;
  const pollMs = deps.pollMs ?? POLL_MS;
  let last: KbIngestProgress | null = null;

  for (let i = 0; i < limit; i++) {
    if (deps.stopped?.()) return last;

    let progress: KbIngestProgress;
    try {
      progress = await deps.post(documentId);
    } catch {
      // an abort is the page going away, not a document that failed
      if (deps.stopped?.()) return last;
      progress = {
        status: "failed",
        pagesDone: last?.pagesDone ?? 0,
        pageCount: last?.pageCount ?? null,
        error: "Couldn't reach the server.",
      };
    }

    last = progress;
    deps.onProgress?.(documentId, progress);

    if (progress.status !== "processing") {
      deps.onSettled?.(documentId, progress);
      return progress;
    }

    /* Work is happening without us — either somebody else holds the claim, or
       the answer we just got said it is carrying on behind the response. Wait
       before asking again, and check `stopped` after the wait as well as
       before it: four seconds is long enough for the page to have gone. */
    if (progress.busy || progress.continuing) {
      await wait(pollMs);
      if (deps.stopped?.()) return last;
    }
  }

  return last;
}

/** The documents in order, one after the next — never two at once. */
export async function runIngestQueue(ids: string[], deps: IngestDeps): Promise<void> {
  for (const id of ids) {
    if (deps.stopped?.()) return;
    await driveDocument(id, deps);
  }
}

export type KbIngestHandle = {
  /** documentId → the last progress this page saw. */
  progress: Record<string, KbIngestProgress>;
  /** True while any document is being driven. */
  busy: boolean;
  /** Join the queue. Ids already driven this mount are ignored. */
  start: (ids: string[]) => void;
};

/* `processingIds` are the documents the SERVER says are mid-flight — anything
   left behind by a closed tab. Adopting them on mount is the whole
   resume-on-next-visit behaviour: no cron, no queue, just the next person who
   opens the library finishing what the last one started. */
export function useKbIngest(processingIds: readonly string[] = []): KbIngestHandle {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, KbIngestProgress>>({});
  const [busy, setBusy] = useState(false);

  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const seen = useRef<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);

  /* Declared FIRST, so the controller exists before the adoption effect below
     runs. Aborting on unmount stops the asking, not the batch in flight. */
  useEffect(() => {
    abort.current = new AbortController();
    return () => abort.current?.abort();
  }, []);

  const pump = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setBusy(true);

    void (async () => {
      const stopped = () => abort.current?.signal.aborted ?? false;
      try {
        while (queue.current.length > 0 && !stopped()) {
          const id = queue.current.shift();
          if (!id) continue;
          await driveDocument(id, {
            post: (documentId) => postIngestBatch(documentId, abort.current?.signal),
            stopped,
            onProgress: (documentId, p) => setProgress((m) => ({ ...m, [documentId]: p })),
            /* The server-rendered rows and the quota line are both stale the
               moment a document finishes — refreshing per document rather than
               per batch keeps a 400-page manual from refetching twenty times. */
            onSettled: () => {
              if (!stopped()) router.refresh();
            },
          });
        }
      } finally {
        running.current = false;
        setBusy(false);
      }
    })();
  }, [router]);

  const start = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => id && !seen.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) seen.current.add(id);
      queue.current.push(...fresh);
      pump();
    },
    [pump]
  );

  /* Keyed on the ids themselves: a router.refresh() re-renders this list every
     time a document settles, and `seen` is what stops the survivors being
     queued again on each pass. */
  const key = processingIds.join(",");
  useEffect(() => {
    if (key) start(key.split(","));
  }, [key, start]);

  return { progress, busy, start };
}
