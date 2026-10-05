#!/usr/bin/env node
/* Tiff's reading of the golden jobs' descriptions beside the rule reader's,
   with what each read cost. The prompt and schema are the app's own
   (src/lib/certs/description-reader.ts).

     node scripts/cert-read-compare.mjs [model] [effort] [--record]

   Defaults: claude-opus-5-5, medium (what the app uses). ONLY=JOB_2933,JOB_2207
   reads just those. --record rewrites the replies the tests read
   (src/lib/certs/__tests__/fixtures/description-reads.json): do that only with
   the app's own model and effort, then check the tests still say what's right. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import Anthropic from "@anthropic-ai/sdk";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.ANTHROPIC_API_KEY) {
  const env = fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8") : "";
  const m = /^ANTHROPIC_API_KEY=(.*)$/m.exec(env);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^["']|["']$/g, "");
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY isn't set (nor in .env.local).");
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const RECORD = process.argv.includes("--record");
const MODEL = args[0] ?? "claude-opus-5-5";
const EFFORT = args[1] ?? "medium";
/* $ per million tokens, input and output */
const PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-4-5": [1, 5] }[MODEL];
if (!PRICE) console.warn(`No price for ${MODEL}: costs print as 0.`);

const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") } });
const { readQuote } = await jiti.import(path.join(root, "src/lib/certs/quote.ts"));
const { CERT_DESCRIPTION_PROMPT, CERT_DESCRIPTION_SCHEMA, mergeDescriptionReading } = await jiti.import(path.join(root, "src/lib/certs/description-reader.ts"));
const jobs = await jiti.import(path.join(root, "src/lib/certs/__tests__/fixtures/jobs.ts"));

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const names = Object.keys(jobs).filter((k) => k.startsWith("JOB_") && (!only || only.includes(k)));

const flat = (q) => ({
  systems: q.systems.map((s) => [[s.outdoor.model, s.outdoor.capacityKw, s.outdoor.location], s.indoors.map((r) => [r.qty, r.model, r.capacityKw, r.location])]),
  fans: q.fans.map((f) => [f.qty, f.model, f.location]),
  ductwork_fire_vent_refrigerant: [q.ductwork, q.fireRated, q.ventilation, q.refrigerant],
});

const client = new Anthropic();
const raw = {};
let cents = 0;
const lines = await Promise.all(
  names.map(async (name) => {
    const t0 = Date.now();
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: CERT_DESCRIPTION_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `<description>\n${jobs[name]}\n</description>` },
            { type: "text", text: CERT_DESCRIPTION_PROMPT },
          ],
        },
      ],
    });
    const block = [...res.content].reverse().find((b) => b.type === "text");
    raw[name] = JSON.parse(block?.text ?? "{}");
    const c = PRICE ? (res.usage.input_tokens * PRICE[0] + res.usage.output_tokens * PRICE[1]) / 1e4 : 0;
    cents += c;
    const rules = readQuote(jobs[name]);
    return [
      `=== ${name}  ${res.usage.input_tokens} in / ${res.usage.output_tokens} out  ${c.toFixed(2)}c  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${res.stop_reason}`,
      `tiff:  ${JSON.stringify(flat(mergeDescriptionReading(raw[name], rules)))}`,
      `rules: ${JSON.stringify(flat(rules))}`,
    ].join("\n");
  }),
);
console.log(lines.join("\n\n"));
console.log(`\n${MODEL} @ ${EFFORT}: ${names.length} reads, ${cents.toFixed(1)}c, ${(cents / names.length).toFixed(2)}c a read`);

if (RECORD) {
  const file = path.join(root, "src/lib/certs/__tests__/fixtures/description-reads.json");
  const kept = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const all = { ...kept, ...raw };
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]])), null, 2) + "\n");
  console.log(`Recorded ${names.length} replies in ${path.relative(root, file)}.`);
}
