/**
 * @jest-environment node
 */
/* TIFF'S EVALS. Opt-in, never part of `npm test`, and never in CI.

       npm run evals:tiff

   Every case runs through `answer()` (lib/brain/turn), the function the ask
   route wraps, as a real viewer against the live database. Phase 1's tools
   only read, so nothing is written; an injection case plants its words with
   `stub`, which replaces one tool's result in memory.

   IT SPENDS MONEY. Each case is one to three model calls, about 2 to 4c US.
   The run prints its cost as it goes and stops at TIFF_EVALS_MAX_USD
   (default 2). Isaac decides when a paid run happens.

   Needs ANTHROPIC_API_KEY and the Supabase service role (the main checkout's
   .env.local). With TIFF_EVALS=1 and either missing it FAILS — a run asked
   for that silently did nothing would read as a pass. Without TIFF_EVALS it
   passes having done nothing, so `npm test` stays free.

   Cases are git-ignored JSON in evals/tiff/cases/ (they name real people and
   clients); results land in evals/tiff/results/, also ignored. The viewer is
   the owner of TIFF_EVALS_ORG (or of the only org), or TIFF_EVALS_USER. */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { grade, parseCase, type CapturedRun, type EvalCase } from "../score";

const RUN = process.env.TIFF_EVALS === "1";
const ROOT = path.resolve(process.cwd(), "evals", "tiff");
const MAX_USD = Number(process.env.TIFF_EVALS_MAX_USD) || 2;

/* The modules that reach the database or the API load only when a run is
   asked for: the Supabase client is made the moment its module loads. */
const load = async () => ({
  ...(await import("@/lib/brain/turn")),
  ...(await import("@/lib/tiff/registry")),
  ...(await import("@/lib/tiff/registry/viewer")),
  ...(await import("@/lib/tiff/usage")),
  ...(await import("@/lib/supabase-server")),
});

async function readCases(): Promise<EvalCase[]> {
  const dir = path.join(ROOT, "cases");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "example.json");
  const out: EvalCase[] = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(dir, f), "utf8")) as unknown;
    for (const c of Array.isArray(raw) ? raw : [raw]) out.push(parseCase(c, f));
  }
  return out;
}

it(
  "runs Tiff's eval cases when TIFF_EVALS=1",
  async () => {
    if (!RUN) return;
    if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("TIFF_EVALS=1 needs ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY (the main checkout's .env.local).");
    }
    const m = await load();
    const cases = await readCases();
    if (!cases.length) throw new Error("No cases in evals/tiff/cases/.");

    const orgId =
      process.env.TIFF_EVALS_ORG ??
      String(((await m.supabaseAdmin.from("organizations").select("id").limit(2)).data ?? [])[0]?.id ?? "");
    const userId =
      process.env.TIFF_EVALS_USER ??
      String(
        (await m.supabaseAdmin.from("organizations").select("primary_owner_user_id").eq("id", orgId).maybeSingle())
          .data?.primary_owner_user_id ?? ""
      );
    if (!orgId || !userId) throw new Error("Couldn't find the org and its owner; set TIFF_EVALS_ORG and TIFF_EVALS_USER.");
    const viewer = await m.viewerForUser(orgId, userId);

    let spent = 0;
    const results: { c: EvalCase; runs: { run: CapturedRun; verdict: ReturnType<typeof grade> }[] }[] = [];
    for (const c of cases) {
      if (spent >= MAX_USD) break;
      const runs = [];
      for (let i = 0; i < (c.runs ?? 1); i++) {
        const body = m.shapeAsk({
          question: c.say,
          page: c.page,
          history: c.history,
        });
        const run: CapturedRun = { tools: [], moves: [], text: "" };
        if (!body) {
          run.error = "the body didn't shape";
        } else {
          const tools = m.toolsFor(viewer).map((t) =>
            c.stub && t.name === c.stub.tool
              ? { ...t, run: async () => ({ kind: "result" as const, value: c.stub!.result }) }
              : t
          );
          for await (const e of m.answer(viewer, body, {
            tools,
            onUsage: (model, usage) => {
              spent += m.costOf(model, usage) ?? 0;
            },
          })) {
            const ev = e as { type: string; name?: string; text?: string; message?: string; href?: string; label?: string };
            if (ev.type === "tool" && ev.name) run.tools.push(ev.name);
            else if (ev.type === "delta") run.text += ev.text ?? "";
            else if (ev.type === "screen") run.moves.push({ href: ev.href ?? "", label: ev.label ?? "" });
            else if (ev.type === "error") run.error = ev.message;
          }
        }
        runs.push({ run, verdict: grade(c, run) });
      }
      results.push({ c, runs });
      console.log(`${runs.every((r) => r.verdict.pass) ? "PASS" : "FAIL"} ${c.id}  (spent US$${spent.toFixed(2)})`);
    }

    const passed = results.filter((r) => r.runs.every((x) => x.verdict.pass)).length;
    const lines = [
      `# Tiff evals, ${new Date().toISOString().slice(0, 16)}`,
      "",
      `${passed} of ${results.length} cases passed${results.length < cases.length ? ` (stopped at the US$${MAX_USD} cap after ${results.length} of ${cases.length})` : ""}. Spent US$${spent.toFixed(2)}.`,
      "",
      "| Case | Result | Why |",
      "| --- | --- | --- |",
      ...results.map((r) => {
        const failed = r.runs.find((x) => !x.verdict.pass);
        return `| ${r.c.id} | ${failed ? "fail" : "pass"} | ${failed ? failed.verdict.reasons.join("; ") : ""} |`;
      }),
    ];
    await mkdir(path.join(ROOT, "results"), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await writeFile(path.join(ROOT, "results", `evals-${stamp}.md`), lines.join("\n"));
    await writeFile(path.join(ROOT, "results", `evals-${stamp}.json`), JSON.stringify(results, null, 2));
    console.log(lines.join("\n"));
  },
  60 * 60 * 1000
);
