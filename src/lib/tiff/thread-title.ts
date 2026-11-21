import type { TiffMsg, TiffThread } from "./threads";

/* A CONVERSATION NAMED FOR WHAT IT'S ABOUT (Isaac, 22 November 2026: "can we
   also give chats a better title?"). A thread was named by its first words, cut
   short: "What day is it toda", "What", "Need help with a u2 fault on a daikin".
   Once Tiff has answered, she names it in a few words from the question and her
   answer ("Daikin U2 fault on a small split"), and that name is kept on its own
   (tiff_threads.named), so a phone or a browser sending the first words back
   never writes over it. A name somebody typed (the web's Rename) is not first
   words, so it wins over hers. */

/** The most a name of hers runs to. */
export const NAME_MAX = 60;

const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const firstOf = (messages: readonly TiffMsg[], role: TiffMsg["role"]) => messages.find((m) => m.role === role && m.text.trim())?.text ?? "";

/** Is this title the thread's first words, as the phone and the web name a thread before anyone renames it? */
export function isFirstWords(title: string, messages: readonly TiffMsg[]): boolean {
  const t = flat(title).replace(/…$/, "").trim();
  if (!t || t === "talking to tiff") return true;
  return flat(firstOf(messages, "user")).startsWith(t);
}

/** The name a thread is shown by: hers, unless somebody typed one. */
export function shownTitle(title: string, named: string | null | undefined, messages: readonly TiffMsg[]): string {
  return named && isFirstWords(title, messages) ? named : title;
}

/** What she names a thread from, once she has answered, or null while there's nothing to name it by. */
export function nameFrom(t: TiffThread): { asked: string; answer: string } | null {
  if (!isFirstWords(t.title, t.messages)) return null;
  const asked = firstOf(t.messages, "user").trim();
  const answer = firstOf(t.messages, "tiff").trim();
  return asked && answer ? { asked: asked.slice(0, 1_000), answer: answer.slice(0, 1_500) } : null;
}

/** Her name as it's kept: one line, no quotes or full stop, short; null for nothing usable. */
export function shapeName(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().replace(/^["'“‘]+|["'”’]+$/g, "").replace(/[.。]+$/, "").trim() : "";
  if (s.length < 2 || s.length > NAME_MAX) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
