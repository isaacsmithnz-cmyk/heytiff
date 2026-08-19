/* The Organisation card's tabs — the list, and how a `?sec=` reaches it.

   Its own module because both ends need it: the screen renders the strip, and
   the page turns its searchParams into a starting tab on the server, so a
   shared link opens the section it names without a client round trip. A
   `"use client"` screen cannot be imported into a server component just to
   read one array off it.

   ORDER IS THE SCREEN'S ARGUMENT. Overview reads and every tab after it edits,
   running from what a customer sees (the logo, then the names it prints beside)
   through how to reach the business, what lets it trade, and finally whose
   account this is — the only tab that isn't about the company as a customer
   meets it. */
export const ORG_TABS = [
  { key: "overview", label: "Overview" },
  { key: "brand", label: "Your business" },
  { key: "identity", label: "Company identity" },
  { key: "contact", label: "Contact & address" },
  { key: "credentials", label: "Licences & insurance" },
  { key: "account", label: "Account" },
] as const;

export type OrgTabKey = (typeof ORG_TABS)[number]["key"];

const KEYS = new Set<string>(ORG_TABS.map((t) => t.key));

/** A `?sec=` value, or null when it names nothing on this screen. */
export function orgTabFromParam(v: unknown): OrgTabKey | null {
  return typeof v === "string" && KEYS.has(v) ? (v as OrgTabKey) : null;
}
