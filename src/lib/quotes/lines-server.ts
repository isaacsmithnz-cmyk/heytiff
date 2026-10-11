import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import {
  applyPatch,
  diffOf,
  engineOf,
  lineFromRow,
  lineRow,
  normaliseLine,
  sortLines,
  type Engine,
  type LineFields,
  type QuoteLine,
} from "./lines";

/* A QUOTE'S LINES, READ AND CHANGED ONE AT A TIME (lines.ts says why).

   Every write is this org's and this job's; every change is kept with who
   made it (quote_line_changes). A change or a removal names the version it
   was read at, and is refused when the line has moved on since, so the
   page reloads it rather than overwriting someone else's edit. Service
   role; the callers gate on workboard_manage and financials, because every
   line carries a cost. */

const COLS =
  "id, option_index, system, grp, position, name, code, supplier_key, kind, qty, unit, cost_cents, sell_cents, source, why, duct, visit, version, updated_at, updated_by";

export type LineResult = { ok: true; line: QuoteLine | null } | { ok: false; reason: string; stale?: true };

export async function readLines(orgId: string, jobUuid: string): Promise<QuoteLine[]> {
  const { data, error } = await supabaseAdmin
    .from("quote_lines")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("option_index")
    .order("position")
    .order("created_at");
  if (error) throw new Error(`quote lines: ${error.message}`);
  return sortLines((data ?? []).map(lineFromRow).filter((l): l is QuoteLine => !!l));
}

async function record(
  orgId: string,
  jobUuid: string,
  lineId: string,
  action: "add" | "change" | "remove",
  before: Partial<LineFields> | null,
  after: Partial<LineFields> | null,
  by: string,
  why: string
) {
  const { error } = await supabaseAdmin.from("quote_line_changes").insert({
    org_id: orgId,
    sm8_job_uuid: jobUuid,
    line_id: lineId,
    action,
    before,
    after,
    why: why.slice(0, 400),
    made_by: by,
  });
  if (error) throw new Error(`quote line change: ${error.message}`);
}

/** A new line, at the end of its option unless it names a place. */
export async function addLine(orgId: string, jobUuid: string, input: unknown, by: string, why = ""): Promise<LineResult> {
  const f = normaliseLine(input);
  if (!f) return { ok: false, reason: "A line needs a name and a group." };
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (raw.position == null) {
    const { data } = await supabaseAdmin
      .from("quote_lines")
      .select("position")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", jobUuid)
      .eq("option_index", f.optionIndex)
      .order("position", { ascending: false })
      .limit(1);
    f.position = ((data?.[0]?.position as number | undefined) ?? -1) + 1;
  }
  const { data, error } = await supabaseAdmin
    .from("quote_lines")
    .insert({ org_id: orgId, sm8_job_uuid: jobUuid, ...lineRow(f), updated_by: by })
    .select(COLS)
    .single();
  if (error || !data) return { ok: false, reason: "The line couldn't be added. Try again." };
  const line = lineFromRow(data)!;
  await record(orgId, jobUuid, line.id, "add", null, f, by, why);
  return { ok: true, line };
}

async function readOne(orgId: string, jobUuid: string, id: string): Promise<QuoteLine | null> {
  const { data } = await supabaseAdmin.from("quote_lines").select(COLS).eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).eq("id", id).maybeSingle();
  return data ? lineFromRow(data) : null;
}

/** One line changed, against the version it was read at. */
export async function changeLine(
  orgId: string,
  jobUuid: string,
  id: string,
  version: number,
  patch: unknown,
  by: string,
  why = ""
): Promise<LineResult> {
  const line = await readOne(orgId, jobUuid, id);
  if (!line) return { ok: false, reason: "That line has gone. Reload the quote." , stale: true };
  if (line.version !== version) return { ok: false, reason: "Someone changed that line just now. It's been reloaded.", stale: true };
  const applied = applyPatch(line, patch);
  if (!applied) return { ok: false, reason: "A line needs a name and a group." };
  if (applied.changed.length === 0) return { ok: true, line };
  const { data, error } = await supabaseAdmin
    .from("quote_lines")
    .update({ ...lineRow(applied.next), version: version + 1, updated_by: by, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .eq("id", id)
    .eq("version", version)
    .select(COLS);
  if (error) return { ok: false, reason: "The line couldn't be changed. Try again." };
  if (!data || data.length === 0) return { ok: false, reason: "Someone changed that line just now. It's been reloaded.", stale: true };
  const d = diffOf(line, applied.next);
  await record(orgId, jobUuid, id, "change", d.before, d.after, by, why);
  return { ok: true, line: lineFromRow(data[0])! };
}

/** One line taken off, against the version it was read at; kept in its
    history so it can be put back. */
export async function removeLine(orgId: string, jobUuid: string, id: string, version: number, by: string, why = ""): Promise<LineResult> {
  const line = await readOne(orgId, jobUuid, id);
  if (!line) return { ok: true, line: null };
  if (line.version !== version) return { ok: false, reason: "Someone changed that line just now. It's been reloaded.", stale: true };
  const { data, error } = await supabaseAdmin
    .from("quote_lines")
    .delete()
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .eq("id", id)
    .eq("version", version)
    .select("id");
  if (error) return { ok: false, reason: "The line couldn't be taken off. Try again." };
  if (!data || data.length === 0) return { ok: false, reason: "Someone changed that line just now. It's been reloaded.", stale: true };
  const { id: _id, version: _v, updatedAt: _a, updatedBy: _b, ...fields } = line;
  await record(orgId, jobUuid, id, "remove", fields, null, by, why);
  return { ok: true, line: null };
}

export type LineChange = {
  id: number;
  lineId: string;
  action: "add" | "change" | "remove";
  before: Partial<LineFields> | null;
  after: Partial<LineFields> | null;
  why: string;
  madeBy: string;
  madeAt: string;
};

/** The quote's changes, newest first. */
export async function readChanges(orgId: string, jobUuid: string, limit = 200): Promise<LineChange[]> {
  const { data, error } = await supabaseAdmin
    .from("quote_line_changes")
    .select("id, line_id, action, before, after, why, made_by, made_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("made_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`quote line changes: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    lineId: r.line_id as string,
    action: r.action as LineChange["action"],
    before: (r.before as Partial<LineFields> | null) ?? null,
    after: (r.after as Partial<LineFields> | null) ?? null,
    why: (r.why as string) ?? "",
    madeBy: r.made_by as string,
    madeAt: r.made_at as string,
  }));
}

/** A change undone: an add taken off, a change put back, a removal restored
    (as a new line with the same fields). Itself a change, kept as one. */
export async function undoChange(orgId: string, jobUuid: string, changeId: number, by: string): Promise<LineResult> {
  const { data } = await supabaseAdmin
    .from("quote_line_changes")
    .select("id, line_id, action, before, after")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .eq("id", changeId)
    .maybeSingle();
  if (!data) return { ok: false, reason: "That change isn't on this quote." };
  const why = `Undo`;
  if (data.action === "add") {
    const line = await readOne(orgId, jobUuid, data.line_id as string);
    return line ? removeLine(orgId, jobUuid, line.id, line.version, by, why) : { ok: true, line: null };
  }
  if (data.action === "remove") return addLine(orgId, jobUuid, data.before, by, why);
  const line = await readOne(orgId, jobUuid, data.line_id as string);
  if (!line) return { ok: false, reason: "That line has gone since, so the change can't be undone." };
  return changeLine(orgId, jobUuid, line.id, line.version, data.before ?? {}, by, why);
}

/** Which engine prices this quote; a quote with no draft is on the old one. */
export async function readEngine(orgId: string, jobUuid: string): Promise<Engine> {
  const { data } = await supabaseAdmin.from("quote_drafts").select("engine").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  return engineOf(data?.engine);
}

/** Switches a quote between engines. A quote with no draft gets a row that
    holds only the switch: an empty draft, which every proposal reader takes
    as no proposal (normaliseDraft refuses a draft with no option). */
export async function setEngine(orgId: string, jobUuid: string, engine: Engine, by: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("quote_drafts")
    .update({ engine })
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .select("engine");
  if (data && data.length > 0) return true;
  if (engine === "old") return true;
  const { error } = await supabaseAdmin
    .from("quote_drafts")
    .insert({ org_id: orgId, sm8_job_uuid: jobUuid, draft: {}, brief: "", changes: [], updated_by: by, engine });
  return !error;
}

/** Who each person is, by their sign-in id, for a quote's history: their
    staff card's name. Somebody with no card is unnamed, never dropped. */
export async function namesBySignIn(orgId: string, ids: readonly string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((i) => i && i !== "tiff"))];
  const out: Record<string, string> = {};
  if (wanted.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId)
    .in("user_id", wanted);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const name = displayNameOf(r as Parameters<typeof displayNameOf>[0], "");
    if (name && typeof r.user_id === "string") out[r.user_id] = name;
  }
  return out;
}

/** An option started as a copy of another: every line of `from` added to
    `to`, each kept in the history as its own add, so the new option is a
    whole job from the start and changes from there (slice 10.1). */
export async function copyOption(orgId: string, jobUuid: string, from: number, to: number, by: string): Promise<LineResult> {
  if (from === to) return { ok: false, reason: "An option can't be copied onto itself." };
  const lines = (await readLines(orgId, jobUuid)).filter((l) => l.optionIndex === from);
  if (lines.length === 0) return { ok: false, reason: "That option has no lines to copy." };
  for (const l of lines) {
    const { id: _id, version: _v, updatedAt: _a, updatedBy: _b, ...fields } = l;
    const r = await addLine(orgId, jobUuid, { ...fields, optionIndex: to }, by, `Copied from option ${from + 1}`);
    if (!r.ok) return r;
  }
  return { ok: true, line: null };
}

/** The swaps people made on the business's quotes, newest first, for its
    habits (habits.ts): a change whose after names a code. */
export async function readSwaps(orgId: string, limit = 2000) {
  const { data, error } = await supabaseAdmin
    .from("quote_line_changes")
    .select("sm8_job_uuid, made_by, before, after")
    .eq("org_id", orgId)
    .eq("action", "change")
    .not("after->>code", "is", null)
    .order("made_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({
    job: r.sm8_job_uuid as string,
    madeBy: r.made_by as string,
    before: (r.before as Record<string, string | null> | null) ?? null,
    after: (r.after as Record<string, string | null> | null) ?? null,
  }));
}
