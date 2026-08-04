/* The browser half of asking Tiff, and the wire contract both halves share.

   THE PROTOCOL IS NDJSON, one JSON object per line, flushed as it is produced.
   Not SSE: there is a single stream with no reconnection story, no event names
   and no last-event-id, so the framing SSE buys would be ceremony around a
   `\n`. Not one big JSON body either — the whole point is that the answer
   appears as it is written.

   A CHUNK IS NOT A LINE. `fetch`'s reader hands over whatever arrived, which
   routinely cuts a JSON object in half; the tail of every read is carried into
   the next one. That is the single thing this module must not get wrong, so
   the splitter is pure and tested on its own.

   THE EVENT UNION LIVES HERE, not on the server, because it is what a reader
   has to handle — the route imports it as a type and is checked against it. */

import type { KbCategory } from "./files";

/** One turn of prior conversation, text only — no sources, no ids. */
export type AskTurn = { role: "user" | "assistant"; text: string };

/** A source under a researched answer, numbered in the order it was cited. */
export type AskSourceItem = {
  n: number;
  chunkId: string;
  docId: string;
  title: string;
  category: KbCategory;
  pageFrom: number;
  pageTo: number;
  /** The passage the answer was drawn from, for the peek panel. */
  excerpt: string;
};

export type AskTraceCategory = { hits: number; topDoc: string | null };

export type AskEvent =
  /** Research mode, after retrieval: where Tiff looked and what it found. */
  | {
      t: "trace";
      categories: Record<KbCategory, AskTraceCategory>;
      winners: KbCategory[];
      terms: string[];
    }
  /** Research mode, zero hits — the answer that follows is general knowledge. */
  | { t: "miss" }
  | { t: "delta"; text: string }
  /** After the final message, citation-ordered. Uncited documents are absent. */
  | { t: "sources"; items: AskSourceItem[] }
  /** The answer hit the token ceiling and stops mid-thought. */
  | { t: "trunc" }
  | { t: "done" }
  | { t: "err"; message: string };

export const ASK_ENDPOINT = "/api/tiff/ask";

/* Split what has arrived so far into whole lines plus the unfinished tail.

   Blank lines are dropped rather than passed on as `""` — a trailing newline
   at the end of a write produces one every time, and it is not an event. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  // the last piece has no newline after it yet: it may be half an object
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

const UNREACHABLE = "Couldn't reach Tiff just now — check your connection and try again.";
const FAILED = "Tiff couldn't answer that just now.";

const aborted = (signal: AbortSignal | undefined, err: unknown): boolean =>
  Boolean(signal?.aborted) || (err instanceof Error && err.name === "AbortError");

export type AskInput = {
  question: string;
  research: boolean;
  history: AskTurn[];
  onEvent: (event: AskEvent) => void;
  signal?: AbortSignal;
};

/* Ask, and report each event as it lands.

   Never throws and never rejects: every outcome is an event, including the
   failures, because the screen has one place to show a sentence and one place
   to offer Retry. An abort is the exception — the caller asked for it, so it
   ends silently with no error bubble.

   The stream is not closed early on `done`/`err`: the server closes after
   either, and draining is what releases the connection. */
export async function askTiff(input: AskInput): Promise<void> {
  const { question, research, history, onEvent, signal } = input;

  let response: Response;
  try {
    response = await fetch(ASK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, research, history }),
      signal,
    });
  } catch (err) {
    if (aborted(signal, err)) return;
    onEvent({ t: "err", message: UNREACHABLE });
    return;
  }

  if (!response.ok || !response.body) {
    let message = FAILED;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error) message = body.error;
    } catch {
      /* an error response that isn't JSON tells us nothing the ladder doesn't */
    }
    onEvent({ t: "err", message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emit = (line: string) => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return; // a line we can't read is a line we skip, not a failed answer
    }
    const e = event as AskEvent;
    if (e && typeof e === "object" && typeof e.t === "string") onEvent(e);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const split = splitLines(buffer);
      buffer = split.rest;
      for (const line of split.lines) emit(line);
    }
    // a final write with no trailing newline still has to be read
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) emit(tail);
  } catch (err) {
    if (aborted(signal, err)) return;
    onEvent({ t: "err", message: UNREACHABLE });
  }
}
