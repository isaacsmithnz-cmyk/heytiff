import type { Query } from "./load";

/* ServiceM8's and Xero's own addresses are where their OAuth callbacks
   send you back to, and where a link from a job, Home or Reports points.
   Both apps are one page since 25 October 2026, so each old address sends
   you on to it, carrying how the round trip ended (`connected`, `switched`,
   `error`, codes the page turns into sentences from a fixed table) and
   `from`, the app it came back from. Nothing else in the query goes on. */
const CARRIED = ["connected", "switched", "error"] as const;

export function integrationsAddress(from: "servicem8" | "xero", params: Query): string {
  const q = new URLSearchParams();
  for (const key of CARRIED) {
    const v = params[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) q.set(key, value);
  }
  const outcome = q.toString();
  const search = outcome ? `?from=${from}&${outcome}` : "";
  // Xero's group is under ServiceM8's, so its address lands on it
  return `/dashboard/admin/integrations${search}${from === "xero" ? "#xero" : ""}`;
}
