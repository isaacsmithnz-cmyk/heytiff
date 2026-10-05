/* The Organisation card's tabs — the list, and how a `?sec=` reaches it.

   Its own module because both ends need it: the screen renders the strip, and
   the page turns its searchParams into a starting tab on the server, so a
   shared link opens the section it names without a client round trip. A
   `"use client"` screen cannot be imported into a server component just to
   read one array off it.

   FOUR TABS, cut by what a tab is FOR rather than by which form a field used
   to live in. Company is the business itself — the logo and colour its
   documents wear, its trading details and how to reach it — and it is the first
   tab because there is nothing to summarise: it is the summary. Preferences is
   the knobs. Licences & insurance is what lets it trade, and Account is whose
   it is, the only tab that isn't about the company as a customer meets it.

   It was six, opening on an Overview that restated five of them. */
export const ORG_TABS = [
  { key: "company", label: "Company" },
  { key: "preferences", label: "Preferences" },
  { key: "credentials", label: "Licences & insurance" },
  { key: "account", label: "Account" },
] as const;

export type OrgTabKey = (typeof ORG_TABS)[number]["key"];

const KEYS = new Set<string>(ORG_TABS.map((t) => t.key));

/* The four tabs that merged into Company. A link somebody saved or shared
   (`?sec=brand`, `?sec=identity`) still lands somewhere that holds what it
   named, instead of falling through to the default for want of a match. */
const RETIRED = new Set(["overview", "brand", "identity", "contact"]);

/** A `?sec=` value, or null when it names nothing on this screen. */
export function orgTabFromParam(v: unknown): OrgTabKey | null {
  if (typeof v !== "string") return null;
  if (RETIRED.has(v)) return "company";
  return KEYS.has(v) ? (v as OrgTabKey) : null;
}
