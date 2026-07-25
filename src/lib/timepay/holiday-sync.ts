import { supabaseAdmin } from "@/lib/supabase-server";
import { addDays } from "./period";
import { certainHolidays } from "./holiday-rules";

/* The lazy top-up that keeps public_holidays current without an admin page.

   Called from the loaders that read the calendar (my-timesheet, my-leave,
   team leave). Almost every call is one cheap guard query: how far ahead do
   this org's auto rows reach? Only when coverage drops under ~18 months does
   the fill run — roughly twice a year per org — writing the statutory
   `certain` rules out to ~24 months ahead.

   Two invariants, both load-bearing:
   - INSERT-ONLY, never update: `ignoreDuplicates` on the (org,state,date)
     key means a row that already exists — manual, synced, or a suppressed
     tombstone — is never touched. That is what makes removeHoliday's
     tombstones permanent and manual entries authoritative.
   - Only `certain` rules are written. Proclamation-dependent days surface in
     the manager UI as suggestions instead; an admin accepting one writes it
     as `manual`. An empty rules table (or an unknown state) adds nothing. */

/** Coverage below this many days ahead triggers a fill. */
export const ENSURE_MIN_AHEAD_DAYS = 548; // ~18 months
/** A fill writes rules out to this many days ahead. */
export const ENSURE_FILL_AHEAD_DAYS = 730; // ~24 months

export async function ensureHolidays(
  orgId: string,
  state: string | null,
  today: string,
): Promise<void> {
  if (!state) return;

  // The guard: newest auto row for this org+state. Manual rows don't count —
  // one hand-entered date two years out shouldn't stop the statutory fill.
  const { data: newest } = await supabaseAdmin
    .from("public_holidays")
    .select("holiday_date")
    .eq("org_id", orgId)
    .eq("state", state)
    .eq("source", "auto")
    .order("holiday_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const covered = newest ? String(newest.holiday_date).slice(0, 10) : null;
  if (covered && covered >= addDays(today, ENSURE_MIN_AHEAD_DAYS)) return;

  const fillTo = addDays(today, ENSURE_FILL_AHEAD_DAYS);
  const fromYear = Number(today.slice(0, 4));
  const toYear = Number(fillTo.slice(0, 4));

  const rows: {
    org_id: string;
    state: string;
    holiday_date: string;
    name: string;
    source: string;
    suppressed: boolean;
  }[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const h of certainHolidays(state, year)) {
      // whole current year in, so a period that started before today still
      // sees its holidays; nothing beyond the fill horizon
      if (h.date > fillTo) continue;
      rows.push({
        org_id: orgId,
        state,
        holiday_date: h.date,
        name: h.name,
        source: "auto",
        suppressed: false,
      });
    }
  }
  if (rows.length === 0) return;

  await supabaseAdmin
    .from("public_holidays")
    .upsert(rows, { onConflict: "org_id,state,holiday_date", ignoreDuplicates: true });
}
