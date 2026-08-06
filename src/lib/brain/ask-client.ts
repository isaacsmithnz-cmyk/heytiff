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
};

export async function askBrain(
  input: {
    question: string;
    target?: NoteTarget;
    targetLabel?: string;
    signal?: AbortSignal;
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
        target:
          input.target && input.target.kind !== "none" && input.target.id
            ? { kind: input.target.kind, id: input.target.id }
            : undefined,
        targetLabel: input.targetLabel,
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
