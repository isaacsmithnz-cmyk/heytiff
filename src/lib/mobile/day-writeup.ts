import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { SONNET_FALLBACK } from "@/lib/tiff/sonnet-fallback";
import { wallMinute } from "./clock";
import { readDay, type DaySummary } from "./day";
import type { MobileCtx } from "./auth";

/* TIFF WRITES YOUR DAY UP (Isaac, 29 October 2026: "Build the rest", the
   overnight mock: "at Clock off, one tidy diary entry per job you were on:
   when you were there, what was done, what you photographed and asked, for
   the office to read").

   Written from what the person left on each job that day: the notes they
   put on it, the photos they took there, and what they asked Tiff while
   they were there, with their time on it from the Clock off sheet. It adds
   nothing they didn't say. A job with nothing said on it is just its time.
   The phone shows each entry under where the day went, to change or untick;
   kept, it goes on the job's diary by the job sheet's own pen, and to
   ServiceM8 only when ticked, as the job's notes go now. Drafting is all
   this does: nothing is written here. */

const MODEL = "claude-sonnet-5-5";
const NOTE_CAP = 1200;
const ASK_CAP = 300;
const ANSWER_CAP = 700;

export type Asked = { question: string; answer: string };
export type JobDay = {
  jobUuid: string;
  number: string | null;
  where: string;
  /** each stretch there, as the Clock off sheet shows it */
  spans: { from: string; until: string }[];
  notes: string[];
  photos: number;
  asked: Asked[];
};
/** `line` is the first line at the finish asked about; `name`, `photos` and
    `asked` are its parts, for the phone to say again at another finish. */
export type WriteupEntry = { jobUuid: string; number: string | null; where: string; line: string; name: string | null; photos: number; asked: number; text: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "7:15" from an instant on the account's clock: the sheet's own quarter hours, no am or pm. */
function clockWords(iso: string, zone: string): string {
  const w = wallMinute(iso, zone);
  if (!w) return "";
  const h = Number(w.slice(11, 13));
  return `${h % 12 || 12}:${w.slice(14, 16)}`;
}

/** The entry's first line: who, when, and what they photographed and asked.
    "Isaac, 7:15 to 3:00 · 4 photos · 1 question to the Library". Pure. */
export function lineOf(name: string | null, job: Pick<JobDay, "spans" | "photos" | "asked">, zone: string): string {
  const when = job.spans.map((s) => `${clockWords(s.from, zone)} to ${clockWords(s.until, zone)}`).join(", ");
  const bits = [
    [name, when].filter(Boolean).join(", "),
    job.photos ? `${job.photos} photo${job.photos === 1 ? "" : "s"}` : null,
    job.asked.length ? `${job.asked.length} question${job.asked.length === 1 ? "" : "s"} to the Library` : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

/** Each job on the day's sheet, its stretches together, in the order first reached. Pure. */
export function jobsOfDay(summary: DaySummary): Pick<JobDay, "jobUuid" | "number" | "where" | "spans">[] {
  const out = new Map<string, Pick<JobDay, "jobUuid" | "number" | "where" | "spans">>();
  for (const j of summary.jobs) {
    const k = j.jobUuid.toLowerCase();
    const had = out.get(k);
    if (had) had.spans.push({ from: j.from, until: j.until });
    else out.set(k, { jobUuid: j.jobUuid, number: j.number, where: j.where, spans: [{ from: j.from, until: j.until }] });
  }
  return [...out.values()];
}

type Msg = { at?: unknown; role?: unknown; text?: unknown };

/** What was asked of Tiff while the person was at the job, with her answer. Pure. */
export function askedThere(threads: readonly { messages: unknown }[], spans: readonly { from: string; until: string }[]): Asked[] {
  const within = (at: number) => spans.some((s) => at >= Date.parse(s.from) && at <= Date.parse(s.until));
  const out: Asked[] = [];
  for (const t of threads) {
    const msgs = Array.isArray(t.messages) ? (t.messages as Msg[]) : [];
    msgs.forEach((m, i) => {
      if (m.role !== "user" || typeof m.text !== "string" || typeof m.at !== "number" || !within(m.at)) return;
      const reply = msgs.slice(i + 1).find((r) => r.role === "tiff" && typeof r.text === "string");
      out.push({ question: clip(m.text.trim(), ASK_CAP), answer: clip(String(reply?.text ?? "").trim(), ANSWER_CAP) });
    });
  }
  return out;
}

/** Everything the person left on each job that day, read from where it is kept. */
async function gather(ctx: MobileCtx, summary: DaySummary, dayFrom: string): Promise<JobDay[]> {
  const jobs = jobsOfDay(summary);
  if (!jobs.length) return [];
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  const uuids = jobs.map((j) => j.jobUuid);
  /* the mirror keeps ServiceM8's uuids as text: either case finds them */
  const either = [...new Set(uuids.flatMap((u) => [u, u.toLowerCase()]))];
  const [notes, photos, threads] = await Promise.all([
    staffId
      ? supabaseAdmin
          .from("workboard_notes")
          .select("target_id, transcript, created_at")
          .eq("org_id", ctx.orgId)
          .eq("author_id", staffId)
          .eq("target_kind", "job")
          .in("target_id", uuids)
          .gte("created_at", dayFrom)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    staffId
      ? supabaseAdmin
          .from("documents")
          .select("sm8_job_uuid")
          .eq("org_id", ctx.orgId)
          .eq("uploaded_by", staffId)
          .eq("kind", "job_photo")
          .in("sm8_job_uuid", either)
          .gte("created_at", dayFrom)
      : Promise.resolve({ data: [] }),
    supabaseAdmin
      .from("tiff_threads")
      .select("id, messages")
      .eq("org_id", ctx.orgId)
      .eq("user_sub", ctx.userId)
      .gte("updated_at", dayFrom)
      .not("id", "like", "email-%"),
  ]);
  const noteRows = (notes.data ?? []) as { target_id: string; transcript: string | null }[];
  const photoRows = (photos.data ?? []) as { sm8_job_uuid: string | null }[];
  const threadRows = (threads.data ?? []) as { messages: unknown }[];
  return jobs.map((j) => {
    const k = j.jobUuid.toLowerCase();
    return {
      ...j,
      notes: noteRows.filter((n) => n.target_id.toLowerCase() === k && n.transcript?.trim()).map((n) => clip(n.transcript!.trim(), NOTE_CAP)),
      photos: photoRows.filter((p) => p.sm8_job_uuid?.toLowerCase() === k).length,
      asked: askedThere(threadRows, j.spans),
    };
  });
}

const SYSTEM = [
  "You write a tradesperson's end-of-day diary entry for each job they were on,",
  "for the office to read. Each job comes with what the person left on it that",
  "day: the notes they put on the job, and the questions they asked (with the",
  "answer they were given) while they were there.",
  "",
  "For each job write one paragraph in plain site language: what was done,",
  "what was found, what's left to do, as short as the notes allow. Write it",
  "as the job's own record, not about the person: 'Lounge head up and wired;",
  "bedroom head to finish tomorrow.'",
  "",
  "Rules:",
  "- only what the notes and questions say. Never add a step, a part, a cause,",
  "  a reading or a plan that isn't in them. If the notes are thin, the entry",
  "  is short",
  "- an answer to a question goes in only as the fact that was found, in a",
  "  clause, when it bears on the work ('the outdoor unit's feet are 600 mm",
  "  apart'). A question with no useful answer is left out",
  "- copy every figure, model code, measurement and name exactly as given;",
  "  never add two figures together or convert units",
  "- no time, no photo count, no greeting, no sign-off, no mention of Tiff,",
  "  the Library or the app: the entry's first line already says those",
  "- a job with nothing worth saying gets an empty string. That is a correct",
  "  answer",
  "",
  "Return one entry per job, in the order the jobs were given, with exactly",
  "as many entries as there were jobs.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: { entries: { type: "array", items: { type: "string" } } },
  required: ["entries"],
  additionalProperties: false,
} as const;

/** The material, as the model reads it: each job, its notes and its questions. Pure. */
export function promptOf(jobs: readonly JobDay[]): string {
  return jobs
    .map((j, i) => {
      const head = `Job ${i + 1}: ${[j.number, j.where].filter(Boolean).join(", ") || "a job"}`;
      const notes = j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(no notes)";
      const asked = j.asked.length ? j.asked.map((a) => `- Asked: ${a.question}\n  Answer: ${a.answer || "(none)"}`).join("\n") : "(no questions)";
      return `${head}\nNotes:\n${notes}\nQuestions:\n${asked}`;
    })
    .join("\n\n");
}

/** One paragraph per job that has something said on it; the rest stay empty. Never throws. Exported for a live check of the wording. */
export async function written(jobs: readonly JobDay[]): Promise<string[]> {
  const said = jobs.map((j, i) => ({ j, i })).filter(({ j }) => j.notes.length || j.asked.length);
  const out = jobs.map(() => "");
  if (!said.length || !process.env.ANTHROPIC_API_KEY) return out;
  try {
    const response = await new Anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      ...SONNET_FALLBACK,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: promptOf(said.map(({ j }) => j)) }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return out;
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return out;
    const entries = (JSON.parse(block.text) as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return out;
    said.forEach(({ i }, at) => {
      const t = entries[at];
      out[i] = typeof t === "string" ? t.trim() : "";
    });
    return out;
  } catch (err) {
    console.error(`[mobile] couldn't write the day up: ${err instanceof Error ? err.message : String(err)}`);
    return out;
  }
}

/** The day's entries, one per job on the Clock off sheet, to the finish the
    person is thinking of (`until`), ready to change and keep. */
export async function writeUpDay(ctx: MobileCtx, until?: string | null, now: number = Date.now()): Promise<{ entries: WriteupEntry[] }> {
  const state = await readDay(ctx, now, until);
  if (!state.day || !state.summary) return { entries: [] };
  const [zone, name] = await Promise.all([bookingZone(ctx.orgId).then((z) => z.zone ?? "Australia/Sydney"), firstNameOf(ctx)]);
  const jobs = await gather(ctx, state.summary, state.day.onAt);
  const texts = await written(jobs);
  return {
    entries: jobs.map((j, i) => ({ jobUuid: j.jobUuid, number: j.number, where: j.where, line: lineOf(name, j, zone), name, photos: j.photos, asked: j.asked.length, text: texts[i] ?? "" })),
  };
}

async function firstNameOf(ctx: MobileCtx): Promise<string | null> {
  const { data } = await supabaseAdmin.from("staff_profiles").select("first_name, full_name").eq("org_id", ctx.orgId).eq("user_id", ctx.userId).maybeSingle();
  const row = data as { first_name: string | null; full_name: string | null } | null;
  return row?.first_name?.trim() || row?.full_name?.trim().split(/\s+/)[0] || null;
}
