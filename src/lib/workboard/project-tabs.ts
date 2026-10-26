/* A PROJECT'S SIX SECTIONS (rule 31; the old screens' mock, 27 October
   2026): its page has tabs like a job's. Here, not in the screen, so the
   route (a server component) can read `?tab=` with the same words the
   screen draws. */

export type ProjectTab = "overview" | "trips" | "scope" | "money" | "site" | "documents";

export const PROJECT_TABS: readonly { key: ProjectTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "trips", label: "Trips" },
  { key: "scope", label: "Scope" },
  { key: "money", label: "Money" },
  { key: "site", label: "Site" },
  { key: "documents", label: "Documents" },
];

/** `?tab=` as the page reads it: one of the six, Money only for whoever sees money, else Overview. */
export function parseProjectTab(raw: unknown, moneyVisible: boolean): ProjectTab {
  const t = PROJECT_TABS.find((x) => x.key === raw)?.key ?? "overview";
  return t === "money" && !moneyVisible ? "overview" : t;
}
