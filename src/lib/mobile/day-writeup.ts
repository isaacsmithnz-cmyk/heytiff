import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { wallInstant } from "@/lib/integrations/sm8-booking-plan";
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
  /** for the wrap-up: your notes there today with their times, your photos' ids, and everyone else's notes on it today */
  mine: { at: string; text: string }[];
  photoIds: string[];
  others: { name: string; at: string; text: string }[];
  address: string | null;
  /** your notes there today, whole (never clipped): the wrap-up's own is found among them */
  own: { at: string; text: string }[];
};
/** `line` is the first line at the finish asked about; `name`, `photos` and
    `asked` are its parts, for the phone to say again at another finish. */
export type WriteupEntry = {
  jobUuid: string;
  number: string | null;
  where: string;
  line: string;
  name: string | null;
  photos: number;
  asked: number;
  text: string;
  /** the wrap-up's, one job at a time (Isaac, 2 November 2026: "when you hit clock off, it brings you through the notes for the day") */
  spans: { from: string; until: string }[];
  address: string | null;
  mine: { at: string; text: string }[];
  photoIds: string[];
  others: { name: string; at: string; text: string }[];
  /** the wrap-up note already in for this stretch, when it was filed: the walk passes its note step by, so it's never filed twice */
  filed: string | null;
  /** its words, under the who-and-when line, whole: going back to it shows them to change (Isaac, 11 November 2026:
      "I accidentally tapped something ... and I couldn't go back to it to edit it") */
  filedText: string | null;
};

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
  const bits = [
    headOf(name, job.spans, zone),
    job.photos ? `${job.photos} photo${job.photos === 1 ? "" : "s"}` : null,
    job.asked.length ? `${job.asked.length} question${job.asked.length === 1 ? "" : "s"} to the Library` : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

/** Who and when, the part of the first line a wrap-up note always opens with: "Isaac, 7:15 to 3:00". Pure. */
export function headOf(name: string | null, spans: readonly { from: string; until: string }[], zone: string): string {
  const when = spans.map((s) => `${clockWords(s.from, zone)} to ${clockWords(s.until, zone)}`).join(", ");
  return [name, when].filter(Boolean).join(", ");
}

/** NEVER FILED TWICE (11 November 2026: 3324's note went to ServiceM8 at 3:40 pm
    and again, as Tiff's tidy of it, at 6:30 the next morning; 3488's and 3514's
    on the 8th and again on the 10th). A wrap-up note opens with its who and
    when, so the person's own note on the job that opens with this stretch's is
    the one already in; Tiff's tidy may end it with a full stop. The earliest's
    time, or null. Pure. */
export function filedAt(head: string, mine: readonly { at: string; text: string }[]): string | null {
  return filedNote(head, mine)?.at ?? null;
}

/** That note itself. Pure. */
export function filedNote<N extends { at: string; text: string }>(head: string, mine: readonly N[]): N | null {
  if (!head.includes(" to ")) return null;
  return (
    mine.find((n) => {
      const first = (n.text.split("\n")[0] ?? "").trim().replace(/\.$/, "");
      return first === head || first.startsWith(`${head} · `);
    }) ?? null
  );
}

/** A wrap-up note's who and when, off its first line: "Isaac, 8:45 to 2:45 · 4 photos" is "Isaac, 8:45 to 2:45". Pure. */
export function headOfNote(text: string): string {
  return ((text.split("\n")[0] ?? "").split(" · ")[0] ?? "").trim().replace(/\.$/, "");
}

/** A wrap-up note's words, under its first line. Pure. */
export function wordsOfNote(text: string): string {
  const at = text.indexOf("\n");
  return at < 0 ? "" : text.slice(at + 1).trim();
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
async function gather(ctx: MobileCtx, summary: DaySummary, dayFrom: string, midnight: string): Promise<JobDay[]> {
  const jobs = jobsOfDay(summary);
  if (!jobs.length) return [];
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  const uuids = jobs.map((j) => j.jobUuid);
  /* the mirror keeps ServiceM8's uuids as text: either case finds them */
  const either = [...new Set(uuids.flatMap((u) => [u, u.toLowerCase()]))];
  const [notes, photos, threads, theirs, facts] = await Promise.all([
    staffId
      ? supabaseAdmin
          .from("workboard_notes")
          .select("target_id, transcript, created_at")
          .eq("org_id", ctx.orgId)
          .eq("author_id", staffId)
          .eq("target_kind", "job")
          .in("target_id", uuids)
          .gte("created_at", dayFrom)
          .is("removed_at", null)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    staffId
      ? supabaseAdmin
          .from("documents")
          .select("id, sm8_job_uuid")
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
    /* everyone else's notes on these jobs today, for "Already on the job today" */
    supabaseAdmin
      .from("workboard_notes")
      .select("target_id, transcript, created_at, author_id")
      .eq("org_id", ctx.orgId)
      .eq("target_kind", "job")
      .in("target_id", uuids)
      .gte("created_at", midnight)
      .is("removed_at", null)
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("sm8_jobs").select("uuid, job_address").eq("org_id", ctx.orgId).in("uuid", either),
  ]);
  const noteRows = (notes.data ?? []) as { target_id: string; transcript: string | null; created_at: string }[];
  const photoRows = (photos.data ?? []) as { id: string; sm8_job_uuid: string | null }[];
  const threadRows = (threads.data ?? []) as { messages: unknown }[];
  const otherRows = ((theirs.data ?? []) as { target_id: string; transcript: string | null; created_at: string; author_id: string | null }[]).filter(
    (n) => n.author_id !== staffId && n.transcript?.trim(),
  );
  const authors = [...new Set(otherRows.map((n) => n.author_id).filter((a): a is string => !!a))];
  const names = new Map<string, string>();
  if (authors.length) {
    const { data } = await supabaseAdmin.from("staff_profiles").select("id, first_name, full_name").eq("org_id", ctx.orgId).in("id", authors);
    for (const r of (data ?? []) as { id: string; first_name: string | null; full_name: string | null }[]) {
      const n = r.first_name?.trim() || r.full_name?.trim().split(/\s+/)[0];
      if (n) names.set(r.id, n);
    }
  }
  const addresses = new Map(((facts.data ?? []) as { uuid: string; job_address: string | null }[]).map((r) => [r.uuid.toLowerCase(), r.job_address?.trim().replace(/\s*\n\s*/g, ", ") || null]));
  return jobs.map((j) => {
    const k = j.jobUuid.toLowerCase();
    return {
      ...j,
      notes: noteRows.filter((n) => n.target_id.toLowerCase() === k && n.transcript?.trim()).map((n) => clip(n.transcript!.trim(), NOTE_CAP)),
      photos: photoRows.filter((p) => p.sm8_job_uuid?.toLowerCase() === k).length,
      asked: askedThere(threadRows, j.spans),
      mine: noteRows.filter((n) => n.target_id.toLowerCase() === k && n.transcript?.trim()).map((n) => ({ at: n.created_at, text: clip(n.transcript!.trim(), NOTE_CAP) })),
      photoIds: photoRows.filter((p) => p.sm8_job_uuid?.toLowerCase() === k).map((p) => p.id),
      others: otherRows
        .filter((n) => n.target_id.toLowerCase() === k)
        .map((n) => ({ name: (n.author_id && names.get(n.author_id)) || "Someone", at: n.created_at, text: clip(n.transcript!.trim(), NOTE_CAP) })),
      address: addresses.get(k) ?? null,
      own: noteRows.filter((n) => n.target_id.toLowerCase() === k && n.transcript?.trim()).map((n) => ({ at: n.created_at, text: n.transcript!.trim() })),
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
export async function writeUpDay(
  ctx: MobileCtx,
  until?: string | null,
  now: number = Date.now(),
  on?: string | null,
  /** one job, from "Isaac wrapped up 3324": written up from your booking on it when it isn't on your day's sheet */
  job?: string | null
): Promise<{ entries: WriteupEntry[]; day: { workDate: string; onAt: string; offAt: string | null; minutes: number } | null }> {
  const read = await readDay(ctx, now, until, on);
  const [zone, name] = await Promise.all([bookingZone(ctx.orgId).then((z) => z.zone ?? "Australia/Sydney"), firstNameOf(ctx)]);
  const state = job && !read.summary?.jobs.some((j) => j.jobUuid.toLowerCase() === job.toLowerCase()) ? await bookedOnly(ctx, job, on ?? read.day?.workDate ?? null, zone, now) ?? read : read;
  if (!state.day || !state.summary) return { entries: [], day: null };
  const midnight = new Date(wallInstant(`${state.day.workDate} 00:00:00`, zone, "earliest") ?? Date.parse(state.day.onAt)).toISOString();
  const jobs = await gather(ctx, state.summary, state.day.onAt, midnight < state.day.onAt ? midnight : state.day.onAt);
  const filed = jobs.map((j) => filedNote(headOf(name, j.spans, zone), j.own));
  /* a job whose note is in isn't written up again */
  const texts = await written(jobs.map((j, i) => (filed[i] ? { ...j, notes: [], asked: [] } : j)));
  return {
    entries: jobs.map((j, i) => ({
      jobUuid: j.jobUuid,
      number: j.number,
      where: j.where,
      line: lineOf(name, j, zone),
      name,
      photos: j.photos,
      asked: j.asked.length,
      text: texts[i] ?? "",
      spans: j.spans,
      address: j.address,
      mine: j.mine,
      photoIds: j.photoIds,
      others: j.others,
      filed: filed[i]?.at ?? null,
      filedText: filed[i] ? wordsOfNote(filed[i]!.text) : null,
    })),
    day: { workDate: state.day.workDate, onAt: state.day.onAt, offAt: state.day.offAt, minutes: state.summary.minutes },
  };
}

/** A day of one job, from your ServiceM8 booking on it: for a job someone else wrapped up first, that you were booked
    on but didn't clock onto in HeyTiff. Null when you weren't booked on it that day. */
async function bookedOnly(ctx: MobileCtx, job: string, on: string | null, zone: string, now: number): Promise<{ day: NonNullable<Awaited<ReturnType<typeof readDay>>["day"]>; summary: DaySummary } | null> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return null;
  const day = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : new Date(now).toLocaleDateString("en-CA", { timeZone: zone });
  const { data: link } = await supabaseAdmin.from("integration_links").select("remote_id").eq("org_id", ctx.orgId).eq("provider", "servicem8").eq("kind", "staff").eq("staff_profile_id", staffId).limit(1);
  const sm8Staff = ((link ?? []) as { remote_id: string | null }[])[0]?.remote_id;
  if (!sm8Staff) return null;
  const either = [...new Set([job, job.toLowerCase()])];
  const [{ data: acts }, { data: facts }] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_activities")
      .select("start_date, end_date")
      .eq("org_id", ctx.orgId)
      .in("job_uuid", either)
      .eq("staff_uuid", sm8Staff)
      .eq("active", 1)
      .gte("start_date", `${day} 00:00:00`)
      .lte("start_date", `${day} 23:59:59`)
      .order("start_date", { ascending: true }),
    supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id, job_address").eq("org_id", ctx.orgId).in("uuid", either).limit(1),
  ]);
  const f = ((facts ?? []) as { uuid: string; generated_job_id: string | null; job_address: string | null }[])[0];
  const spans = ((acts ?? []) as { start_date: string; end_date: string | null }[])
    .map((a) => ({ from: wallInstant(a.start_date, zone, "earliest"), until: wallInstant(a.end_date ?? a.start_date, zone, "latest") }))
    .filter((s): s is { from: number; until: number } => s.from !== null && s.until !== null && s.until >= s.from);
  if (!f || !spans.length) return null;
  const where = (f.job_address ?? "").split("\n")[0]?.trim() || "the job";
  const jobs = spans.map((s) => ({
    jobUuid: f.uuid,
    number: f.generated_job_id,
    where,
    from: new Date(s.from).toISOString(),
    until: new Date(s.until).toISOString(),
    minutes: Math.round((s.until - s.from) / 60_000),
    how: "servicem8" as const,
  }));
  const minutes = jobs.reduce((n, j) => n + j.minutes, 0);
  return {
    day: { id: `booked:${f.uuid}:${day}`, workDate: day, onAt: jobs[0]!.from, offAt: jobs[jobs.length - 1]!.until },
    summary: { from: jobs[0]!.from, until: jobs[jobs.length - 1]!.until, minutes, jobs, office: { minutes: 0, spans: [], unpaid: 0 }, travel: 0, paid: { from: jobs[0]!.from, minutes } },
  };
}

async function firstNameOf(ctx: MobileCtx): Promise<string | null> {
  const { data } = await supabaseAdmin.from("staff_profiles").select("first_name, full_name").eq("org_id", ctx.orgId).eq("user_id", ctx.userId).maybeSingle();
  const row = data as { first_name: string | null; full_name: string | null } | null;
  return row?.first_name?.trim() || row?.full_name?.trim().split(/\s+/)[0] || null;
}
