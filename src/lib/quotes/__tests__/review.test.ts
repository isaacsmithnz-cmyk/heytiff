import type { QuoteLine } from "../lines";
import { proposalOf } from "../lines-proposal";
import {
  answered,
  carried,
  fixesMessage,
  fixesSent,
  parseReviewRead,
  paymentFixOf,
  qualificationsOf,
  quoteStamp,
  reopened,
  reviewClear,
  reviewOf,
  reviewPrompt,
  reviewStep,
  ruleFindings,
  type QuoteReview,
  type ReviewFinding,
} from "../review";

/* TIFF'S CHECK BEFORE MARK READY TO SEND (Isaac, 26 November 2026: "Yes,
   build it" to https://claude.ai/artifact/5FtXp1LSQWQGpN4gcsCwwk), on job
   3608's real findings with a made-up client */

const line = (id: string, over: Partial<QuoteLine> = {}): QuoteLine =>
  ({
    id,
    optionIndex: 0,
    system: "VRF",
    group: "Units",
    position: 0,
    name: "PUMY-SP140VKMD2-A outdoor",
    code: "PUMY-SP140VKMD2-A",
    supplierKey: null,
    kind: "unit",
    qty: 1,
    unit: "",
    costCents: 324948,
    sellCents: 406295,
    source: "said",
    why: "",
    duct: false,
    visit: null,
    version: 1,
    updatedAt: "2026-11-26T10:00:00Z",
    updatedBy: "u",
    ...over,
  }) as QuoteLine;

const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  id: "t1",
  kind: "mismatch",
  option: 0,
  topic: "Unit cooling figures",
  words: "The unit table says 14 kW; Mitsubishi's data says 15.5 kW.",
  put: "14, 8, 2.5 and 2 kW",
  tab: "proposal",
  block: "units-0",
  lineIds: [],
  answers: [{ label: "Use the maker's figures", fix: "Put the maker's cooling figures in the unit table." }],
  state: "open",
  picked: null,
  reason: "",
  ...over,
});

const review = (findings: ReviewFinding[], stamp = "s1"): QuoteReview => ({ at: "2026-11-26T10:30:00Z", by: "u", stamp, findings, usd: 0.12 });

describe("the quote's fingerprint", () => {
  it("is the same for the same quote, and changes with a price, a quantity or a word", () => {
    const ls = [line("a"), line("b", { kind: "labour", name: "Rough-in", qty: 48, unit: "h" })];
    const p = proposalOf({ title: "Air conditioning", intro: "A budget estimate." });
    const s = quoteStamp(ls, p);
    expect(quoteStamp([...ls].reverse(), p)).toBe(s);
    expect(quoteStamp([line("a", { sellCents: 1 }), ls[1]!], p)).not.toBe(s);
    expect(quoteStamp([ls[0]!, line("b", { kind: "labour", name: "Rough-in", qty: 46, unit: "h" })], p)).not.toBe(s);
    expect(quoteStamp(ls, proposalOf({ title: "Air conditioning", intro: "A firm price." }))).not.toBe(s);
    /* who changed it, and when, isn't the quote */
    expect(quoteStamp([line("a", { updatedAt: "2026-11-27T00:00:00Z", version: 9 }), ls[1]!], p)).toBe(s);
  });
});

describe("where the check leaves the quote", () => {
  it("asks for a check when there's none, or the quote changed since", () => {
    expect(reviewStep(null, "s1")).toEqual({ step: "check", again: false });
    expect(reviewStep(review([]), "s2")).toEqual({ step: "check", again: true });
  });
  it("is clear with nothing found, and walks the open ones in turn", () => {
    expect(reviewStep(review([]), "s1")).toEqual({ step: "clear", kept: 0 });
    const r = review([finding({ id: "a" }), finding({ id: "b", kind: "look" })]);
    expect(reviewStep(r, "s1")).toMatchObject({ step: "walk", n: 1, of: 2, at: { id: "a" } });
    const one = answered(r, "a", 0, "") as QuoteReview;
    expect(reviewStep(one, "s1")).toMatchObject({ step: "walk", n: 2, at: { id: "b" } });
    const both = answered(one, "b", "keep", "") as QuoteReview;
    expect(reviewStep(both, "s1")).toEqual({ step: "fix", fixes: 1 });
    expect(reviewClear(both, "s1")).toBe(false);
    /* the fixes gone to Tiff: the quote changes under them, and it's checked again */
    expect(reviewStep(fixesSent(both), "s1")).toEqual({ step: "clear", kept: 1 });
  });
  it("won't keep a Doesn't match without a reason, and keeps a Worth a look without one", () => {
    const r = review([finding({ id: "a" }), finding({ id: "b", kind: "look" })]);
    expect(answered(r, "a", "keep", "  ")).toEqual({ error: "Say why it stays as written." });
    expect(answered(r, "b", "keep", "")).not.toHaveProperty("error");
    expect(answered(r, "a", 3, "")).toEqual({ error: "That isn't one of the fixes." });
    expect(answered(r, "zz", 0, "")).toEqual({ error: "That finding isn't on the check." });
    const kept = answered(r, "a", "keep", "Budget estimate") as QuoteReview;
    expect(reopened(kept, "a").findings[0]).toMatchObject({ state: "open", reason: "" });
  });
});

describe("the fixes and the qualifications", () => {
  it("asks Tiff for every fix in one message, and does a payment fix itself", () => {
    const r = review([
      finding({ id: "a", option: 1, state: "fix", picked: 0 }),
      finding({ id: "p", option: null, topic: "Payment terms", answers: [{ label: "Use Home, construction", fix: "op:payment:domestic_construction" }], state: "fix", picked: 0 }),
      finding({ id: "k", state: "kept", reason: "Budget only" }),
    ]);
    expect(fixesMessage(r)).toBe("From the check before it's marked ready to send, fix these:\n1) Option 2: Put the maker's cooling figures in the unit table.");
    expect(r.findings.map(paymentFixOf)).toEqual([null, "domestic_construction", null]);
    expect(fixesMessage(review([finding({ state: "kept", reason: "x" })]))).toBe("");
  });
  it("puts what's kept with a reason on the quote, and carries it to the next check", () => {
    const r = review([finding({ id: "k", topic: "Copper tees for CMY joints", kind: "look", state: "kept", reason: "Budget estimate; CMY joints on the firm price." }), finding({ id: "x", state: "kept", reason: "" })]);
    expect(qualificationsOf(r)).toEqual(["Copper tees for CMY joints: Budget estimate; CMY joints on the firm price."]);
    const next = carried(r, [finding({ id: "n1", topic: "copper tees for cmy joints" }), finding({ id: "n2", topic: "Labour hours" })]);
    expect(next.map((f) => f.id)).toEqual(["k", "x", "n2"]);
  });
  /* 3610 (Isaac, 27 November 2026: "I've done 3 rounds now"): what was fixed
     stays with the quote, asking nothing, and the next check is told */
  it("carries what was fixed to the next check without asking it again", () => {
    const r = review([finding({ id: "s", topic: "Trunking words", words: "Colorbond on the paper, metal on the lines.", state: "sent", picked: 0 }), finding({ id: "o", topic: "Hours", state: "open" })]);
    const next = carried(r, [finding({ id: "n", topic: "Drain length" })]);
    expect(next.map((f) => [f.id, f.state])).toEqual([["s", "sent"], ["n", "open"]]);
    expect(reviewStep({ ...r, findings: next }, r.stamp)).toEqual(expect.objectContaining({ step: "walk", n: 1, of: 1 }));
    const prompt = reviewPrompt({ business: "B", client: null, site: null, kept: [], fixed: next.filter((f) => f.state === "sent") });
    expect(prompt).toContain("fixed since");
    expect(prompt).toContain("- Trunking words: Colorbond on the paper, metal on the lines.");
  });
  it("reads a kept check back as it was, and nothing where there's none", () => {
    const r = review([finding({ id: "a", state: "fix", picked: 0 })]);
    expect(reviewOf(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(reviewOf(null)).toBeNull();
    expect(reviewOf({ findings: [] })).toBeNull();
  });
});

describe("the counted checks", () => {
  const labour = (id: string, name: string) => line(id, { kind: "labour", group: "Labour", name, unit: "h", qty: 16, visit: { stage: "install", people: 2, days: 1, tasks: [] } as unknown as QuoteLine["visit"] });
  it("asks about a home's payment terms on a builder's staged job", () => {
    const p = proposalOf({ payment: { preset: "domestic_small" } });
    const ls = [line("u"), labour("r", "Rough-in"), labour("i", "Install"), labour("f", "Fit-off")];
    const [pay] = ruleFindings({ lines: ls, proposal: p, client: "Hale Building", fits: [] });
    expect(pay).toMatchObject({ kind: "look", topic: "Payment terms", block: "payment", tab: "proposal" });
    expect(pay!.words).toMatch(/Hale Building is a builder, and the work runs over 3 visits/);
    expect(pay!.answers.map((a) => a.fix)).toEqual(["op:payment:domestic_construction", "op:payment:commercial"]);
    /* a home's one-visit job keeps its terms quietly */
    expect(ruleFindings({ lines: [line("u"), labour("i", "Install")], proposal: p, client: "Hale, J.", fits: [] })).toEqual([]);
  });
  it("asks about a part that doesn't fit, on its line", () => {
    const [f] = ruleFindings({ lines: [line("c", { name: "PAIRED COIL 1/4+1/2", kind: "material", unit: "m", qty: 21 })], proposal: null, client: null, fits: [{ key: "c", state: "misfit", why: "The outdoor connects 3/8 + 5/8" }] });
    expect(f).toMatchObject({ tab: "breakdown", lineIds: ["c"], put: "21 m", kind: "look" });
  });
});

describe("Tiff's read", () => {
  it("keeps her findings that point at real lines and blocks, and drops the rest", () => {
    const ls = [line("l1"), line("l2")];
    const read = parseReviewRead(
      {
        findings: [
          { kind: "mismatch", option: 0, topic: "Unit cooling figures", words: "Every unit is under.", put: "14 kW", tab: "proposal", block: "units-0", lineIds: ["l1", "nope"], answers: [{ label: "Use the maker's figures", fix: "Use them." }] },
          { kind: "look", option: -1, topic: "Static", words: "No static left.", put: "", tab: "breakdown", block: "made-up", lineIds: [], answers: [{ label: "Swap units", fix: "Swap to VMA." }] },
          { kind: "look", option: 0, topic: "Nothing to do", words: "Fine.", put: "", tab: "proposal", block: "", lineIds: [], answers: [] },
        ],
      },
      ls,
    );
    expect(read).toHaveLength(2);
    expect(read[0]).toMatchObject({ id: "t1", lineIds: ["l1"], block: "units-0", state: "open" });
    expect(read[1]).toMatchObject({ option: null, block: "" });
  });
});
