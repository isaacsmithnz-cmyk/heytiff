/* One list of units: how a quote's unit lines join a design's units, and
   what Tiff asks where they don't (design-units.ts). The shapes are 3406's
   and 3423's, the names made up. */
import type { DesignDocument } from "@/lib/studio/document";
import { answersOf, designRowOf, joinOf, questionWords, quoteGroups, readJoin, roomWordsOf, type Book, type UnitLine } from "../design-units";

const book: Book = {
  idu: ["PEFY-P20VMX-E", "PEFY-P25VMX-E", "PEFY-P32VMX-E", "PEFY-P40VMX-E", "PEFY-P15VMX-E", "PEFY-P63VMX-E", "PEFY-P71VMA-E4", "MSZ-AP42VGD2", "MSZ-AP25VGD2", "MSZ-AP50VGD2", "PEA-M125HAA"],
  odu: ["PUMY-SP80VKMD2-A", "PUMY-SP140VKMD2-A", "PUMY-P200YKMD2-A", "MUZ-AP42VG2", "PUZ-M125VKA2-A", "MXZ-4F80VGD"],
  oduType: { "PUMY-SP80VKMD2-A": "vrf", "PUMY-SP140VKMD2-A": "vrf", "PUMY-P200YKMD2-A": "vrf", "MUZ-AP42VG2": "split", "PUZ-M125VKA2-A": "split", "MXZ-4F80VGD": "multi" },
};

type A = { id: string; role: "idu" | "odu"; model: string; roomId: string | null; serves?: "zone" | "system" };
function doc(systems: { id: string; name: string; type: string; allocations: A[] }[], rooms: Record<string, string>): DesignDocument {
  return {
    id: "dsn_1",
    meta: { name: "House" },
    systems: systems.map((s) => ({ id: s.id, type: s.type, brand: "mitsubishi-electric", colour: "", name: s.name, settings: { allocations: s.allocations } })),
    objects: Object.entries(rooms).map(([id, name]) => ({ id, type: "room", props: { name } })),
  } as unknown as DesignDocument;
}

let n = 0;
const line = (system: string, name: string, code: string | null, qty = 1, optionIndex = 0): UnitLine => ({
  id: `l${++n}`,
  optionIndex,
  system,
  name,
  code,
  qty,
  costCents: 100000,
  sellCents: null,
  design: null,
});

describe("units join on their own when they're the same", () => {
  /* 3423's shape: the same outdoors and heads, one bedroom a size apart */
  const d = doc(
    [
      {
        id: "s1",
        name: "System 1",
        type: "vrf",
        allocations: [
          { id: "o1", role: "odu", model: "PUMY-SP140VKMD2-A", roomId: null },
          { id: "h1", role: "idu", model: "PEFY-P20VMX-E", roomId: "rMa" },
          { id: "h2", role: "idu", model: "PEFY-P20VMX-E", roomId: "rMb" },
          { id: "h3", role: "idu", model: "PEFY-P20VMX-E", roomId: "rSt" },
          { id: "h4", role: "idu", model: "PEFY-P15VMX-E", roomId: "rBd" },
        ],
      },
      {
        id: "s2",
        name: "System 2",
        type: "vrf",
        allocations: [
          { id: "o2", role: "odu", model: "PUMY-P200YKMD2-A", roomId: null },
          { id: "h5", role: "idu", model: "PEFY-P63VMX-E", roomId: "rLd" },
          { id: "h6", role: "idu", model: "PEFY-P63VMX-E", roomId: "rLd" },
          { id: "h7", role: "idu", model: "PEFY-P71VMA-E4", roomId: "rRu" },
        ],
      },
    ],
    { rMa: "Master Bedroom A", rMb: "Master Bedroom B", rSt: "Study", rBd: "Bedroom", rLd: "Living / Dining", rRu: "Rumpus" }
  );
  const lines = [
    line("System 1", "Outdoor unit", "PUMY-SP140VKMD2-A"),
    line("System 1", "Indoor unit, Master Bedroom A", "PEFY-P20VMX-E1"),
    line("System 1", "Indoor unit, Master Bedroom B", "PEFY-P20VMX-E1"),
    line("System 1", "Indoor unit, Study", "PEFY-P20VMX-E1"),
    line("System 1", "Indoor unit, Bedroom", "PEFY-P20VMX-E1"),
    line("System 2", "Outdoor unit", "PUMY-P200YKMD2-A"),
    line("System 2", "Indoor unit, Living / Dining", "PEFY-P63VMX-E1", 2),
    line("System 2", "Indoor unit, Rumpus", "PEFY-P71VMA-E4"),
  ];
  const r = readJoin({ doc: d, lines, accepted: [], book })!;

  test("the same model in the room the line names joins", () => {
    expect(r.lines[lines[1]!.id]).toEqual({ from: "design", units: ["h1"] });
    expect(r.lines[lines[3]!.id]).toEqual({ from: "design", units: ["h3"] });
    expect(r.lines[lines[6]!.id]).toEqual({ from: "design", units: ["h5", "h6"] });
    expect(r.lines[lines[0]!.id]).toEqual({ from: "design", units: ["o1"] });
  });

  test("the one that differs is asked, as the system's units", () => {
    expect(r.questions).toHaveLength(1);
    const q = r.questions[0]!;
    expect(q.kind).toBe("heads");
    if (q.kind !== "heads") return;
    expect(q.design.map((u) => u.id)).toEqual(["h4"]);
    expect(q.quote.map((h) => h.lineId)).toEqual([lines[4]!.id]);
    expect(questionWords(q).ask).toBe("System 1's units: the design's one or the quote's one?");
    expect(questionWords(q).put).toBe("Bedroom P20. In the design: Bedroom P15.");
  });

  test("the joins found are kept with what each side said", () => {
    const found = r.found.find((f) => f.lineId === lines[1]!.id)!;
    expect(found.join).toEqual({ design: "dsn_1", units: ["h1"], model: "PEFY-P20VMX-E", code: "PEFY-P20VMX-E1" });
  });

  test("the same room a size apart: the design's swaps the line, the quote's waits for the Studio to swap the unit", () => {
    const q = r.questions[0]!;
    const [design, quote] = answersOf("dsn_1", q, book);
    expect(design!.label).toBe("The design's one");
    expect(design!.steps).toEqual([{ step: "swap", lineId: lines[4]!.id, model: "PEFY-P15VMX-E", join: { design: "dsn_1", units: ["h4"], model: "PEFY-P15VMX-E", code: null } }]);
    expect(quote!.label).toBe("The quote's one");
    expect(quote!.steps).toEqual([
      { step: "join", lineId: lines[4]!.id, join: { design: "dsn_1", units: ["h4"], take: "PEFY-P20VMX-E", system: "s1", room: "Bedroom", code: "PEFY-P20VMX-E1" } },
    ]);
  });

  test("with every line answered the row says it's the same", () => {
    const joined = lines.map((l) => ({ ...l, design: r.found.find((f) => f.lineId === l.id)?.join ?? null }));
    /* the quote's answer: the line waits for the Studio to make the Bedroom's P15 a P20 */
    joined[4] = { ...joined[4]!, design: { design: "dsn_1", units: ["h4"], take: "PEFY-P20VMX-E", system: "s1", room: "Bedroom", code: "PEFY-P20VMX-E1" } };
    const again = readJoin({ doc: d, lines: joined, accepted: [], book })!;
    expect(again.questions).toEqual([]);
    expect(designRowOf(again)).toEqual({ words: "1 for the Studio", tone: "due" });
    expect(again.found).toEqual([]);

    /* the Studio takes it: the Bedroom's unit a P20; the line joins it */
    const took = doc(
      [
        {
          id: "s1",
          name: "System 1",
          type: "vrf",
          allocations: [
            { id: "o1", role: "odu", model: "PUMY-SP140VKMD2-A", roomId: null },
            { id: "h1", role: "idu", model: "PEFY-P20VMX-E", roomId: "rMa" },
            { id: "h2", role: "idu", model: "PEFY-P20VMX-E", roomId: "rMb" },
            { id: "h3", role: "idu", model: "PEFY-P20VMX-E", roomId: "rSt" },
            { id: "h4", role: "idu", model: "PEFY-P20VMX-E", roomId: "rBd" },
          ],
        },
        {
          id: "s2",
          name: "System 2",
          type: "vrf",
          allocations: [
            { id: "o2", role: "odu", model: "PUMY-P200YKMD2-A", roomId: null },
            { id: "h5", role: "idu", model: "PEFY-P63VMX-E", roomId: "rLd" },
            { id: "h6", role: "idu", model: "PEFY-P63VMX-E", roomId: "rLd" },
            { id: "h7", role: "idu", model: "PEFY-P71VMA-E4", roomId: "rRu" },
          ],
        },
      ],
      { rMa: "Master Bedroom A", rMb: "Master Bedroom B", rSt: "Study", rBd: "Bedroom", rLd: "Living / Dining", rRu: "Rumpus" }
    );
    const settled = readJoin({ doc: took, lines: joined, accepted: [], book })!;
    expect(settled.lines[lines[4]!.id]).toEqual({ from: "design", units: ["h4"] });
    expect(settled.found.find((f) => f.lineId === lines[4]!.id)?.join).toEqual({ design: "dsn_1", units: ["h4"], model: "PEFY-P20VMX-E", code: "PEFY-P20VMX-E1" });
    expect(designRowOf(settled)).toEqual({ words: "Same as the quote", tone: "good" });
  });
});

describe("3406's shape: a quote and a design made apart", () => {
  const d = doc(
    [
      {
        id: "sV",
        name: "System 2",
        type: "vrf",
        allocations: [
          { id: "hM", role: "idu", model: "PEFY-P40VMX-E", roomId: "rM" },
          { id: "oV", role: "odu", model: "PUMY-SP80VKMD2-A", roomId: null },
          { id: "hB", role: "idu", model: "PEFY-P20VMX-E", roomId: "rB" },
          { id: "hS", role: "idu", model: "PEFY-P20VMX-E", roomId: "rS" },
        ],
      },
      { id: "sD", name: "Dining/Living 12kw Ducted", type: "split", allocations: [] },
      {
        id: "sG",
        name: "Granny Flat",
        type: "split",
        allocations: [
          { id: "hG", role: "idu", model: "MSZ-AP42VGD2", roomId: "rG" },
          { id: "oG", role: "odu", model: "MUZ-AP42VG2", roomId: null },
        ],
      },
    ],
    { rM: "Master Bedroom", rB: "Bedroom 4", rS: "Study", rG: "Granny Flat", rW: "Master WIR", rL: "Living" }
  );
  const lines = [
    line("Ground floor, underfloor ducted", "Mitsubishi Electric 14 kW underfloor ducted, floor registers, kickplate grilles, return", null),
    line("First floor front, zoned ducted", "Ducted indoor 12.5 kW", "PEA-M125HAA"),
    line("First floor front, zoned ducted", "Outdoor 12.5 kW, single phase", "PUZ-M125VKA2-A"),
    line("First floor rear, VRF to the master suite", "VRF outdoor 9 kW", "PUMY-SP80VKMD3-A"),
    line("First floor rear, VRF to the master suite", "Concealed ducted 3.6 kW, Master Bedroom", "PEFY-P32VMX-E1"),
    line("First floor rear, VRF to the master suite", "Concealed ducted 2.8 kW, Master WIR", "PEFY-P25VMX-E1"),
    line("Studio", "Mitsubishi Electric high wall split, installed", null),
  ];
  const r = readJoin({ doc: d, lines, accepted: [], book })!;

  test("nothing joins on its own", () => {
    expect(r.found).toEqual([]);
    expect(Object.values(r.lines).every((s) => s === null)).toBe(true);
  });

  test("each quote system is asked against the design's that's most like it", () => {
    const asks = r.questions.map((q) => questionWords(q).ask);
    expect(asks).toEqual([
      "The quote's Ground floor, underfloor ducted isn't in the design.",
      "Is the quote's First floor front, zoned ducted the design's Dining/Living 12kw Ducted?",
      "Is the quote's First floor rear, VRF to the master suite the design's System 2?",
      "Is the quote's Studio the design's Granny Flat?",
    ]);
  });

  test("the quote's only, with no model, can only stay the quote's", () => {
    const q = r.questions[0]!;
    expect(answersOf("dsn_1", q, book).map((a) => a.label)).toEqual(["Quote only"]);
  });

  test("a design system with no units takes the quote's when they're the same", () => {
    const q = r.questions[1]!;
    const [yes, no] = answersOf("dsn_1", q, book);
    expect(yes!.steps).toEqual([
      { step: "join", lineId: lines[1]!.id, join: { design: "dsn_1", units: [], take: "PEA-M125HAA", system: "sD", room: "", code: "PEA-M125HAA" } },
      { step: "join", lineId: lines[2]!.id, join: { design: "dsn_1", units: [], take: "PUZ-M125VKA2-A", system: "sD", room: "", code: "PUZ-M125VKA2-A" } },
    ]);
    expect(no!.label).toBe("No, they're two systems");
  });

  test("Yes prices the design's units in place of the quote's; No adds the design's beside them", () => {
    const q = r.questions[3]!;
    const [yes, no] = answersOf("dsn_1", q, book);
    expect(yes!.steps.map((s) => s.step)).toEqual(["remove", "add", "add"]);
    expect(no!.steps.map((s) => s.step)).toEqual(["add", "add"]);
    expect(questionWords(q, () => "$3,890.00").put).toBe("Studio, Mitsubishi Electric high wall split, installed, no model, $3,890.00. In the design: Granny Flat, MSZ-AP42VGD2 and MUZ-AP42VG2.");
  });

  test("once the VRF is said to be the design's, its outdoor and its heads are asked", () => {
    const q = r.questions[2]!;
    const [yes] = answersOf("dsn_1", q, book);
    expect(yes!.steps.every((s) => s.step === "join")).toBe(true);
    const joins = new Map(yes!.steps.map((s) => (s.step === "join" ? [s.lineId, s.join] : ["", null])));
    const paired = lines.map((l) => ({ ...l, design: joins.get(l.id) ?? null }));
    const again = readJoin({ doc: d, lines: paired, accepted: [], book })!;
    const words = again.questions.map((x) => questionWords(x));
    expect(words.map((w) => w.ask)).toEqual([
      "The quote's Ground floor, underfloor ducted isn't in the design.",
      "Is the quote's First floor front, zoned ducted the design's Dining/Living 12kw Ducted?",
      "System 2's outdoor: the design's or the quote's?",
      "System 2's units: the design's three or the quote's two?",
      "Is the quote's Studio the design's Granny Flat?",
    ]);
    expect(words[3]!.put).toBe("Master Bedroom P32 and Master WIR P25. In the design: Master Bedroom P40, Bedroom 4 P20 and Study P20.");
    const outdoor = again.questions[2]!;
    /* the quote's VKMD3 isn't in the book: only the design's can go in */
    expect(answersOf("dsn_1", outdoor, book).map((a) => a.label)).toEqual(["The design's PUMY-SP80VKMD2-A"]);
    const heads = again.questions[3]!;
    expect(answersOf("dsn_1", heads, book).map((a) => a.label)).toEqual(["The design's three", "The quote's two"]);
  });
});

describe("reading the quote's systems", () => {
  test("heads kept under rooms' names go with the one outdoor beside them", () => {
    const ls = [line("", "Outdoor unit", "MXZ-4F80VGD-A2"), line("Living", "Indoor unit, Living", "MSZ-AP50VGKD2-A2"), line("Bed 2", "Indoor unit, Bed 2", "MSZ-AP25VGKD2-A2")];
    const gs = quoteGroups(ls, book);
    expect(gs).toHaveLength(1);
    expect(gs[0]!.byRoom).toBe(true);
    expect(roomWordsOf(ls[1]!, true)).toBe("Living");
  });

  test("the room is the words after the last comma, not a phase", () => {
    expect(roomWordsOf({ name: "Concealed ducted 3.6 kW, Master Bedroom", system: "" })).toBe("Master Bedroom");
    expect(roomWordsOf({ name: "Outdoor 12.5 kW, single phase", system: "" })).toBe("");
    expect(roomWordsOf({ name: "Bulkhead 5.6 kW, Living + Kitchen x 2", system: "" })).toBe("Living + Kitchen");
  });

  test("a stored join is made safe", () => {
    expect(joinOf(null)).toBeNull();
    expect(joinOf({ units: ["a"] })).toBeNull();
    expect(joinOf({ design: "d", units: ["a", "a", 3], only: true })).toEqual({ design: "d", units: ["a"], only: true });
  });
});

describe("whose change it was, once they're joined", () => {
  const vrf = (master: string, extra = true) =>
    doc(
      [
        {
          id: "sV",
          name: "First floor rear",
          type: "vrf",
          allocations: [
            { id: "oV", role: "odu", model: "PUMY-SP80VKMD2-A", roomId: null },
            { id: "hM", role: "idu", model: master, roomId: "rM" },
            ...(extra ? [{ id: "hS", role: "idu" as const, model: "PEFY-P20VMX-E", roomId: "rS" }] : []),
          ],
        },
      ],
      { rM: "Master Bedroom", rS: "Study" }
    );
  const joined = (id: string, units: string[], model: string, code: string): UnitLine["design"] => ({ design: "dsn_1", units, model, code });
  const ls = (masterCode: string, at = "2026-11-27T10:00:00Z"): UnitLine[] => [
    { ...line("First floor rear", "VRF outdoor", "PUMY-SP80VKMD2-A"), id: "o", design: joined("o", ["oV"], "PUMY-SP80VKMD2-A", "PUMY-SP80VKMD2-A") },
    { ...line("First floor rear", "Concealed ducted, Master Bedroom", masterCode), id: "m", updatedAt: at, design: joined("m", ["hM"], "PEFY-P32VMX-E", "PEFY-P32VMX-E1") },
    { ...line("First floor rear", "Concealed ducted, Study", "PEFY-P20VMX-E1"), id: "s", design: joined("s", ["hS"], "PEFY-P20VMX-E", "PEFY-P20VMX-E1") },
  ];

  test("the design's: the quote follows, until it's sent", () => {
    const r = readJoin({ doc: vrf("PEFY-P40VMX-E"), lines: ls("PEFY-P32VMX-E1"), accepted: [], book })!;
    expect(r.follow).toEqual([{ kind: "model", lineId: "m", units: ["hM"], model: "PEFY-P40VMX-E", was: "PEFY-P32VMX-E" }]);
    expect(r.lines.m).toEqual({ from: "design", units: ["hM"], now: "PEFY-P40VMX-E" });
    expect(r.questions).toEqual([]);
    expect(designRowOf(r, true)).toEqual({ words: "1 change since sent", tone: "due" });
  });

  test("the quote's: the design takes it when the Studio next opens", () => {
    const r = readJoin({ doc: vrf("PEFY-P32VMX-E"), lines: ls("PEFY-P25VMX-E1"), accepted: [], book })!;
    expect(r.follow).toEqual([]);
    expect(r.lines.m).toEqual({ from: "waiting" });
    expect(r.found).toEqual([{ lineId: "m", join: { design: "dsn_1", units: ["hM"], model: "PEFY-P32VMX-E", code: "PEFY-P32VMX-E1", take: "PEFY-P25VMX-E" } }]);
  });

  test("both to the same model: agreed again", () => {
    const r = readJoin({ doc: vrf("PEFY-P40VMX-E"), lines: ls("PEFY-P40VMX-E1"), accepted: [], book })!;
    expect(r.follow).toEqual([]);
    expect(r.found).toEqual([{ lineId: "m", join: { design: "dsn_1", units: ["hM"], model: "PEFY-P40VMX-E", code: "PEFY-P40VMX-E1" } }]);
  });

  test("both apart: the later change wins", () => {
    const quoteLater = readJoin({ doc: vrf("PEFY-P40VMX-E"), lines: ls("PEFY-P25VMX-E1", "2026-11-27T11:00:00Z"), accepted: [], book, designAt: "2026-11-27T10:30:00Z" })!;
    expect(quoteLater.lines.m).toEqual({ from: "waiting" });
    const designLater = readJoin({ doc: vrf("PEFY-P40VMX-E"), lines: ls("PEFY-P25VMX-E1", "2026-11-27T10:00:00Z"), accepted: [], book, designAt: "2026-11-27T10:30:00Z" })!;
    expect(designLater.follow.map((f) => f.kind)).toEqual(["model"]);
  });

  test("a unit the design took out: the line counts what's left", () => {
    const r = readJoin({ doc: vrf("PEFY-P32VMX-E", false), lines: ls("PEFY-P32VMX-E1"), accepted: [], book })!;
    expect(r.follow).toEqual([{ kind: "gone", lineId: "s", units: [], left: 0 }]);
    expect(r.lines.s).toEqual({ from: "design", units: [], gone: 1 });
    expect(r.questions).toEqual([]);
  });
});
