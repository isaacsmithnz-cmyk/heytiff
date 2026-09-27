/**
 * @jest-environment node
 */
/* THE PHASE 0 PROBES. Opt-in, never part of `npm test`.

       TIFF_PROBE=p0 npm run probe:tiff      notes: today's router against the loop
       TIFF_PROBE=p0base npm run probe:tiff  notes: today's router against itself
       TIFF_PROBE=p1 npm run probe:tiff      Opus 5 against Opus 5.5, notes and questions
       TIFF_PROBE=p3 npm run probe:tiff      tool search against every tool loaded

   Needs ANTHROPIC_API_KEY and the Supabase service role, so it runs on a
   machine that has them (the main checkout's .env.local), never in CI:
   without a probe named, or without a key, it says what is missing and
   passes. Everything it does is a read. Notes are read from the database
   and routed, and the proposals are compared, never filed.

   Results land in probes/results/, which git ignores: they hold real notes.
   P1's questions come from probes/cases/questions.json, also ignored, for
   the same reason: a question about a job names its client.

   Built like `npm run bakeoff` (lib/voice/bakeoff): a jest suite because the
   module resolution and TypeScript are already set up, the pure scoring
   beside it is unit-tested in the same place, and a failure has somewhere
   honest to be reported. */

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { contextFor, storedNotes, type StoredNote } from "../context";
import { askRead, loopRead, routerRead, type AskRead, type NoteRead } from "../paths";
import { compareRows, costOf, percentile, type RowVerdict } from "../rows";
import { DRAFT_PHRASES } from "../drafts";
import { pickTool, type SearchPick } from "../search";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";

const PROBE = process.env.TIFF_PROBE ?? "";
const ROOT = path.resolve(process.cwd(), "probes");
const RESULTS = path.join(ROOT, "results");
const CONCURRENCY = 3;
const OPUS_5 = "claude-opus-5";
const OPUS_55 = "claude-opus-5-5";
/** A smoke run: `TIFF_PROBE_LIMIT=2` reads two notes, or two phrases. */
const LIMIT = Number(process.env.TIFF_PROBE_LIMIT) || Number.POSITIVE_INFINITY;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
    }),
  );
  return out;
}

const ms = (n: number) => `${(n / 1000).toFixed(1)} s`;
const usd = (n: number) => `US$${n.toFixed(2)}`;
const cost = (r: NoteRead | AskRead) => r.rounds.reduce((sum, round) => sum + costOf(round.model, round.usage), 0);
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\|/g, "/").replace(/\s+/g, " ");

async function save(name: string, json: unknown, md: string) {
  await mkdir(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await writeFile(path.join(RESULTS, `${name}-${stamp}.json`), JSON.stringify(json, null, 2));
  await writeFile(path.join(RESULTS, `${name}-${stamp}.md`), md);
  console.log(md);
}

type Pair = { note: StoredNote; a: NoteRead; b: NoteRead; verdict: RowVerdict | null };

/** Two reads of every note, alternating which goes first so neither always
    meets a colder connection. */
async function pairs(
  client: Anthropic,
  notes: StoredNote[],
  first: (note: StoredNote, ctx: Awaited<ReturnType<typeof contextFor>>) => Promise<NoteRead>,
  second: (note: StoredNote, ctx: Awaited<ReturnType<typeof contextFor>>) => Promise<NoteRead>,
): Promise<Pair[]> {
  return mapLimit(notes, CONCURRENCY, async (note, i) => {
    const ctx = await contextFor(note);
    let a: NoteRead;
    let b: NoteRead;
    if (i % 2 === 0) {
      a = await first(note, ctx);
      b = await second(note, ctx);
    } else {
      b = await second(note, ctx);
      a = await first(note, ctx);
    }
    const verdict = a.proposal && b.proposal ? compareRows(a.proposal, b.proposal) : null;
    return { note, a, b, verdict };
  });
}

function pairReport(title: string, aName: string, bName: string, rows: Pair[]): string {
  const outcomes = (side: "a" | "b") =>
    Object.entries(
      rows.reduce<Record<string, number>>((acc, r) => ((acc[r[side].outcome] = (acc[r[side].outcome] ?? 0) + 1), acc), {}),
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  const both = rows.filter((r) => r.verdict);
  const same = both.filter((r) => r.verdict?.same).length;
  const wrong = both.filter((r) => r.verdict?.wrongAssignee).length;
  const aMs = rows.map((r) => r.a.modelMs);
  const bMs = rows.map((r) => r.b.modelMs);
  const aTotal = rows.map((r) => r.a.totalMs);
  const bTotal = rows.map((r) => r.b.totalMs);
  const multi = rows.filter((r) => r.b.rounds.length > 1).length;
  const aCost = rows.reduce((s, r) => s + cost(r.a), 0);
  const bCost = rows.reduce((s, r) => s + cost(r.b), 0);

  const lines = [
    `# ${title}`,
    "",
    `${rows.length} notes. ${aName}: ${outcomes("a")}. ${bName}: ${outcomes("b")}.`,
    "",
    "| | " + aName + " | " + bName + " |",
    "| --- | --- | --- |",
    `| Model time, median | ${ms(percentile(aMs, 50))} | ${ms(percentile(bMs, 50))} |`,
    `| Model time, p90 | ${ms(percentile(aMs, 90))} | ${ms(percentile(bMs, 90))} |`,
    `| With the English check, median | ${ms(percentile(aTotal, 50))} | ${ms(percentile(bTotal, 50))} |`,
    `| With the English check, p90 | ${ms(percentile(aTotal, 90))} | ${ms(percentile(bTotal, 90))} |`,
    `| Cost, all notes | ${usd(aCost)} | ${usd(bCost)} |`,
    `| Cost per note | ${usd(aCost / rows.length)} | ${usd(bCost / rows.length)} |`,
    "",
    `Same rows on ${same} of ${both.length} notes both read into a proposal. Wrong assignee: ${wrong}. ` +
      `${bName} took more than one round on ${multi}.`,
    "",
    "| Note | " + aName + " | " + bName + " | Differences |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => {
      const d = r.verdict ? (r.verdict.same ? (r.verdict.diffs.length ? r.verdict.diffs.join("; ") : "") : `**${r.verdict.diffs.join("; ")}**`) : "";
      const side = (x: NoteRead) => `${x.outcome} ${ms(x.modelMs)}${x.rounds.length > 1 ? ` (${x.rounds.length} rounds: ${x.rounds.map((y) => y.tools.join("+") || "text").join(", ")})` : ""}${x.text && x.outcome !== "filed" ? `: ${clip(x.text, 60)}` : ""}`;
      return `| ${clip(r.note.transcript)} | ${side(r.a)} | ${side(r.b)} | ${d}${r.verdict?.wrongAssignee ? " **WRONG ASSIGNEE**" : ""} |`;
    }),
  ];
  return lines.join("\n");
}

async function p0(client: Anthropic) {
  const notes = (await storedNotes()).slice(0, LIMIT);
  const rows = await pairs(
    client,
    notes,
    (n, ctx) => routerRead(client, n.transcript, ctx, OPUS_5),
    (n, ctx) => loopRead(client, n.transcript, ctx, n.orgId, OPUS_5),
  );
  const effort = process.env.TIFF_LOOP_EFFORT ?? "medium";
  const strict = process.env.TIFF_LOOP_STRICT !== "0";
  const nolookup = process.env.TIFF_LOOP_NOLOOKUP === "1";
  const variant = `${effort === "medium" ? "" : `-${effort}`}${strict ? "" : "-loose"}${nolookup ? "-nolookup" : ""}`;
  await save(
    `p0${variant}`,
    rows,
    pairReport(
      `P0: notes through today's router and through the loop (loop effort ${effort}, file_note ${strict ? "strict" : "not strict"}${nolookup ? ", no look-ups before filing" : ""})`,
      "Router",
      "Loop",
      rows,
    ),
  );
}

/** How often today's router agrees with itself: the yardstick P0's "same
    rows" needs, because a router that disagrees with itself one note in five
    makes 24 of 30 noise rather than a loss. */
async function p0base(client: Anthropic) {
  const notes = (await storedNotes()).slice(0, LIMIT);
  const rows = await pairs(
    client,
    notes,
    (n, ctx) => routerRead(client, n.transcript, ctx, OPUS_5),
    (n, ctx) => routerRead(client, n.transcript, ctx, OPUS_5),
  );
  await save("p0base", rows, pairReport("P0 baseline: today's router against itself", "Router", "Router again", rows));
}

type Question = { ask: string; expect?: string };

async function p1(client: Anthropic) {
  const notes = (await storedNotes()).slice(0, LIMIT);
  const rows = await pairs(
    client,
    notes,
    (n, ctx) => routerRead(client, n.transcript, ctx, OPUS_5),
    (n, ctx) => routerRead(client, n.transcript, ctx, OPUS_55),
  );
  let questions: Question[] = [];
  try {
    questions = (JSON.parse(await readFile(path.join(ROOT, "cases", "questions.json"), "utf8")) as Question[]).slice(0, LIMIT);
  } catch {
    console.log("No probes/cases/questions.json: P1 reads the notes only.");
  }
  const orgId = notes[0]?.orgId ?? "";
  const today = todayInZone(await getSm8Timezone(orgId));
  const asked = await mapLimit(questions, CONCURRENCY, async (q, i) => {
    const one = async (model: string) => askRead(client, q.ask, orgId, today, model);
    const [a, b] = i % 2 === 0 ? [await one(OPUS_5), await one(OPUS_55)] : (([y, x]) => [x, y])([await one(OPUS_55), await one(OPUS_5)]);
    return { q, a, b };
  });

  const qa = asked.map((x) => x.a.modelMs);
  const qb = asked.map((x) => x.b.modelMs);
  const qLines = asked.length
    ? [
        "",
        "## Questions",
        "",
        `| | Opus 5 | Opus 5.5 |`,
        `| --- | --- | --- |`,
        `| Time, median | ${ms(percentile(qa, 50))} | ${ms(percentile(qb, 50))} |`,
        `| Time, p90 | ${ms(percentile(qa, 90))} | ${ms(percentile(qb, 90))} |`,
        `| Cost, all questions | ${usd(asked.reduce((s, x) => s + cost(x.a), 0))} | ${usd(asked.reduce((s, x) => s + cost(x.b), 0))} |`,
        "",
        ...asked.flatMap((x) => [
          `### ${x.q.ask}`,
          x.q.expect ? `Expect: ${x.q.expect}` : "",
          "",
          `**Opus 5** (${ms(x.a.modelMs)}, ${x.a.tools.join(", ") || "no tools"})${x.a.error ? ` ERROR ${x.a.error}` : ""}: ${x.a.answer.trim()}`,
          "",
          `**Opus 5.5** (${ms(x.b.modelMs)}, ${x.b.tools.join(", ") || "no tools"})${x.b.error ? ` ERROR ${x.b.error}` : ""}: ${x.b.answer.trim()}`,
          "",
        ]),
      ]
    : [];
  await save(
    "p1",
    { notes: rows, questions: asked },
    pairReport("P1: the router on Opus 5 and on Opus 5.5", "Opus 5", "Opus 5.5", rows) + "\n" + qLines.join("\n"),
  );
}

async function p3(client: Anthropic) {
  const picks = await mapLimit(DRAFT_PHRASES.slice(0, LIMIT), CONCURRENCY, async (phrase, i) => {
    /* Every fifth phrase also sends a second round, to watch the cache. */
    const followUp = i % 5 === 0;
    const loaded = await pickTool(client, phrase.say, "loaded", OPUS_5, followUp);
    const searched = await pickTool(client, phrase.say, "searched", OPUS_5, followUp);
    return { phrase, loaded, searched };
  });
  const right = (p: SearchPick, want: string) => p.picked === want;
  const score = (shape: "loaded" | "searched") => picks.filter((x) => right(x[shape], x.phrase.want)).length;
  const errors = (shape: "loaded" | "searched") => picks.filter((x) => x[shape].error).map((x) => x[shape].error);
  const times = (shape: "loaded" | "searched") => picks.map((x) => x[shape].ms);
  const spend = (shape: "loaded" | "searched") => picks.reduce((s, x) => s + costOf(x[shape].model, x[shape].usage), 0);
  const follow = picks.filter((x) => x.loaded.followUp || x.searched.followUp);
  const md = [
    "# P3: tool search against every tool loaded",
    "",
    `${picks.length} phrases, 45 tools (the 5 reads and 40 drafts).`,
    "",
    "| | Loaded | Searched |",
    "| --- | --- | --- |",
    `| Right tool | ${score("loaded")} of ${picks.length} | ${score("searched")} of ${picks.length} |`,
    `| Errors | ${errors("loaded").length} | ${errors("searched").length} |`,
    `| Time, median | ${ms(percentile(times("loaded"), 50))} | ${ms(percentile(times("searched"), 50))} |`,
    `| Time, p90 | ${ms(percentile(times("loaded"), 90))} | ${ms(percentile(times("searched"), 90))} |`,
    `| Cost, all phrases | ${usd(spend("loaded"))} | ${usd(spend("searched"))} |`,
    "",
    errors("searched")[0] ? `First error with search: ${errors("searched")[0]}` : "",
    errors("loaded")[0] ? `First error loaded: ${errors("loaded")[0]}` : "",
    "",
    "## Second rounds, for the cache",
    "",
    "| Phrase | Loaded: cache read, round 1 then 2 | Searched: cache read, round 1 then 2 |",
    "| --- | --- | --- |",
    ...follow.map(
      (x) =>
        `| ${clip(x.phrase.say, 50)} | ${x.loaded.usage.cache_read_input_tokens ?? 0} then ${x.loaded.followUp?.usage.cache_read_input_tokens ?? "-"} | ${x.searched.usage.cache_read_input_tokens ?? 0} then ${x.searched.followUp?.usage.cache_read_input_tokens ?? "-"} |`,
    ),
    "",
    "## Misses",
    "",
    "| Phrase | Wanted | Loaded picked | Searched picked (queries) |",
    "| --- | --- | --- | --- |",
    ...picks
      .filter((x) => !right(x.loaded, x.phrase.want) || !right(x.searched, x.phrase.want))
      .map(
        (x) =>
          `| ${clip(x.phrase.say, 50)} | ${x.phrase.want} | ${x.loaded.picked ?? "none"} | ${x.searched.picked ?? "none"} (${x.searched.searches.map((s) => clip(s, 40)).join("; ")}) |`,
      ),
  ].join("\n");
  await save("p3", picks, md);
}

describe("Tiff's Phase 0 probes", () => {
  it(
    "runs the probe TIFF_PROBE names",
    async () => {
      if (!PROBE) return;
      if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log("TIFF_PROBE is set but ANTHROPIC_API_KEY or SUPABASE_SERVICE_ROLE_KEY is missing: nothing ran.");
        return;
      }
      const client = new Anthropic({ maxRetries: 4 });
      if (PROBE === "p0") await p0(client);
      else if (PROBE === "p0base") await p0base(client);
      else if (PROBE === "p1") await p1(client);
      else if (PROBE === "p3") await p3(client);
      else console.log(`No probe called ${PROBE}. Try p0, p0base, p1 or p3.`);
    },
    3 * 60 * 60 * 1000,
  );
});
