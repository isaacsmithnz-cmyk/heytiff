/* The Paperwork screen's tabs — the list, and how a `?sec=` reaches it.

   Its own module for the reason the Organisation card's is (components/org/
   tabs.ts): the page turns its searchParams into a starting tab on the
   server, and a "use client" screen can't be imported there just to read one
   array off it. The old template addresses redirect here by these keys. */
export const PAPERWORK_TABS = [
  { key: "overview", label: "Overview" },
  { key: "swms", label: "SWMS template" },
  { key: "wording", label: "Certificate wording" },
  { key: "fans", label: "Fan list" },
] as const;

export type PaperworkTabKey = (typeof PAPERWORK_TABS)[number]["key"];

const KEYS = new Set<string>(PAPERWORK_TABS.map((t) => t.key));

/** A `?sec=` value, or null when it names nothing on this screen. */
export function paperworkTabFromParam(v: unknown): PaperworkTabKey | null {
  return typeof v === "string" && KEYS.has(v) ? (v as PaperworkTabKey) : null;
}
