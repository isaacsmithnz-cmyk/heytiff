/* The Templates screen's tabs — one per document the business issues, and
   how a `?sec=` reaches it.

   Its own module for the reason the Organisation card's is (components/org/
   tabs.ts): the page turns its searchParams into a starting tab on the
   server, and a "use client" screen can't be imported there just to read one
   array off it. The old template addresses redirect here by these keys. */
export const TEMPLATE_TABS = [
  { key: "swms", label: "SWMS" },
  { key: "certificate", label: "Mechanical Compliance Certificate" },
] as const;

export type TemplateTabKey = (typeof TEMPLATE_TABS)[number]["key"];

const KEYS = new Set<string>(TEMPLATE_TABS.map((t) => t.key));

/** A `?sec=` value, or null when it names nothing on this screen. */
export function templateTabFromParam(v: unknown): TemplateTabKey | null {
  return typeof v === "string" && KEYS.has(v) ? (v as TemplateTabKey) : null;
}
