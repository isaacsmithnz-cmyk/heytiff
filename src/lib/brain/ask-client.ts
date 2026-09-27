"use client";

/* The browser's half of asking — reads /api/brain/ask's NDJSON and hands the
   caller typed events. Same reader shape as tiff/ask-client, small enough to
   not share code with it: the two wires will drift apart when the assistant
   swaps onto this brain, and a premature abstraction would have to survive
   that. */

import type { NoteTarget } from "@/app/actions/workboard-notes";

export type BrainAskHandlers = {
  onDelta: (text: string) => void;
  onTool: (label: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
  /** Tiff moved the screen: go to `href`. Only ever an address inside the
      dashboard (see `movesTo`); the turn is over once it arrives. */
  onScreen?: (href: string, label: string) => void;
};

/** The address a `screen` event may move to, or null. The server builds
    these from the nav and the record links; this is the second lock, not the
    first: the same origin, and the dashboard itself or a page inside it
    (Home is `/dashboard`), so no `javascript:`, no other host, no
    `/dashboardx`. */
export function movesTo(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname !== "/dashboard" && !url.pathname.startsWith("/dashboard/")) return null;
  return `${url.pathname}${url.search}`;
}

export async function askBrain(
  input: {
    question: string;
    /** The screen they're on, by its nav name. */
    screen?: string;
    target?: NoteTarget;
    targetLabel?: string;
    /** The Tiff modal's conversation so far, oldest first. The route keeps
        the last six, you and Tiff only, and replays them ahead of the
        question, so "and the one at Smith St?" means something. */
    history?: readonly { who: "you" | "tiff"; text: string }[];
    signal?: AbortSignal;
    /** The words were a move request (lib/tiff/moves): the route runs the
        loop at low effort for it, as decided on 27 September. */
    intent?: "move";
  },
  handlers: BrainAskHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/brain/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: input.signal,
      body: JSON.stringify({
        question: input.question,
        /* Where they are: the screen, and the record the modal is aimed at.
           The route checks every part; the model reads it as place. */
        page: {
          ...(input.screen ? { screen: input.screen } : {}),
          ...(input.target && input.target.kind !== "none" && input.target.id
            ? { target: { kind: input.target.kind, id: input.target.id, label: input.targetLabel } }
            : {}),
        },
        ...(input.history?.length
          ? { history: input.history.map((t) => ({ who: t.who, text: t.text })) }
          : {}),
        ...(input.intent ? { intent: input.intent } : {}),
      }),
    });
  } catch {
    if (!input.signal?.aborted) handlers.onError("Couldn't reach the assistant.");
    return;
  }

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    handlers.onError(body?.error ?? "That couldn't be answered just now.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // a torn line mid-stream; the next read completes it or drops it
    }
    if (event.t === "delta") handlers.onDelta(String(event.text ?? ""));
    else if (event.t === "tool") handlers.onTool(String(event.label ?? ""));
    else if (event.t === "screen") {
      /* A move is the end of the turn: nothing after it (a torn connection
         included) is reported as a cut-off answer. */
      finished = true;
      const to = movesTo(String(event.href ?? ""), window.location.origin);
      if (to) handlers.onScreen?.(to, String(event.label ?? ""));
      else handlers.onError("That couldn't be opened.");
    }
    else if (event.t === "err") {
      handlers.onError(String(event.message ?? "Something went wrong."));
      finished = true;
    } else if (event.t === "done") {
      handlers.onDone();
      finished = true;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    if (buffer) handle(buffer);
    /* The stream ended without `done` or `err` — the connection died
       mid-answer. Say so rather than leaving a half-sentence hanging. */
    if (!finished && !input.signal?.aborted) {
      handlers.onError("The answer was cut off. Try again.");
    }
  } catch {
    if (!input.signal?.aborted) handlers.onError("The answer was cut off. Try again.");
  }
}
