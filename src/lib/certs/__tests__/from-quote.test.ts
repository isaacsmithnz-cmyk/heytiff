/* A job quoted in HeyTiff: the accepted option's equipment rows become the
   certificate's systems and fans one for one, models and all, with nothing
   read out of a sentence. */

import { normaliseDraft, acceptedOptions } from "@/lib/quotes/proposal";
import { readingFromQuote, quoteHasEquipment } from "../from-quote";

const draft = normaliseDraft({
  intro: "Hi,",
  pricing_mode: "multiple_choice",
  accepted: [1],
  options: [
    { name: "Two splits", lines: ["x"], units: [{ role: "indoor", room: "Lounge", capacity: "7.1 kW", type: "High wall", model: "WRONG-1", qty: 1, system: 0, lps: null }] },
    {
      name: "VRF",
      lines: ["Installation of a 15.5 kW Mitsubishi Electric VRF, R32.", "Ducted kitchen unit with plenums and a linear grille."],
      units: [
        { role: "outdoor", room: "Side of the house", capacity: "15.5 kW", type: "Outdoor unit", model: "PUMY-P140YKM", qty: 1, system: 1, lps: null },
        { role: "indoor", room: "Kitchen", capacity: "7.1 kW", type: "Ducted", model: "PEAD-M71JAA", qty: 1, system: 1, lps: null },
        { role: "indoor", room: "Bedrooms", capacity: "2.2 kW", type: "High wall", model: "MSZ-AP22VG", qty: 3, system: 1, lps: null },
        { role: "fan", room: "Bathroom", capacity: "", type: "In-line fan", model: "SJMF100", qty: 2, system: 0, lps: 67 },
      ],
    },
  ],
})!;

describe("the accepted quote's equipment", () => {
  it("takes the accepted option only, one system per outdoor unit with its own indoor units", () => {
    const r = readingFromQuote(acceptedOptions(draft));
    expect(r.systems).toHaveLength(1);
    expect(r.systems[0].outdoor).toMatchObject({ location: "Side of the house", model: "PUMY-P140YKM", capacityKw: 15.5 });
    expect(r.systems[0].indoors.map((i) => [i.location, i.model, i.qty, i.capacityKw])).toEqual([
      ["Kitchen", "PEAD-M71JAA", 1, 7.1],
      ["Bedrooms", "MSZ-AP22VG", 3, 2.2],
    ]);
    expect(JSON.stringify(r)).not.toContain("WRONG-1");
  });

  it("brings the fans with their rated airflow, and reads the refrigerant and ductwork from the option's own scope", () => {
    const r = readingFromQuote(acceptedOptions(draft));
    expect(r.fans).toEqual([{ location: "Bathroom", model: "SJMF100", qty: 2, airflowLps: 67, airflowKind: "rated", serial: "" }]);
    expect(r.ventilation).toBe(true);
    expect(r.refrigerant).toBe("R32");
    expect(r.systems[0].test.refrigerant).toBe("R32");
    expect(r.ductwork).toBe(true);
  });

  it("keeps indoor units the quote gave no outdoor for, under an outdoor still to be filled in", () => {
    const one = normaliseDraft({ intro: "Hi,", options: [{ name: "Split", lines: ["x"], units: [{ role: "indoor", room: "Study", capacity: "2.5 kW", type: "High wall", model: "FTXM25W" }] }] })!;
    const r = readingFromQuote(acceptedOptions(one));
    expect(r.systems).toEqual([expect.objectContaining({ outdoor: expect.objectContaining({ model: "" }), indoors: [expect.objectContaining({ location: "Study", model: "FTXM25W" })] })]);
  });

  it("is nothing to go on when no option is accepted out of several", () => {
    expect(quoteHasEquipment(acceptedOptions({ ...draft, accepted: [] }))).toBe(false);
  });
});
