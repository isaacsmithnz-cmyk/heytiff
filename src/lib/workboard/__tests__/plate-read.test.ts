import { parsePlate, plateCode, sameModel, PLATE_PROMPT } from "../plate-read";
import { hasSerials, readingFromQuote, withSerials } from "@/lib/certs/from-quote";
import { normaliseDraft } from "@/lib/quotes/proposal";

/* Isaac, 2026-10-06: "serial numbers etc. can be read from there using photos" */

describe("a rating plate, read", () => {
  it("keeps the model and serial as printed, and nothing else", () => {
    expect(parsePlate({ model: " pefy-p25vmx-a ", serial: "52X04417" })).toEqual({ model: "PEFY-P25VMX-A", serial: "52X04417" });
    expect(parsePlate({ model: "MSZ-AP35VGKD", serial: "" })).toEqual({ model: "MSZ-AP35VGKD", serial: "" });
    expect(parsePlate({ model: "", serial: "" })).toBeNull();
    expect(parsePlate("not json")).toBeNull();
    expect(plateCode("52x 04417\n")).toBe("52X 04417");
    /* Mitsubishi's <H> marking, as a real plate printed it (job 907) */
    expect(parsePlate({ model: "PEA-M100GAA <H>", serial: "5ZM 01956" })).toEqual({ model: "PEA-M100GAA", serial: "5ZM 01956" });
    expect(PLATE_PROMPT).toContain("never correct, complete or guess");
  });

  it("checks the plate's model against the quote's, spaces and case aside", () => {
    expect(sameModel("PEFY-P25VMX-A", "pefy-p25vmx-a")).toBe(true);
    expect(sameModel("PEFY-P25VMX-E", "PEFY-P25VMX-A")).toBe(false);
    expect(sameModel("", "")).toBe(false);
  });
});

describe("the certificate's serials", () => {
  const options = normaliseDraft({
    options: [
      {
        name: "VRF",
        lines: ["VRF."],
        units: [
          { role: "outdoor", room: "Garage", capacity: "22.4 kW", type: "Outdoor unit", model: "PUMY-P200YKMD2-A", qty: 1, system: 1 },
          { role: "indoor", room: "Level 2 Bedroom 3", capacity: "2.8 kW", type: "Ducted", model: "PEFY-P25VMX-A", qty: 1, system: 1 },
          { role: "indoor", room: "Level 2 Bedroom 4", capacity: "2.8 kW", type: "Ducted", model: "PEFY-P25VMX-A", qty: 1, system: 1 },
        ],
      },
    ],
  })!.options;

  it("puts each unit's serial on its own row, by place and model", () => {
    const r = withSerials(readingFromQuote(options), [
      { role: "indoor", system: 1, room: "Level 2 Bedroom 4", model: "PEFY-P25VMX-A", modelRead: "PEFY-P25VMX-A", serial: "52X04418" },
      { role: "outdoor", system: 1, room: "Garage", model: "PUMY-P200YKMD2-A", modelRead: null, serial: "9ZW00012" },
    ]);
    expect(r.systems[0]!.outdoor.serial).toBe("9ZW00012");
    expect(r.systems[0]!.indoors.map((i) => [i.location, i.serial])).toEqual([
      ["Level 2 Bedroom 3", ""],
      ["Level 2 Bedroom 4", "52X04418"],
    ]);
    expect(hasSerials(r)).toBe(true);
    expect(hasSerials(readingFromQuote(options))).toBe(false);
  });
});

describe("the certificate's serials, where units look alike", () => {
  const twin = normaliseDraft({
    options: [
      {
        name: "Two systems",
        lines: ["Two splits."],
        units: [
          { role: "outdoor", room: "Side", capacity: "3.5 kW", type: "Outdoor unit", model: "MUZ-AP35VG", qty: 1, system: 1 },
          { role: "outdoor", room: "Side", capacity: "3.5 kW", type: "Outdoor unit", model: "MUZ-AP35VG", qty: 1, system: 2 },
          { role: "indoor", room: "Bedroom", capacity: "3.5 kW", type: "High wall", model: "MSZ-AP35VG", qty: 1, system: 1 },
          { role: "indoor", room: "Study", capacity: "3.5 kW", type: "High wall", model: "MSZ-AP35VG", qty: 1, system: 2 },
        ],
      },
    ],
  })!.options;

  it("keeps each system's serial on its own outdoor unit", () => {
    const r = withSerials(readingFromQuote(twin), [
      { role: "outdoor", system: 2, room: "Side", model: "MUZ-AP35VG", modelRead: null, serial: "S-TWO" },
      { role: "outdoor", system: 1, room: "Side", model: "MUZ-AP35VG", modelRead: null, serial: "S-ONE" },
    ]);
    expect(r.systems.map((s) => s.outdoor.serial)).toEqual(["S-ONE", "S-TWO"]);
  });

  it("puts the plate's model on the row when it isn't the quote's, beside its own serial", () => {
    const r = withSerials(readingFromQuote(twin), [{ role: "indoor", system: 2, room: "Study", model: "MSZ-AP35VG", modelRead: "MSZ-AP50VG", serial: "S-STUDY" }]);
    expect(r.systems[1]!.indoors[0]).toMatchObject({ model: "MSZ-AP50VG", serial: "S-STUDY" });
  });

  it("never fills a row there's nothing to match by", () => {
    const orphan = normaliseDraft({ options: [{ name: "Head", lines: ["A head."], units: [{ role: "indoor", room: "", capacity: "", type: "High wall", model: "", qty: 1, system: 0 }] }] })!.options;
    const r = withSerials(readingFromQuote(orphan), [{ role: "indoor", system: null, room: "", model: "", modelRead: null, serial: "LOOSE" }]);
    expect(r.systems[0]!.outdoor.serial).toBe("");
  });
});
