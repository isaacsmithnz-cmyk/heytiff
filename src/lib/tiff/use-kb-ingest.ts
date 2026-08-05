"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* The client half of ingestion: the loop that keeps asking the server for the
   next twenty pages until a document is finished with.

   ONE DOCUMENT AT A TIME, ALWAYS. Two loops running together would each read
   the page allowance before either had spent it, so an org near its cap would
   overspend by a whole batch per parallel document — and the second one would
   then park at `paused` having already been billed. The queue is therefore a
   real queue: everything enqueued anywhere on the page joins the same line.

   THE LOOP IS A BOOKMARK, NOT A TRANSACTION. Aborting on unmount stops US
   calling again; the batch already in flight finishes server-side and advances
   `next_page` as normal. Closing the drawer, or the tab, costs nothing — the
   document resumes from its bookmark on the next visit, which is exactly what
   the adoption pass below does.

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
};

export const INGEST_ENDPOINT = "/api/tiff/ingest";

/* A ceiling on how many times one document may be asked for. The bookmark
   advances every successful batch, so a real document always terminates; this
   only catches a server answering `processing` forever, which would otherwise
   be an infinite loop in a browser tab. 400 batches is 8,000 pages — far past
   anything that fits the bucket's 50 MB. */
export const MAX_BATCHES = 400;

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
};

/** Batch after batch until this document stops being `processing`. Returns the
    last progress seen, or null if it was stopped before the first batch. */
export async function driveDocument(
  documentId: string,
  deps: IngestDeps
): Promise<KbIngestProgress | null> {
  const limit = deps.maxBatches ?? MAX_BATCHES;
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
