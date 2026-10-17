/* WORDS TYPED IN A REPLY BOX AND NOT SENT YET (Isaac, 2026-10-18: "How can
   we make it save? The text in the reply box. Before sending.").

   Kept on the server, for the person who typed them, so a quote begun on the
   phone on site is there on the laptop (docs/migrations/reply_drafts.sql).
   One draft per person, per box, per thing the box is about. This file is
   what both sides agree on: which boxes keep a draft, and how big one is. */

/** The boxes that keep a draft, and what each is about. */
export const DRAFT_BOXES = ["quote"] as const;
export type DraftBox = (typeof DRAFT_BOXES)[number];

/** Longer than anyone types into a reply box; the table holds to it too. */
export const DRAFT_MAX = 20_000;

/** How long the typing has to stop before the draft is written. */
export const DRAFT_PAUSE_MS = 800;

export function draftBoxOf(v: unknown): DraftBox | null {
  return typeof v === "string" && (DRAFT_BOXES as readonly string[]).includes(v) ? (v as DraftBox) : null;
}

/** The thing a box is about, as the routes take a job: trimmed, at most 80. */
export function draftRefOf(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 80) : "";
}

/** The words as kept: whitespace alone is no draft, and nothing past the cap. */
export function draftBodyOf(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  return v.slice(0, DRAFT_MAX);
}
