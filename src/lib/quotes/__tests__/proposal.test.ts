/* The proposal skeleton's gate, its checklist and its payment terms.

   The laws worth their tests: nothing a model hands back reaches the table
   without passing normaliseDraft (the numbering it adds is taken off, a key
   it invents is dropped, "known" with nothing known is an ask, a draft with
   no option is no draft); the checklist reads in the catalogue's order; and
   the payment presets add up to 100% at the suggested 10% deposit, and any
   other deposit is the business's to set. */

import { CHECKLIST, CHECKLIST_KEYS, orderChecklist } from "../checklist";
import { PAYMENT_PRESETS, SUGGESTED_DEPOSIT_PCT, suggestedDeposit } from "../payment";
import {
  MAX_OPTIONS,
  acceptedOptions,
  normaliseDraft,
  optionHeading,
  proposalTitle,
  type ProposalDraft,
} from "../proposal";

const base = (over: Record<string, unknown> = {}) => ({
  intro: "Hi Jane,",
  options: [{ name: "A", lines: ["x"] }],
  ...over,
});

describe("normaliseDraft", () => {
  it("fills every field from what the writer returns, and defaults the rest", () => {
    const d = normaliseDraft(
      base({
        why: "  VRF runs each room on its own.  ",
        options: [
          {
            name: "Option 1: Whole house VRF.",
            lines: ["- 2 x 15.5 kW outdoor units under the house."],
            units: [{ room: "Master bedroom", capacity: "7 kW", type: "High wall" }, { room: "", capacity: "", type: "" }],
            pros: [],
            cons: [],
          },
        ],
        pricing_mode: "optional",
        extras: [{ name: "Wi-Fi adaptor", detail: "Control it from your phone" }, { name: "", detail: "x" }],
        allowances: [{ name: "Ceiling grilles", detail: "$100 + GST per grille" }],
        notes: ["custom_grilles", "invented"],
      })
    )!;
    expect(d.why).toBe("VRF runs each room on its own.");
    expect(d.options[0]).toEqual({
      name: "Whole house VRF",
      lines: ["2 x 15.5 kW outdoor units under the house."],
      /* a row saved before roles were kept reads as an indoor unit */
      units: [{ role: "indoor", room: "Master bedroom", capacity: "7 kW", type: "High wall", model: "", qty: 1, system: 0, lps: null }],
      pros: [],
      cons: [],
      /* no price until the business sets one, no labour until it's given */
      priceCents: null,
      labour: null,
      suggestion: null,
    });
    expect(d.pricingMode).toBe("optional");
    expect(d.extras).toEqual([{ name: "Wi-Fi adaptor", detail: "Control it from your phone" }]);
    expect(d.allowances).toEqual([{ name: "Ceiling grilles", detail: "$100 + GST per grille" }]);
    /* a note key is checked for its shape; whether the business has such a
       note is the writer's and the quote face's to say (lib/templates) */
    expect(d.notes).toEqual(["custom_grilles", "invented"]);
    expect(d.payment).toEqual({ preset: "domestic_small", stages: PAYMENT_PRESETS.domestic_small.stages });
    expect(d.checklist).toEqual([]);
  });

  it("keeps itemised lines, with a quantity of 1 when none is said", () => {
    const d = normaliseDraft(base({ pricingMode: "itemised", items: [{ name: "Gyprock", qty: "" }, { name: "Wi-Fi adaptor", qty: "6" }] }))!;
    expect(d.pricingMode).toBe("itemised");
    expect(d.items).toEqual([
      { name: "Gyprock", qty: "1" },
      { name: "Wi-Fi adaptor", qty: "6" },
    ]);
  });

  it("orders the checklist by the catalogue, drops unknown and repeated keys, and asks what isn't known", () => {
    const d = normaliseDraft(
      base({
        checklist: [
          { key: "drain_to", state: "known", answer: "Downpipe" },
          { key: "made_up", state: "known", answer: "x" },
          { key: "model", state: "known", answer: "" },
          { key: "drain_to", state: "ask", answer: "" },
          { key: "approval", state: "na", answer: "Freestanding house" },
        ],
      })
    )!;
    expect(d.checklist).toEqual([
      { key: "model", state: "ask", answer: "", question: "", choices: [] },
      { key: "drain_to", state: "known", answer: "Downpipe" },
      { key: "approval", state: "na", answer: "Freestanding house" },
    ]);
  });

  /* Isaac's 2905, 2026-10-05: "questions are very vague, hard to understand" */
  it("keeps an ask's own question and answers, clears its fragment, and never asks crew and time", () => {
    const d = normaliseDraft(
      base({
        checklist: [
          {
            key: "pipe_route",
            state: "ask",
            answer: "Riser route between levels",
            question: `How do the pipes get from the garage up to Level 3? ${"x".repeat(300)}`,
            choices: ["Riser cupboard", "riser cupboard", "Inside the walls", "Outside in trunking", "Ceiling space", "Under the floor"],
            rank: 2,
          },
          { key: "model", state: "known", answer: "PUMY-P200YKMD2-A", question: "Confirm?", choices: ["a"], rank: 1 },
          { key: "labour", state: "ask", answer: "", question: "How many people?", choices: [], rank: 1 },
        ],
      })
    )!;
    const route = d.checklist.find((i) => i.key === "pipe_route")!;
    expect(route.answer).toBe("");
    expect(route.question?.length).toBe(200);
    expect(route.choices).toEqual(["Riser cupboard", "Inside the walls", "Outside in trunking", "Ceiling space"]);
    expect(route.rank).toBe(2);
    /* a settled topic keeps its question for its Change, never a rank; crew and time are never asked */
    expect(d.checklist.find((i) => i.key === "model")).toEqual({ key: "model", state: "known", answer: "PUMY-P200YKMD2-A", question: "Confirm?", choices: ["a"] });
    expect(d.checklist.find((i) => i.key === "labour")).toBeUndefined();
    /* a read or a person's save keeps every question: only Tiff's fresh reply is cut */
    const many = normaliseDraft(base({ checklist: CHECKLIST_KEYS.filter((k) => k !== "labour").map((key) => ({ key, state: "ask", answer: "" })) }))!;
    expect(many.checklist.filter((i) => i.state === "ask")).toHaveLength(CHECKLIST_KEYS.length - 1);
    /* a rank that isn't Tiff's is left off */
    expect(many.checklist.every((i) => i.rank === undefined)).toBe(true);
  });

  it("keeps a person's answer marked fresh until the scope is rewritten with it", () => {
    const d = normaliseDraft(base({ checklist: [{ key: "pipe_colour", state: "known", answer: "Paperbark", fresh: true }] }))!;
    expect(d.checklist[0]).toEqual({ key: "pipe_colour", state: "known", answer: "Paperbark", fresh: true });
  });

  it("keeps a person's payment stages, clamped to whole percents", () => {
    const d = normaliseDraft(
      base({ payment: { preset: "domestic_construction", stages: [{ when: "Deposit, on accepting", percent: 10.4 }, { when: "Balance", percent: 150 }] } })
    )!;
    expect(d.payment).toEqual({
      preset: "domestic_construction",
      stages: [
        { when: "Deposit, on accepting", percent: 10 },
        { when: "Balance", percent: 100 },
      ],
    });
  });

  it("is no draft without an option, and caps the options", () => {
    expect(normaliseDraft({ intro: "Hi", options: [] })).toBeNull();
    expect(normaliseDraft({ intro: "Hi", options: [{ name: "", lines: [] }] })).toBeNull();
    expect(normaliseDraft("not a draft")).toBeNull();
    const many = normaliseDraft(base({ options: Array.from({ length: 9 }, (_, i) => ({ name: `O${i}`, lines: ["x"] })) }));
    expect(many?.options).toHaveLength(MAX_OPTIONS);
  });
});

describe("the checklist catalogue", () => {
  it("asks every job the same topics in the same order", () => {
    const shuffled = [...CHECKLIST_KEYS].reverse().map((key) => ({ key, state: "ask" as const, answer: "" }));
    expect(orderChecklist(shuffled).map((i) => i.key)).toEqual(CHECKLIST_KEYS);
  });

  it("offers custom and powder-coated grilles", () => {
    expect(CHECKLIST.grille_finish.choices).toEqual(
      expect.arrayContaining(["Powder coated to suit", "Custom made"])
    );
  });
});

describe("payment terms", () => {

  it("takes any deposit, says the suggested one beside it, and says when the stages don't add up", () => {
    const stages = [
      { when: "Deposit, on accepting", percent: 30 },
      { when: "Progress", percent: 30 },
      { when: "Balance", percent: 30 },
    ];
    expect(suggestedDeposit("domestic_construction", stages)).toBe(SUGGESTED_DEPOSIT_PCT);
    expect(suggestedDeposit("commercial", stages)).toBeNull();
    expect(suggestedDeposit("domestic_small", [{ when: "Balance on finishing", percent: 100 }])).toBeNull();
  });
});

describe("the words around the fields", () => {
  const two = (mode: ProposalDraft["pricingMode"]) =>
    normaliseDraft(base({ pricingMode: mode, options: [{ name: "Downstairs", lines: ["x"] }, { name: "Upstairs", lines: ["y"] }] }))!;

  it("builds one title pattern from the address, without state and postcode", () => {
    expect(proposalTitle("37 Taleeban Rd\nRiverview NSW 2066")).toBe("Air Conditioning Scope – 37 Taleeban Rd, Riverview");
    expect(proposalTitle(null)).toBe("Air Conditioning Scope");
  });

  it("numbers options the client picks from, and names areas they tick", () => {
    expect(optionHeading(two("multiple_choice"), 1)).toBe("Option 2: Upstairs");
    expect(optionHeading(two("optional"), 1)).toBe("Upstairs");
  });
});

describe("the equipment rows", () => {
  const vrf = () =>
    normaliseDraft(
      base({
        options: [
          {
            name: "VRF",
            lines: ["x"],
            units: [
              { role: "outdoor", room: "Side of the house", capacity: "15.5 kW", type: "Outdoor unit", model: "(pumy-p140ykm)", qty: 1, system: 7, lps: null },
              { role: "indoor", room: "Kitchen", capacity: "7.1 kW", type: "Ducted", model: "PEAD-M71JAA", qty: 1, system: 1, lps: 30 },
              { role: "indoor", room: "Bed 2", capacity: "2.2 kW", type: "High wall", model: "", qty: 2, system: 9, lps: null },
              { role: "fan", room: "Bathroom", capacity: "1 kW", type: "In-line fan", model: "SJMF100", qty: 1, system: 3, lps: "67" },
              { role: "outdoor", room: "", capacity: "", type: "", model: "", qty: 0, system: 0, lps: null },
            ],
          },
        ],
      })
    )!.options[0].units;

  it("numbers outdoors in order, points every indoor at one that exists, and keeps a fan's airflow only on a fan", () => {
    const u = vrf();
    expect(u.map((r) => [r.role, r.system])).toEqual([
      ["outdoor", 1],
      ["indoor", 1],
      ["indoor", 1],
      ["fan", 0],
    ]);
    expect(u[0].model).toBe("PUMY-P140YKM");
    expect(u[1].lps).toBeNull();
    expect(u[3]).toMatchObject({ capacity: "", lps: 67 });
    expect(u[2].qty).toBe(2);
  });
});

describe("the accepted option", () => {
  const two = (mode: string) => normaliseDraft(base({ pricing_mode: mode, options: [{ name: "A", lines: ["x"] }, { name: "B", lines: ["y"] }] }))!;

  it("is the only option when there is one, and nothing when several are unmarked", () => {
    expect(acceptedOptions(normaliseDraft(base())!).map((o) => o.name)).toEqual(["A"]);
    expect(acceptedOptions(two("multiple_choice"))).toEqual([]);
    expect(acceptedOptions({ ...two("multiple_choice"), accepted: [1] }).map((o) => o.name)).toEqual(["B"]);
    /* a client who picks one has accepted one, and only an option there is */
    expect(normaliseDraft({ ...base({ options: [{ name: "A", lines: ["x"] }, { name: "B", lines: ["y"] }] }), accepted: [1, 0, 9] })!.accepted).toEqual([0]);
  });
});

describe("an option's price", () => {
  it("is the business's own, kept in cents ex GST — never zero, never past a typo's ceiling", () => {
    const opt = (priceCents: unknown) => normaliseDraft({ options: [{ name: "Split", lines: ["x"], priceCents }] })!.options[0]!.priceCents;
    expect(opt(512_345)).toBe(512_345);
    expect(opt(0)).toBeNull();
    expect(opt(-5)).toBeNull();
    expect(opt("500")).toBeNull();
    expect(opt(5e12)).toBe(1_000_000_000);
  });
});
