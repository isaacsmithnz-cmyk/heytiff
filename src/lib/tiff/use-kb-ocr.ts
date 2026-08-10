"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* The client half of reading scanned pages.

   NOT A LOOP, UNLIKE INGESTION. One press reads up to `OCR_RUN_CAP` pages and
   the answer says how many are still unread; a document with more than that
   gets another press. Ingestion has to finish or the document is unusable, so
   the browser drives it to completion — this is an optional extra spend, and a
   loop that kept spending after one click would take the choice away from the
   person who made it.

   ONE DOCUMENT AT A TIME, for the same reason the ingest queue is a queue: two
   runs would each read the page allowance before either had spent it. */

export type KbOcrProgress = {
  status: "ready" | "paused" | "failed";
  pagesRead: number;
  scannedLeft: number;
  resetsOn?: string;
  error?: string;
};

export const OCR_ENDPOINT = "/api/tiff/ocr";

const num = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The route's answer, trusted only for the shape it promised. */
export function asOcrProgress(raw: unknown): KbOcrProgress {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = String(r.status);
  return {
    status: status === "ready" || status === "paused" ? status : "failed",
    pagesRead: num(r.pagesRead),
    scannedLeft: num(r.scannedLeft),
    ...(typeof r.resetsOn === "string" ? { resetsOn: r.resetsOn } : {}),
    ...(typeof r.error === "string" && r.error ? { error: r.error } : {}),
  };
}

/** One run. Every failure that isn't an abort comes back as a `failed`
    progress rather than a throw — the row has a place to show a sentence. */
export async function postOcrRun(
  documentId: string,
  signal?: AbortSignal
): Promise<KbOcrProgress> {
  let res: Response;
  try {
    res = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { status: "failed", pagesRead: 0, scannedLeft: 0, error: "Couldn't reach the server." };
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
      pagesRead: 0,
      scannedLeft: 0,
      error: typeof error === "string" && error ? error : "Those pages couldn't be read.",
    };
  }

  return asOcrProgress(body);
}

export type KbOcrHandle = {
  /** documentId → the last run this page saw. Absent until one finishes. */
  progress: Record<string, KbOcrProgress>;
  /** The document currently being read, if any. */
  running: string | null;
  read: (documentId: string) => void;
};

export function useKbOcr(): KbOcrHandle {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, KbOcrProgress>>({});
  const [running, setRunning] = useState<string | null>(null);
  const busy = useRef(false);

  const read = useCallback(
    (documentId: string) => {
      if (busy.current || !documentId) return;
      busy.current = true;
      setRunning(documentId);
      setProgress((m) => {
        const next = { ...m };
        delete next[documentId];
        return next;
      });

      void (async () => {
        try {
          const result = await postOcrRun(documentId);
          setProgress((m) => ({ ...m, [documentId]: result }));
          /* The row's caveat and the quota line are both stale the moment a run
             lands, and neither is this component's to compute. */
          if (result.status !== "failed") router.refresh();
        } finally {
          busy.current = false;
          setRunning(null);
        }
      })();
    },
    [router]
  );

  return { progress, running, read };
}
