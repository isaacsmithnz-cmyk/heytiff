"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BackfillResult, BackfillStop } from "./backfill";

/* The client half of the embedding backfill: the loop that keeps asking for
   the next sixty-four passages until none are left.

   THE SAME SHAPE AS use-kb-ingest, deliberately. There is no queue on the
   server, so the browser is the loop; aborting on unmount stops US asking, not
   the batch in flight, and the batch already sent keeps whatever vectors it
   wrote. Nothing is transactional and nothing needs to be — every call reads
   what is still null.

   IT STOPS ON A REASON, AND ON NO PROGRESS. A rate-limited account would
   otherwise answer 429 to four hundred requests in a row; and a server that
   keeps saying "106 left" while filling in none of them is a bug, not a
   backlog, so the loop treats a batch that did nothing as the end of the run
   rather than as a reason to ask again.

   THE DECISION IS PURE. `runBackfill` takes a `post` and knows nothing about
   React, fetch or routing, because "did it stop at the right moment" is the
   part a browser makes hardest to observe. */

export const BACKFILL_ENDPOINT = "/api/tiff/embed-backfill";

/** A ceiling on how many times one run may ask. 400 batches is 25,600
    passages — far past anything the bucket's 50 MB per document can produce —
    and it only ever catches a server that never finishes. */
export const MAX_BACKFILL_BATCHES = 400;

const STOPS: readonly BackfillStop[] = ["rate-limited", "unconfigured", "failed"];

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

/** The route's answer, trusted only for the shape it promised. */
export function asBackfillResult(raw: unknown): BackfillResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const stopped = String(r.stopped) as BackfillStop;
  return {
    done: num(r.done),
    remaining: num(r.remaining),
    ...(STOPS.includes(stopped) ? { stopped } : {}),
  };
}

/** One batch. Every failure that isn't an abort comes back as a stopped result
    rather than a throw — the line on the screen has somewhere to say it. */
export async function postBackfillBatch(signal?: AbortSignal): Promise<BackfillResult> {
  let res: Response;
  try {
    res = await fetch(BACKFILL_ENDPOINT, { method: "POST", signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { done: 0, remaining: 0, stopped: "failed" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) return { done: 0, remaining: 0, stopped: "failed" };
  return asBackfillResult(body);
}

export type BackfillDeps = {
  /** One batch. */
  post: () => Promise<BackfillResult>;
  /** The running totals, after each batch. */
  onProgress?: (result: BackfillResult) => void;
  /** True once the caller has gone away — checked between batches, never mid-flight. */
  stopped?: () => boolean;
  maxBatches?: number;
};

/** Batch after batch until nothing is left. Returns the run's totals: `done`
    is everything this run filled in, `remaining` is the last count seen. */
export async function runBackfill(deps: BackfillDeps): Promise<BackfillResult> {
  const limit = deps.maxBatches ?? MAX_BACKFILL_BATCHES;
  let done = 0;
  let remaining = 0;

  for (let i = 0; i < limit; i++) {
    if (deps.stopped?.()) break;

    let batch: BackfillResult;
    try {
      batch = await deps.post();
    } catch {
      // an abort is the page going away, not a run that failed
      if (deps.stopped?.()) break;
      return { done, remaining, stopped: "failed" };
    }

    done += batch.done;
    remaining = batch.remaining;
    deps.onProgress?.({ done, remaining, ...(batch.stopped ? { stopped: batch.stopped } : {}) });

    if (batch.stopped) return { done, remaining, stopped: batch.stopped };
    if (remaining <= 0) return { done, remaining };
    // work left and none of it done: asking again would only repeat it
    if (batch.done <= 0) return { done, remaining, stopped: "failed" };
  }

  return { done, remaining };
}

export type KbBackfillHandle = {
  running: boolean;
  /** Passages filled in during this run. */
  done: number;
  /** Passages still without a vector, as of the last answer. */
  remaining: number;
  stopped: BackfillStop | null;
  start: () => void;
};

/** Drive the backfill from a screen. `initialRemaining` is the server's count,
    so the line can say "12 of 106" before the first batch comes back. */
export function useKbBackfill(initialRemaining: number): KbBackfillHandle {
  const router = useRouter();
  const [state, setState] = useState<{ done: number; remaining: number; stopped: BackfillStop | null }>({
    done: 0,
    remaining: Math.max(0, initialRemaining),
    stopped: null,
  });
  const [running, setRunning] = useState(false);

  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  /* Aborting on unmount stops the asking, not the batch in flight — whatever
     that one writes is kept, and the next visit reads a smaller backlog. */
  useEffect(() => {
    abort.current = new AbortController();
    return () => abort.current?.abort();
  }, []);

  const start = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setState((s) => ({ ...s, done: 0, stopped: null }));

    void (async () => {
      const stopped = () => abort.current?.signal.aborted ?? false;
      try {
        await runBackfill({
          post: () => postBackfillBatch(abort.current?.signal),
          stopped,
          onProgress: (r) =>
            setState({ done: r.done, remaining: r.remaining, stopped: r.stopped ?? null }),
        });
      } finally {
        busy.current = false;
        setRunning(false);
        // the count on the page is the server's, and it is now wrong
        if (!stopped()) router.refresh();
      }
    })();
  }, [router]);

  return { ...state, running, start };
}
