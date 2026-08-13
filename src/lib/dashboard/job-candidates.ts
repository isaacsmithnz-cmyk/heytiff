import { supabaseAdmin } from "@/lib/supabase-server";
import type { JobCandidate } from "@/lib/workboard/note-match";

/* THE JOBS A NOTE CAN BE PINNED TO, for a screen that is not the board.

   Every capture surface can already pick a job — `JobLine` + `JobPicker` in
   components/notes have done it since #301 — but the candidates arrive from
   the SCREEN, through `useNoteScopeScreen({ jobs })`, and only the two
   Workboard screens ever pushed any. They build theirs by filtering a board
   payload they have already loaded for other reasons.

   Home has no such payload, so `scope.jobs` was empty there and the picker
   could not be offered at all: name a job in a debrief that the matcher
   cannot resolve — "Northgate Realty" — and the review said "No job named"
   with nothing you could do about it (Isaac, 2026-08-13).

   THIS IS THE LIGHT VERSION. `loadMaintenanceBoard` reads eighteen columns
   per visit plus categories, completions and mirror health; a picker needs
   five fields and only the OPEN work. Three narrow selects, no joins, and it
   rides the loader's existing Promise.all rather than adding a wait.

   OPEN WORK ONLY, and in the order the board offers it — visits first,
   because a visit carries a job number and a job number makes "is this the
   right one?" a glance instead of a guess; then agreements for work with no
   visit raised yet; then projects. Same reasoning as `attachOptions` in
   overview-screen, which is the shape this has to agree with. */

/** Statuses that mean "still to happen" — the board's own definition. */
const OPEN_VISIT = ["upcoming", "booked"];

/* `job_no` is OURS and is a NUMBER column (#1001 up); `job_number` is
   ServiceM8's and is text. Typing them the same is how a number reaches a
   string field and renders "1042" or crashes a `.includes`. */
type VisitRow = { id: string; agreement_id: string; job_number: string | null; job_no: number | null };
type AgreementRow = { id: string; label: string; client_name: string; site_label: string | null };
type ProjectRow = { id: string; name: string; client_name: string | null; site_label: string | null };

export async function jobCandidates(orgId: string): Promise<JobCandidate[]> {
  const [{ data: agreementRows }, { data: projectRows }] = await Promise.all([
    supabaseAdmin
      .from("maintenance_agreements")
      .select("id, label, client_name, site_label")
      .eq("org_id", orgId)
      .eq("status", "active"),
    supabaseAdmin
      .from("projects")
      .select("id, name, client_name, site_label")
      .eq("org_id", orgId)
      /* `PROJECT_STATUSES` is active|blocked|on_hold|done|archived. Only
         archived is genuinely off the books — a blocked or on-hold project is
         exactly the sort of thing a debrief is about. Same call
         `listProjects` makes. */
      .neq("status", "archived"),
  ]);

  const agreements = (agreementRows ?? []) as unknown as AgreementRow[];
  const projects = (projectRows ?? []) as unknown as ProjectRow[];

  /* Visits hang off agreements, so there is nothing to ask for when there are
     none — and asking with an empty `in()` list is a query that reads the
     whole table on some drivers. */
  const byAgreement = new Map(agreements.map((a) => [a.id, a]));
  let visits: VisitRow[] = [];
  if (agreements.length > 0) {
    const { data } = await supabaseAdmin
      .from("maintenance_visits")
      .select("id, agreement_id, job_number, job_no")
      .eq("org_id", orgId)
      .in("agreement_id", [...byAgreement.keys()])
      .in("status", OPEN_VISIT);
    visits = (data ?? []) as unknown as VisitRow[];
  }

  return [
    ...visits.flatMap((v) => {
      const a = byAgreement.get(v.agreement_id);
      if (!a) return [];
      return [
        {
          kind: "visit" as const,
          id: v.id,
          clientName: a.client_name,
          label: a.label,
          siteLabel: a.site_label,
          /* `job_number` is ServiceM8's; `job_no` is ours (#1001 up). Either
             one answers "which job", and the picker only ever reads it as
             text — see `searchJobs`. */
          jobNumber: v.job_number ?? (v.job_no === null ? null : String(v.job_no)),
        },
      ];
    }),
    ...agreements.map((a) => ({
      kind: "agreement" as const,
      id: a.id,
      clientName: a.client_name,
      label: a.label,
      siteLabel: a.site_label,
      jobNumber: null,
    })),
    ...projects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      clientName: p.client_name ?? p.name,
      label: p.name,
      siteLabel: p.site_label,
      jobNumber: null,
    })),
  ];
}
