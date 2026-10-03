/* The proposal skeleton's gate, its checklist and its payment terms.

   The laws worth their tests: nothing a model hands back reaches the table
   without passing normaliseDraft (the numbering it adds is taken off, a key
   it invents is dropped, "known" with nothing known is an ask, a draft with
   no option is no draft); the checklist reads in the catalogue's order; and
   the payment presets follow the NSW rules (a home deposit no more than
   10%, stages that add up to 100%). */

import { CHECKLIST, CHECKLIST_KEYS, orderChecklist } from "../checklist";
import { PAYMENT_PRESETS, paymentProblems } from "../payment";
import {
  MAX_OPTIONS,
  acceptedAfterRemoving,
  acceptedOptions,
  blankUnit,
  normaliseDraft,
  optionHeading,
  proposalTitle,
  removeUnit,
  setUnitRole,
  toggleAccepted,
  unitPlace,
  unitWords,
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
      { key: "model", state: "ask", answer: "" },
      { key: "drain_to", state: "known", answer: "Downpipe" },
      { key: "approval", state: "na", answer: "Freestanding house" },
    ]);
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
  it("each preset adds up, and holds the home deposit cap", () => {
    for (const k of ["domestic_small", "domestic_construction"] as const) {
      expect(paymentProblems(k, PAYMENT_PRESETS[k].stages)).toEqual([]);
    }
    expect(paymentProblems("commercial", PAYMENT_PRESETS.commercial.stages)).toEqual([]);
  });

  it("says when a home deposit is over 10% or the stages don't add up", () => {
    expect(
      paymentProblems("domestic_construction", [
        { when: "Deposit, on accepting", percent: 30 },
        { when: "Progress", percent: 30 },
        { when: "Balance", percent: 30 },
      ])
    ).toEqual(["A deposit on a home job can't be more than 10%.", "The stages add up to 90%, not 100%."]);
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

  it("says each row as the card shows it, and never fills in a model that wasn't given", () => {
    const u = vrf();
    expect(unitPlace(u[0])).toBe("Outdoor unit 1, side of the house");
    expect(unitWords(u[0])).toBe("15.5 kW, Outdoor unit, PUMY-P140YKM");
    expect(unitWords(u[2])).toBe("2 x 2.2 kW, High wall");
    expect(unitWords(u[3])).toBe("In-line fan, SJMF100, 67 L/s");
  });

  it("keeps an indoor unit on its own outdoor when an earlier outdoor is removed", () => {
    const rows = [blankUnit("outdoor", 0), blankUnit("outdoor", 1), { ...blankUnit("indoor", 2), room: "Study" }];
    expect(rows[2].system).toBe(2);
    expect(removeUnit(rows, 0).map((r) => [r.role, r.system])).toEqual([
      ["outdoor", 1],
      ["indoor", 1],
    ]);
  });

  it("keeps every indoor unit on its own outdoor when a row changes kind", () => {
    const rows = [blankUnit("outdoor", 0), blankUnit("outdoor", 1), blankUnit("outdoor", 2), { ...blankUnit("indoor", 3), room: "Study" }];
    expect(rows[3].system).toBe(3);
    /* outdoor 2 becomes an indoor unit: the study stays on the old outdoor 3, now numbered 2 */
    const fewer = setUnitRole(rows, 1, "indoor");
    expect(fewer.map((r) => [r.role, r.system])).toEqual([
      ["outdoor", 1],
      ["indoor", 1],
      ["outdoor", 2],
      ["indoor", 2],
    ]);
    /* and back: a new outdoor above moves the units below it with their own */
    expect(setUnitRole(fewer, 1, "outdoor").map((r) => [r.role, r.system])).toEqual([
      ["outdoor", 1],
      ["outdoor", 2],
      ["outdoor", 3],
      ["indoor", 3],
    ]);
    /* a fan runs from no outdoor, and its airflow goes when it stops being one */
    expect(setUnitRole([{ ...blankUnit("fan", 0), lps: 40 }], 0, "indoor")[0]).toMatchObject({ role: "indoor", system: 0, lps: null });
  });

  it("puts an indoor unit whose outdoor is removed under the nearest outdoor above it", () => {
    const rows = [blankUnit("outdoor", 0), blankUnit("outdoor", 1), { ...blankUnit("indoor", 2), room: "Study" }];
    expect(removeUnit(rows, 1).map((r) => [r.role, r.system])).toEqual([
      ["outdoor", 1],
      ["indoor", 1],
    ]);
  });
});

describe("the accepted option", () => {
  const two = (mode: string) => normaliseDraft(base({ pricing_mode: mode, options: [{ name: "A", lines: ["x"] }, { name: "B", lines: ["y"] }] }))!;

  it("is one option when the client picks one, and any number when they tick the ones they want", () => {
    const pick = two("multiple_choice");
    expect(toggleAccepted({ ...pick, accepted: [0] }, 1)).toEqual([1]);
    const tick = two("optional");
    expect(toggleAccepted({ ...tick, accepted: [1] }, 0)).toEqual([0, 1]);
    expect(normaliseDraft({ ...base({ options: [{ name: "A", lines: ["x"] }, { name: "B", lines: ["y"] }] }), accepted: [1, 0, 9] })!.accepted).toEqual([0]);
  });

  it("is the only option when there is one, and nothing when several are unmarked", () => {
    expect(acceptedOptions(normaliseDraft(base())!).map((o) => o.name)).toEqual(["A"]);
    expect(acceptedOptions(two("multiple_choice"))).toEqual([]);
    expect(acceptedOptions({ ...two("multiple_choice"), accepted: [1] }).map((o) => o.name)).toEqual(["B"]);
  });

  it("follows its option when an earlier one is removed", () => {
    expect(acceptedAfterRemoving([0, 2], 1)).toEqual([0, 1]);
    expect(acceptedAfterRemoving([1], 1)).toEqual([]);
  });
});
