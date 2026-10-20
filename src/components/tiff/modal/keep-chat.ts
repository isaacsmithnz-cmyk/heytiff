"use client";

import { loadThreads, saveThreads, THREAD_MESSAGES_MAX, type TiffMsg, type TiffThread } from "@/lib/tiff/threads";
import { pullThreads, pushThreads, threadsKept } from "@/lib/tiff/thread-sync";

/* THE CHAT IS KEPT (Isaac, 20 October 2026: Conversations said "No
   conversations yet" after a day of talking to her). Tiff's docked chat, on
   Home, in Design, on a job, is a conversation like the Library's: once her
   answer has landed it is kept as a thread in the same store Conversations
   reads (lib/tiff/threads), on this device at once and on the server behind
   it (lib/tiff/thread-sync). One chat, opened once, is one thread. */

export type ChatLine = { who: "you" | "tiff"; text: string };

/** The chat as a thread, or null while there's no exchange to keep (a
    question with no answer yet, or nothing said). Pure. A message already
    kept keeps the time it was first kept. */
export function chatThread(id: string, lines: readonly ChatLine[], now: number, before: TiffThread | null = null): TiffThread | null {
  const said = lines.map((l) => ({ who: l.who, text: l.text.trim() })).filter((l) => l.text);
  const first = said.find((l) => l.who === "you");
  if (!first || !said.some((l) => l.who === "tiff")) return null;
  const messages: TiffMsg[] = said.slice(-THREAD_MESSAGES_MAX).map((l, i) => {
    const was = before?.messages[i];
    const role = l.who === "you" ? "user" : "tiff";
    return { role, text: l.text, at: was && was.role === role && was.text === l.text ? was.at : now };
  });
  return { id, title: first.text.replace(/\s+/g, " ").slice(0, 120), updatedAt: before && sameMessages(before, messages) ? before.updatedAt : now, messages };
}

const sameMessages = (t: TiffThread, m: readonly TiffMsg[]) =>
  t.messages.length === m.length && t.messages.every((x, i) => x.role === m[i]!.role && x.text === m[i]!.text);

/** Keep the chat: newest first in this browser's threads, then on the server. */
export function keepChat(id: string, lines: readonly ChatLine[]): void {
  const all = loadThreads();
  const before = all.find((t) => t.id === id) ?? null;
  const thread = chatThread(id, lines, Date.now(), before);
  if (!thread || (before && sameMessages(before, thread.messages))) return;
  saveThreads([thread, ...all.filter((t) => t.id !== id)]);
  /* the first keep in a tab reads the server's first, which sends this up */
  if (threadsKept()) pushThreads();
  else void pullThreads();
}
