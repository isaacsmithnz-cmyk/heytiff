import type { QuoteLine } from "../lines";
import type { LineChange } from "../lines-server";
import { changesWithoutMoney, lineWithoutMoney, maskMoney, patchWithoutMoney, threadWithoutMoney } from "../money-hidden";

/* Isaac, 2026-10-12: "For techs who are quoting a job, but the visibility,
   the money visibility can be hidden… anyone with money access can review
   the quote and check the pricing". */

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "l1", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "", group: "Units", position: 0, name: "PEA-M125HAA",
  code: "PEA-M125HAA", supplierKey: "aad", kind: "unit", qty: 1, unit: "", costCents: 400000, sellCents: 520000, source: "said", why: "", duct: false, ...o,
});

it("takes every dollar figure out of words, however it's written", () => {
  expect(maskMoney("It comes to $4402.79 ex GST, three phase +$519.96, single fan −$304.92, about $8k a head and $1,480 for the AirTouch.")).toBe(
    "It comes to $… ex GST, three phase $…, single fan $…, about $… a head and $… for the AirTouch."
  );
  expect(maskMoney("14 m of pipe, 2 lengths")).toBe("14 m of pipe, 2 lengths");
});

it("keeps a line's work and takes out its price", () => {
  expect(lineWithoutMoney(line({}))).toMatchObject({ name: "PEA-M125HAA", qty: 1, costCents: 0, sellCents: null, source: "said" });
});

it("keeps the history of the work, without its prices; a price change alone is gone", () => {
  const changes: LineChange[] = [
    { id: 3, lineId: "l1", action: "change", before: { sellCents: 500000 }, after: { sellCents: 520000 }, why: "Round to $5,200", madeBy: "u", madeAt: "" },
    { id: 2, lineId: "l1", action: "change", before: { qty: 1, costCents: 1 }, after: { qty: 2, costCents: 2 }, why: "", madeBy: "u", madeAt: "" },
    { id: 1, lineId: "l1", action: "add", before: null, after: { name: "PEA-M125HAA", costCents: 400000 }, why: "", madeBy: "tiff", madeAt: "" },
  ];
  expect(changesWithoutMoney(changes)).toEqual([
    { ...changes[1], before: { qty: 1 }, after: { qty: 2 } },
    { ...changes[2], after: { name: "PEA-M125HAA" } },
  ]);
});

it("takes the money out of Tiff's thread: her words, a tool's line, an answer, and a price from the web", () => {
  const out = threadWithoutMoney([
    { id: 1, kind: "reply", body: { text: "Option 1 is $12,840 ex GST." } },
    { id: 2, kind: "tool", body: { name: "research_price", said: "Ergovent at $310", detail: { research: { priceCents: 31000 } } } },
    { id: 3, kind: "question", body: { question: "Three phase?", answers: [{ label: "Yes, +$520", changes: [] }] } },
  ]);
  expect(out[0]!.body.text).toBe("Option 1 is $… ex GST.");
  expect(out[1]!.body).toEqual({ name: "research_price", said: "Ergovent at $…" });
  expect((out[2]!.body.answers as { label: string }[])[0]!.label).toBe("Yes, $…");
});

/* found mapping the chat-first page, 2026-10-14: a tech saw the owner's $50
   in the grille line's dot, and her write-up's and plan's detail unmasked */
it("takes a price out of why a line is there", () => {
  expect(lineWithoutMoney(line({ why: '"$50 plus GST a grille"; 8 grilles' })).why).toBe('"$… plus GST a grille"; 8 grilles');
});

it("takes the money out of a tool's detail, what she put, and an error", () => {
  const out = threadWithoutMoney([
    { id: 1, kind: "tool", body: { name: "write_up", said: "the job, written out", detail: { writeUp: { work: ["Floor grilles: $50 each ex GST allowance × 8."] } } } },
    { id: 2, kind: "tool", body: { name: "plan_parts", detail: { option: 0, parts: [{ group: "Units", detail: "PEA-M100HAA at $936.60" }] } } },
    { id: 3, kind: "question", body: { question: "Allowance per grille?", put: "8 at the book's $38.93" } },
    { id: 4, kind: "error", body: { message: "Stopped at $1,965.87 of the pipe group." } },
  ]);
  expect(JSON.stringify(out)).not.toMatch(/\$\d/);
  expect((out[0]!.body.detail as { writeUp: { work: string[] } }).writeUp.work[0]).toBe("Floor grilles: $… each ex GST allowance × 8.");
  expect(out[2]!.body.put).toBe("8 at the book's $…");
  expect((out[1]!.body.detail as { option: number }).option).toBe(0);
});

it("lets a change through without its price", () => {
  expect(patchWithoutMoney({ qty: 3, costCents: 1, sellCents: 2, estimate: false })).toEqual({ qty: 3 });
  expect(patchWithoutMoney(null)).toEqual({});
});
