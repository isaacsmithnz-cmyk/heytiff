import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { SONNET_FALLBACK } from "@/lib/tiff/sonnet-fallback";
import { searchWords } from "@/lib/quotes/price-book";
import { matchingItems, readPreferred, readSameDecisions, type BookItem } from "@/lib/quotes/price-book-server";
import { foundOf, rankCandidates, UNITS, type Candidate, type Found, type BookPick, type Thing } from "./used-plan";

/* WHAT YOU SAID YOU USED, FOUND IN THE PRICE BOOK (Isaac, 3 November 2026:
   the shared materials list, "6 metres of 3/8 5/8, 2 lengths of trunking, 2
   lengths of drain and some wall brackets"). Two reads: first the words
   become things, each with its count and what to look for; then each is
   looked for in the business's own book and the nearest are weighed, to
   pick the one it is, or to ask Which one? when the words fit more than one
   (a size not said). Nothing is written here: the list takes it at Add.
   Universal: no business's own items or habits are assumed, the book is
   whatever this one keeps, and an empty book just leaves the words. */

const MODEL = "claude-sonnet-5-5";
const MOST_THINGS = 20;

const THINGS_SYSTEM = [
  "A tradesperson says what materials they used on a job today. List each",
  "thing they used, once, in the order said.",
  "",
  "For each thing:",
  "- said: their own words for it, as said",
  "- name: a plain product name from their words, tidied, sizes kept exactly",
  "  as said ('Pair coil 3/8 x 5/8', 'Drain 20 mm', 'Wall brackets')",
  "- qty: the count or amount said, as a number. 0 when they gave none",
  "  ('some', 'a few', 'a bit of'). Never guess one",
  `- unit: one of ${UNITS.map((u) => `'${u}'`).join(", ")} when the amount is in one ('6 metres' is 'm',`,
  "  'a roll of tape' is 'roll'); '' for a count of things, lengths or pieces",
  "  ('2 lengths of trunking' is 2 and '')",
  "- search: 1 to 3 short words most likely in a supplier's product name for",
  "  it, the most telling first: a size as written in catalogues ('3/8',",
  "  '20mm'), a product word ('coil', 'trunking', 'bracket'). Lower case",
  "",
  "Only what was said: no thing they didn't name, no labour, no tools.",
  "Nothing said that is a material gives an empty list.",
].join("\n");

const THINGS_SCHEMA = {
  type: "object",
  properties: {
    things: {
      type: "array",
      items: {
        type: "object",
        properties: {
          said: { type: "string" },
          name: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string" },
          search: { type: "array", items: { type: "string" } },
        },
        required: ["said", "name", "qty", "unit", "search"],
        additionalProperties: false,
      },
    },
  },
  required: ["things"],
  additionalProperties: false,
} as const;

const PICK_SYSTEM = [
  "A tradesperson said what they used on a job. Each thing comes with the",
  "items from their business's price book that a search found, numbered.",
  "",
  "For each thing, in order:",
  "- pick: the number of the item it is, when one is clearly it: the same",
  "  product, and the size or type said matches. A size said in other units",
  "  that is the same size counts ('400 by 400' is a 16 x 16 inch filter)",
  "- else pick -1, and choices: the 2 to 4 items it could be when the words",
  "  fit products of different sizes or types (a size not said), each with",
  "  a hint of a few words that tells them apart for the person ('About 400",
  "  x 400', 'Grey, per metre'). An empty hint where the name says it",
  "- pick -1 and no choices when none of the items is the thing",
  "",
  "Items are listed the business's usual first. Something said in metres",
  "may be sold as a coil, roll or length: that item is still it, as part of",
  "one was used. Items that are the same product and size and differ only",
  "by brand, supplier or how much comes in one (a 10 m or a 20 m coil, a box",
  "of 50 or 100) are one thing to the person: pick the first of them listed,",
  "never ask which.",
  "",
  "Never pick an item of a different size or product than was said.",
  "Return exactly one answer per thing.",
].join("\n");

const PICK_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pick: { type: "integer" },
          choices: {
            type: "array",
            items: { type: "object", properties: { index: { type: "integer" }, hint: { type: "string" } }, required: ["index", "hint"], additionalProperties: false },
          },
        },
        required: ["pick", "choices"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
} as const;

async function ask<T>(system: string, schema: { [key: string]: unknown }, content: string, maxTokens: number): Promise<T | null> {
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...SONNET_FALLBACK,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const block = [...response.content].reverse().find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;
  return JSON.parse(block.text) as T;
}

/** The book's items for one thing: its search words, then fewer of them, then its name's. */
async function candidatesFor(orgId: string, t: Thing, confirmed: [string, string][], preferred: Set<string>): Promise<Candidate[]> {
  const tries = [t.search.join(" "), t.search.slice(0, 2).join(" "), t.search[0] ?? "", t.name].map((q) => searchWords(q)).filter((w) => w.length > 0);
  const seen = new Set<string>();
  for (const words of tries) {
    const key = words.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const items: BookItem[] = await matchingItems(orgId, words, confirmed, 200).catch(() => []);
    if (items.length) {
      return rankCandidates(
        items.map((i) => ({ supplierKey: i.supplierKey, code: i.code, name: i.name, uom: i.uom, timesBought: i.timesBought, preferred: preferred.has(`${i.supplierKey}|${i.code}`) })),
      );
    }
  }
  return [];
}

/** The things said, each found in the book, picked or with its choices; null when the words couldn't be read. */
export async function readUsedWords(orgId: string, words: string): Promise<Found[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const read = await ask<{ things?: Thing[] }>(THINGS_SYSTEM, THINGS_SCHEMA, words.slice(0, 2000), 3000);
    if (!read || !Array.isArray(read.things)) return null;
    const things = read.things.filter((t) => t && typeof t.name === "string" && t.name.trim()).slice(0, MOST_THINGS);
    if (!things.length) return [];
    const [same, preferred] = await Promise.all([readSameDecisions(orgId).catch(() => ({ confirmed: [] as [string, string][] })), readPreferred(orgId).catch(() => new Set<string>())]);
    const candidates = await Promise.all(things.map((t) => candidatesFor(orgId, { ...t, search: Array.isArray(t.search) ? t.search.filter((s) => typeof s === "string") : [] }, same.confirmed, preferred)));
    let picks: BookPick[] = [];
    if (candidates.some((c) => c.length)) {
      const content = things
        .map((t, i) => {
          const list = candidates[i]!.length
            ? candidates[i]!.map((c, n) => `  ${n}. ${c.name} (${c.code}${c.uom ? `, sold by ${c.uom}` : ""}${c.timesBought ? `, bought ${c.timesBought} times` : ""})`).join("\n")
            : "  (nothing found)";
          return `Thing ${i + 1}: "${t.said}"${t.qty ? `, ${t.qty}${t.unit ? ` ${t.unit}` : ""}` : ""}\n${list}`;
        })
        .join("\n\n");
      const answered = await ask<{ picks?: BookPick[] }>(PICK_SYSTEM, PICK_SCHEMA, content, 3000);
      picks = Array.isArray(answered?.picks) ? answered!.picks : [];
    }
    return things.map((t, i) => foundOf(t, candidates[i]!, picks[i]));
  } catch (err) {
    console.error(`[mobile] couldn't read what was used: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
