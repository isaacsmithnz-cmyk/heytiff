"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import {
  searchClients,
  searchProjects,
  searchStaff,
  type PaletteClient,
  type PaletteProject,
  type PaletteStaff,
} from "@/lib/workboard/palette-query";

/* ⌘K's one question to the server: the staff, the client book, the projects
   and every job in the mirror, in ONE round trip — the router runs actions
   one at a time, so four would queue behind each other at every pause in the
   typing.

   EACH GROUP ANSWERS UNDER ITS OWN GRANT. The staff are the Team screen's —
   `team`, which the staff card's own route checks — and the rest is the
   Workboard's, `workboard`. Somebody holding one is never sent the other,
   and somebody holding neither is asked nothing at all. Money is never read:
   nothing in the palette shows it, and a job opened from it is read again by
   the page under the page's own money rule. */

export type PaletteFinds = {
  staff: PaletteStaff[];
  clients: PaletteClient[];
  projects: PaletteProject[];
  jobs: AllJobsMirrorJob[];
};

const NO_FINDS: PaletteFinds = { staff: [], clients: [], projects: [], jobs: [] };

export async function searchPalette(term: string): Promise<PaletteFinds> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId || !session?.user?.sub) return NO_FINDS;
  const q = typeof term === "string" ? term.trim().slice(0, 120) : "";
  if (q.length < 2) return NO_FINDS;

  const [team, work] = await Promise.all([can("team"), can("workboard")]);
  if (!team && !work) return NO_FINDS;
  const today = work ? todayInZone(await getSm8Timezone(orgId)) : "";

  const [staff, clients, projects, jobs] = await Promise.all([
    team ? searchStaff(orgId, q) : [],
    work ? searchClients(orgId, q) : [],
    work ? searchProjects(orgId, q) : [],
    work ? searchAllMirrorJobs(orgId, q, today, { includeMoney: false }) : [],
  ]);
  return { staff, clients, projects, jobs };
}
