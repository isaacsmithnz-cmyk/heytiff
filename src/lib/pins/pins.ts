/* PINNED (docs/design.md rule 6): the records a person keeps in the sidebar.
   Pure: the shapes and the checks the route and the store share. The table
   is docs/migrations/nav_pins.sql. */

import type { RecordKind, RecordRef } from "@/lib/records/ref";

export type Pin = { ref: RecordRef; title: string; sub: string | null };

/** How many the sidebar keeps. Pinning one more lets the oldest go. */
export const PIN_MAX = 12;

const KINDS: readonly RecordKind[] = ["job", "visit", "agreement"];

export const pinKey = (ref: RecordRef) => `${ref.kind}:${ref.id}`;

/** A pin from untrusted input, trimmed to what the table holds, or null. */
export function pinOf(input: unknown): Pin | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const ref = o.ref as Record<string, unknown> | undefined;
  const kind = ref?.kind;
  const id = typeof ref?.id === "string" ? ref.id.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
  const sub = typeof o.sub === "string" && o.sub.trim() ? o.sub.trim().slice(0, 160) : null;
  if (!KINDS.includes(kind as RecordKind) || !id || id.length > 80 || !title) return null;
  return { ref: { kind: kind as RecordKind, id }, title, sub };
}

/** A record's reference from untrusted input, or null. */
export function refOf(input: unknown): RecordRef | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!KINDS.includes(o.kind as RecordKind) || !id || id.length > 80) return null;
  return { kind: o.kind as RecordKind, id };
}
