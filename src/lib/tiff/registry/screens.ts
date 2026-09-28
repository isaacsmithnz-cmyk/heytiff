/* MOVING THE SCREEN — Phase 1's three tools (docs/universal-tiff-phase-1-
   spec.md, PR 1B). Server only.

   `open_screen` opens one of the app's screens, `find_record` looks a record
   up the way ⌘K does, and `open_record` opens one. None of them writes. A
   move hands back an address from a fixed set (the nav, and the record links
   ⌘K uses), never one built from words the model read, and the label she
   says comes from the record, not the request.

   ONE LIST OF SCREENS FOR EVERYONE. The enum is every nav label, so the tool
   block is the same for every viewer and the prompt cache holds across them;
   a screen this viewer can't see is refused in words by `run`, which checks
   `navFor(viewer)`, the same list their sidebar is drawn from. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { ALL_SCREENS, navFor } from "@/components/shell/nav";
import * as links from "@/lib/shell/links";
import { fullNameOf } from "@/lib/staff/name";
import { searchClients, searchProjects, searchStaff } from "@/lib/workboard/palette-query";
import { searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";
import { recordLine, screenLine } from "./lines";
import { passes } from "./gates";
import type { Capability } from "@/lib/permissions";
import type { Outcome, TiffTool, Viewer } from "./types";

const str = { type: "string" } as const;
const result = (value: unknown): Outcome => ({ kind: "result", value });

/* ── open_screen ──────────────────────────────────────────────────────── */

const LABELS = ALL_SCREENS.map((n) => n.label);

const openScreen: TiffTool = {
  name: "open_screen",
  label: "Opening the screen",
  risk: "screen",
  gate: { open: true },
  description:
    "Open one of the app's screens for the person, when they ask to go somewhere. The screens " +
    `are: ${ALL_SCREENS.map((n) => `${n.label} (${n.hint})`).join("; ")}. People also say ` +
    '"dashboard" for Home, "my hours" for Timesheet, "time and pay" for Time & Pay and "the studio" ' +
    "for Design. For a person, job, project or client, use find_record and open_record instead. " +
    "Opening a screen ends your turn: say nothing after it.",
  inputSchema: {
    type: "object",
    properties: { screen: { type: "string", enum: LABELS } },
    required: ["screen"],
    additionalProperties: false,
  },
  run: async (viewer, input) => {
    const label = String(input.screen ?? "");
    const mine = navFor({ caps: viewer.caps, role: viewer.role }).find((n) => n.label === label);
    if (!mine) return result({ refused: `They can't open ${label}: tell them so, plainly.` });
    return { kind: "screen", href: mine.href, label: mine.label, line: screenLine(mine.label) };
  },
};

/* ── the records ──────────────────────────────────────────────────────── */

type RecordKind = "staff" | "client" | "project" | "job";
const KINDS: readonly RecordKind[] = ["staff", "client", "project", "job"];

/** Who may reach each kind: the capability of the screen it opens on (a
    staff card is Team's; the rest are the Workboard's). */
const KIND_GATE: Record<RecordKind, Capability> = {
  staff: "team",
  client: "workboard",
  project: "workboard",
  job: "workboard",
};

export type FoundRecord =
  | { kind: RecordKind; id: string; label: string; detail: string }
  | { kind: RecordKind; reason: "not allowed" | "couldn't check" };

const findRecord: TiffTool = {
  name: "find_record",
  label: "Looking it up",
  risk: "read",
  gate: { anyOf: ["team", "workboard"] },
  description:
    "Find a person, client, project or ServiceM8 job by name, number or address, the way the " +
    "search box does. Returns up to five of each kind with the id open_record takes. If more " +
    "than one could be what they meant, ask which, naming the choices; never guess.",
  inputSchema: {
    type: "object",
    properties: {
      query: str,
      kinds: { type: "array", items: { type: "string", enum: KINDS } },
    },
    required: ["query"],
    additionalProperties: false,
  },
  run: async (viewer, input) => {
    const query = String(input.query ?? "").trim();
    const asked = Array.isArray(input.kinds) && input.kinds.length ? (input.kinds as RecordKind[]) : KINDS;
    const out: FoundRecord[] = [];
    await Promise.all(
      asked.filter((k) => KINDS.includes(k)).map(async (kind) => {
        if (!viewer.caps.has(KIND_GATE[kind])) {
          out.push({ kind, reason: "not allowed" });
          return;
        }
        try {
          out.push(...(await search(viewer, kind, query)));
        } catch {
          out.push({ kind, reason: "couldn't check" });
        }
      })
    );
    return result(out);
  },
};

async function search(viewer: Viewer, kind: RecordKind, query: string): Promise<FoundRecord[]> {
  if (kind === "staff") {
    return (await searchStaff(viewer.orgId, query)).map((p) => ({
      kind,
      id: p.id,
      label: p.name,
      detail: [p.title, p.active ? null : "no longer active"].filter(Boolean).join(", "),
    }));
  }
  if (kind === "client") {
    return (await searchClients(viewer.orgId, query)).map((c) => ({
      kind,
      id: c.uuid,
      label: c.name,
      detail: c.address ?? "",
    }));
  }
  if (kind === "project") {
    return (await searchProjects(viewer.orgId, query)).map((p) => ({
      kind,
      id: p.id,
      label: p.name,
      detail: [p.clientName, p.siteLabel, p.stage].filter(Boolean).join(", "),
    }));
  }
  return (await searchAllMirrorJobs(viewer.orgId, query, viewer.today, { includeMoney: false, limit: 5 })).map(
    (j) => ({
      kind,
      id: j.remoteId,
      label: jobLabel(j.jobNumber, j.clientName),
      detail: [j.status].filter(Boolean).join(", "),
    })
  );
}

const jobLabel = (number: string | null, client: string | null) =>
  [number ? `#${number}` : "ServiceM8 job", client].filter(Boolean).join(" — ");

const openRecord: TiffTool = {
  name: "open_record",
  label: "Opening it",
  risk: "screen",
  gate: { anyOf: ["team", "workboard"] },
  description:
    "Open a person's staff card, a client, a project or a ServiceM8 job, by the kind and id " +
    "find_record gave you. Opening ends your turn: say nothing after it.",
  inputSchema: {
    type: "object",
    properties: { kind: { type: "string", enum: KINDS }, id: str },
    required: ["kind", "id"],
    additionalProperties: false,
  },
  run: async (viewer, input) => {
    const kind = String(input.kind ?? "") as RecordKind;
    const id = String(input.id ?? "");
    if (!KINDS.includes(kind) || !id) return result({ refused: "That isn't something she can open." });
    if (!passes({ capability: KIND_GATE[kind] }, viewer)) {
      return result({ refused: `They can't open ${kind === "staff" ? "staff cards" : "the Workboard"}: tell them so, plainly.` });
    }
    const found = await lookUp(viewer.orgId, kind, id);
    if (!found) return result({ refused: `That ${kind === "staff" ? "person" : kind} isn't in this workspace.` });
    return { kind: "screen", href: found.href, label: found.label, line: recordLine(found.label) };
  },
};

/** The record, read in the viewer's org as its page will read it, with its
    link and its own name. Null when this org holds no such record. */
async function lookUp(orgId: string, kind: RecordKind, id: string): Promise<{ href: string; label: string } | null> {
  if (kind === "staff") {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("id, first_name, last_name, full_name, preferred_name")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const name = fullNameOf(data as Record<string, string | null>);
    return { href: links.staffHref(id), label: name ? `${name}'s card` : "their card" };
  }
  if (kind === "project") {
    const { data } = await supabaseAdmin.from("projects").select("id, name").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (!data) return null;
    return { href: links.projectHref(id), label: String((data as { name: string }).name) };
  }
  if (kind === "client") {
    const { data } = await supabaseAdmin
      .from("sm8_companies")
      .select("uuid, name")
      .eq("org_id", orgId)
      .eq("uuid", id)
      .maybeSingle();
    const name = (data as { name: string | null } | null)?.name?.trim();
    if (!name) return null;
    return { href: links.clientHref(name), label: name };
  }
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, company_uuid")
    .eq("org_id", orgId)
    .eq("uuid", id)
    .maybeSingle();
  const job = data as { generated_job_id: string | null; company_uuid: string | null } | null;
  if (!job) return null;
  let client: string | null = null;
  if (job.company_uuid) {
    const { data: co } = await supabaseAdmin
      .from("sm8_companies")
      .select("name")
      .eq("org_id", orgId)
      .eq("uuid", job.company_uuid)
      .maybeSingle();
    client = (co as { name: string | null } | null)?.name?.trim() || null;
  }
  return { href: links.jobHref(id), label: jobLabel(job.generated_job_id, client) };
}

export const SCREEN_TOOLS: readonly TiffTool[] = [openScreen, findRecord, openRecord];

/* ── the free open ────────────────────────────────────────────────────── */

const same = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();

/* OPENING BY NAME WITH NO MODEL (Isaac, 2026-09-28: "these are all basic
   tasks. That should not cost much to do"). "Open up Isaac Smith" cost two
   model calls, about 4c US, to do what ⌘K does for nothing. This looks the
   name up the way find_record does and opens it only when exactly ONE
   record the viewer may open is called exactly that: a person's full name,
   or a first name only one person has; a client's or a project's whole
   name; a job's number. Anything else, none or two, is null, and the words
   go on as they would have (a note, or Tiff), so a site note that starts
   the same way ("open up the ceiling") is never eaten by a near match. A
   search that fails is null too: not knowing never opens anything. */
export async function openByName(
  viewer: Viewer,
  name: string
): Promise<Extract<Outcome, { kind: "screen" }> | null> {
  const want = same(name);
  if (!want) return null;
  const number = /^job\s+#?(\d+)$/.exec(want)?.[1];
  const kinds: RecordKind[] = number ? ["job"] : ["staff", "client", "project"];
  const hits: { kind: RecordKind; id: string }[] = [];
  try {
    for (const kind of kinds) {
      if (!viewer.caps.has(KIND_GATE[kind])) continue;
      const found = (await search(viewer, kind, number ?? name)).filter(
        (f): f is Extract<FoundRecord, { id: string }> => "id" in f
      );
      if (kind === "job") {
        hits.push(...found.filter((f) => f.label === `#${number}` || f.label.startsWith(`#${number} `)));
      } else if (kind === "staff") {
        const whole = found.filter((f) => same(f.label) === want);
        const first = found.filter((f) => same(f.label).split(" ")[0] === want);
        hits.push(...(whole.length ? whole : first.length === 1 ? first : []));
      } else {
        hits.push(...found.filter((f) => same(f.label) === want));
      }
    }
  } catch {
    return null;
  }
  if (hits.length !== 1) return null;
  const [hit] = hits;
  const found = await lookUp(viewer.orgId, hit.kind, hit.id).catch(() => null);
  if (!found) return null;
  return { kind: "screen", href: found.href, label: found.label, line: recordLine(found.label) };
}
