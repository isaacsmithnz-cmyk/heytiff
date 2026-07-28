/**
 * @jest-environment node
 */

/* THE RUNNER. Opt-in, never part of `npm test`.

       npm run bakeoff

   Needs ELEVENLABS_API_KEY and at least one case in bakeoff/cases/. Without
   either it prints what is missing and passes, so a normal suite run on a
   machine with no key and no recordings stays green — this file is tooling
   that happens to live in jest, following the `validate:packs` idiom already
   in the repo (real work, opt-in via an env var, no extra runner to install).

   It is a jest suite for three reasons: the module resolution and TypeScript
   are already configured, the pure scoring modules beside it get unit-tested
   in the same place, and a failure has somewhere honest to be reported. */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { parseCase, type BakeoffCase } from "../case";
import { buildKeyterms, assertNotSeeded, type KeytermPools } from "../keyterms";
import { report } from "../report";
import { scoreCase, summarise, type CaseScore } from "../score";
import { scribeV2, TranscriptionError, type Transcriber } from "../scribe";

const ROOT = path.resolve(process.cwd(), "bakeoff");
const CASES = path.join(ROOT, "cases");
const AUDIO = path.join(ROOT, "audio");
const RESULTS = path.join(ROOT, "results");

const RUN = process.env.BAKEOFF === "1";
const KEY = process.env.ELEVENLABS_API_KEY ?? "";

/* Four at a time: enough to keep 30 recordings under a couple of minutes,
   few enough that a rate limit doesn't poison a whole run. */
const CONCURRENCY = 4;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
    }),
  );
  return out;
}

async function loadCases(): Promise<BakeoffCase[]> {
  let files: string[];
  try {
    files = (await readdir(CASES)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return [];
  }
  const cases: BakeoffCase[] = [];
  for (const file of files.sort()) {
    const raw = await readFile(path.join(CASES, file), "utf8");
    cases.push(parseCase(path.basename(file, ".json"), JSON.parse(raw), file));
  }
  return cases;
}

async function loadPools(): Promise<KeytermPools> {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "vocab.json"), "utf8")) as KeytermPools;
  } catch {
    return {};
  }
}

type Config = { label: string; keyterms: readonly string[]; languageHint: boolean };

describe("voice bake-off", () => {
  (RUN ? it : it.skip)(
    "transcribes every case and scores it on outcomes",
    async () => {
      const cases = await loadCases();
      const pools = await loadPools();

      if (!KEY || cases.length === 0) {
        // Not a failure: this is what a fresh checkout looks like.
        console.log(
          [
            "",
            "Bake-off not runnable yet:",
            KEY ? "  ✓ ELEVENLABS_API_KEY set" : "  ✗ ELEVENLABS_API_KEY not set",
            cases.length
              ? `  ✓ ${cases.length} case(s) in bakeoff/cases/`
              : "  ✗ no case files in bakeoff/cases/ — see bakeoff/README.md",
            "",
          ].join("\n"),
        );
        return;
      }

      // Guard the one mistake that would make every number meaningless.
      for (const c of cases) {
        assertNotSeeded(pools, [
          ...(c.expect.people ?? []),
          ...(c.expect.terms ?? []),
          ...(c.expect.site ? [c.expect.site] : []),
        ]);
      }

      const built = buildKeyterms(pools);
      if (built.rejected.length > 0) {
        console.log(
          `\n${built.rejected.length} keyterm(s) not sent:\n` +
            built.rejected.map((r) => `  ${r.reason.padEnd(9)} ${r.term}`).join("\n"),
        );
      }

      const configs: Config[] = [
        { label: "scribe_v2 · bare", keyterms: [], languageHint: false },
        { label: `scribe_v2 · ${built.terms.length} keyterms`, keyterms: built.terms, languageHint: true },
      ];

      const transcriber: Transcriber = scribeV2(KEY);
      const runs: { summary: ReturnType<typeof summarise>; scores: CaseScore[] }[] = [];
      const raw: Record<string, Record<string, string>> = {};

      for (const config of configs) {
        const scores = await mapLimit(cases, CONCURRENCY, async (c) => {
          const audio = await readFile(path.join(AUDIO, c.audio));
          try {
            const result = await transcriber.transcribe({
              audio: new Uint8Array(audio),
              filename: c.audio,
              language: config.languageHint ? c.language : undefined,
              keyterms: config.keyterms,
            });
            (raw[c.id] ??= {})[config.label] = result.text;
            if (result.detectedLanguage && result.detectedLanguage !== c.language) {
              console.log(
                `  ! ${c.id}: expected ${c.language}, detected ${result.detectedLanguage}` +
                  ` (${result.languageConfidence ?? "?"})`,
              );
            }
            return scoreCase(c.id, c.truth, result.text, c.expect);
          } catch (err) {
            // A vendor error is a result, not a crash: it belongs in the
            // scorecard as a total miss beside the cases that worked.
            const why = err instanceof TranscriptionError ? err.message : String(err);
            console.log(`  ! ${c.id}: ${why}`);
            (raw[c.id] ??= {})[config.label] = "";
            return scoreCase(c.id, c.truth, "", c.expect);
          }
        });
        runs.push({ summary: summarise(config.label, scores), scores });
      }

      const conditions = new Map(cases.map((c) => [c.id, `${c.speaker} · ${c.conditions}`]));
      console.log(report(runs, conditions));

      // Keep every run: the transcripts are what you re-read when a score
      // surprises you, and the summaries are how you compare a future vendor
      // against today's without re-recording anything.
      await mkdir(RESULTS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        path.join(RESULTS, `${stamp}.json`),
        JSON.stringify(
          { at: stamp, keyterms: built.terms, runs: runs.map((r) => r.summary), scores: runs, raw },
          null,
          2,
        ),
        "utf8",
      );

      // The harness asserts nothing about quality — a bad score is a finding,
      // not a broken test. It only insists it actually ran.
      expect(runs.every((r) => r.summary.cases === cases.length)).toBe(true);
    },
    30 * 60_000,
  );
});
