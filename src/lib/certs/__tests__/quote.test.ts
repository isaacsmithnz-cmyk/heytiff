import { matchRequirement } from "../match";
import { isOutdoorModel, modelsIn, readQuote, statedConnectedKw, suggestBuilding } from "../quote";
import { FUTURECERT_9_1, JOB_1245, JOB_1300, JOB_1383, JOB_2043, JOB_248, JOB_2699, JOB_2885, JOB_279, JOB_2933, JOB_3140, JOB_3326 } from "./fixtures/jobs";

/* The wizard's first draft, read off six real jobs. Each is only a
   suggestion the person corrects, but a good one saves the typing. */

const rows = (q: ReturnType<typeof readQuote>) =>
  q.systems.map((s) => ({
    outdoor: [s.outdoor.model, s.outdoor.capacityKw, s.outdoor.location],
    indoors: s.indoors.map((r) => [r.qty, r.model, r.capacityKw, r.location]),
  }));

describe("readQuote on the golden jobs", () => {
  it("1383: a VRF outdoor on the roof and five indoor units by room", () => {
    const q = readQuote(JOB_1383);
    expect(rows(q)).toEqual([
      {
        outdoor: ["", 20, "Rooftop"],
        indoors: [
          [1, "", 9, "Living"],
          [1, "", 3.6, "Master Bed"],
          [1, "", 2.8, "Office"],
          [1, "", 2.2, "Rumpus"],
          [1, "", 2.2, "Guest bed"],
        ],
      },
    ]);
    expect([q.ductwork, q.fireRated, q.ventilation]).toEqual([true, false, false]);
  });

  it("279: the VRF's model, units grouped with their rooms, and the Lossnay", () => {
    const q = readQuote(JOB_279);
    expect(rows(q)).toEqual([
      {
        /* "back to the main outdoor unit in the bottom level" */
        outdoor: ["PUHY-P400YNW", 40, "Bottom level"],
        indoors: [
          [5, "PEFY-P32VMX-E1", 3.6, "Study, Bedrooms 1, 2, and 3, Studio"],
          [1, "PEFY-P50VMX-E1", 5.6, "Master Bedroom"],
          [1, "PEFY-P63VMX-E1", 7.1, "Void Space"],
          [1, "PEFY-P140VMHS-ER1", 16, "Ground Floor Level"],
        ],
      },
    ]);
    expect(q.fans.map((f) => f.model)).toEqual(["Lossnay"]);
    expect([q.ductwork, q.ventilation]).toEqual([true, true]);
  });

  it("1300: one outdoor, five bulkheads under it", () => {
    const q = readQuote(JOB_1300);
    expect(rows(q)).toEqual([
      {
        outdoor: ["", 22, ""],
        indoors: [
          [1, "", 7, "Kitchen"],
          [1, "", 3.6, "Second living area/upstairs"],
          [1, "", 3.6, "Master bedroom"],
          [1, "", 2.8, "Second bedroom"],
          [1, "", 3.6, "Third bed"],
        ],
      },
    ]);
    expect(q.ductwork).toBe(true);
  });

  it("1245: two ducted systems, each its own outdoor, placed by floor", () => {
    const q = readQuote(JOB_1245);
    expect(rows(q)).toEqual([
      { outdoor: ["", 10, ""], indoors: [[1, "PEA-M100HAA", 10, "Ground Floor"]] },
      { outdoor: ["", 7, ""], indoors: [[1, "PEAD-M71JAA", 7, "First Floor"]] },
    ]);
    expect(q.ductwork).toBe(true);
  });

  it("3326: an outdoor model after its indoor joins the same system, with the refrigerant and the pump", () => {
    const q = readQuote(JOB_3326);
    expect(rows(q)).toEqual([
      { outdoor: ["MUZ-AP42VGD2-A2", 4.2, "Roof"], indoors: [[1, "MSZ-AP42VGKD2-A2", 4.2, ""]] },
    ]);
    expect(q.systems[0].test.refrigerant).toBe("R32");
    /* "Trunking/Duct for external" is not ductwork */
    expect([q.ductwork, q.fireRated]).toEqual([false, false]);
  });

  it("2699: a multi split on the balcony, and its fire-rated penetrations", () => {
    const q = readQuote(JOB_2699);
    expect(rows(q)).toEqual([
      {
        outdoor: ["", 7, "Balcony"],
        indoors: [
          [1, "", 5, "Living room"],
          [1, "", 2.5, "Master bedroom"],
          [1, "", 2.5, "Baby’s room"],
        ],
      },
    ]);
    expect([q.ductwork, q.fireRated]).toEqual([false, true]);
  });

  it("reads nothing out of nothing", () => {
    expect(readQuote(null)).toMatchObject({ systems: [], fans: [], ductwork: false, refrigerant: "" });
  });

  it("says a split or ducted system once when the quote says it twice", () => {
    const q = readQuote(
      "Mitsubishi Electric 14kW ducted air conditioning system with 4 zones\n- Supply and installation of a Mitsubishi Electric 14kW ducted system, as per approved plans."
    );
    expect(q.systems).toHaveLength(1);
  });
});

describe("model numbers", () => {
  it("finds them, and tells outdoor from indoor by the maker's prefix", () => {
    expect(modelsIn("RZAC71G2V1 - DAIKIN BULKHEAD OUT 7.1KW R32")).toEqual(["RZAC71G2V1"]);
    expect(modelsIn("Fujitsu Lifestyle SET-ASTH22KMTD split system (R32 refrigerant)")).toEqual(["ASTH22KMTD"]);
    expect(modelsIn("to AS4254 with R410A")).toEqual([]);
    expect(["MUZ-AP42VGD2-A2", "PUHY-P400YNW", "RZA160C2V1", "AOTH22KMTC"].every(isOutdoorModel)).toBe(true);
    expect(["MSZ-AP42VGKD2-A2", "PEFY-P32VMX-E1", "FDYAN160AV1", "PEAD-M71JAA"].some(isOutdoorModel)).toBe(false);
  });
});

describe("suggestBuilding", () => {
  it("preselects from the shape of the address, and says why", () => {
    expect(suggestBuilding("7/10 Example Avenue\nSuburb NSW 2000").building).toBe("apartment");
    expect(suggestBuilding("12/25-35 Example Drive").building).toBe("apartment");
    expect(suggestBuilding("Lv 3 Suite 4/44-54 Example Road, Suburb, NSW, 2015")).toEqual({
      building: "office",
      because: "The address has a level or suite.",
    });
    expect(suggestBuilding("Shop 2, 5 Example St").building).toBe("shop");
    expect(suggestBuilding("21b Example Street\nSuburb NSW 2026").building).toBe("house");
    expect(suggestBuilding(null).building).toBe("house");
  });
});

describe("matchRequirement", () => {
  it("matches FutureCert's item 9.1 to its three clauses, with nothing left over", () => {
    expect(FUTURECERT_9_1.map((t) => matchRequirement(t).clause)).toEqual(["as1668", "fireMode", "j5"]);
  });

  it("calls smoke control not ours, and leaves the unknown unmatched", () => {
    expect(matchRequirement("Stair pressurisation system commissioned to AS/NZS 1668.1")).toEqual({ clause: null, notOurs: true });
    expect(matchRequirement("Provide a copy of the BASIX certificate")).toEqual({ clause: null, notOurs: false });
  });

  it("knows the clauses a certifier commonly names", () => {
    expect(matchRequirement("Car park ventilation and CO monitoring").clause).toBe("carPark");
    expect(matchRequirement("Kitchen exhaust hood and ductwork").clause).toBe("kitchenExhaust");
    expect(matchRequirement("Air balance and commissioning report").clause).toBe("airBalance");
    expect(matchRequirement("Refrigeration installed to AS/NZS 5149").clause).toBe("refrigerant");
    expect(matchRequirement("Ductwork to AS 4254").clause).toBe("ductwork");
    expect(matchRequirement("Acoustic compliance of the condenser").clause).toBe("noise");
  });
});

describe("what the quote says about itself", () => {
  it("1383: says 29 kW connected while its rows add to 19.8, so the wizard can say so", () => {
    const q = readQuote(JOB_1383);
    expect(q.statedConnectedKw).toBe(29);
    expect(q.systems[0].indoors.reduce((t, r) => t + (r.capacityKw ?? 0) * r.qty, 0)).toBeCloseTo(19.8);
  });

  it("reads a stated total either way round, and nothing when there is none", () => {
    expect(statedConnectedKw("VRF with a connected capacity of 24.5 kW")).toBe(24.5);
    expect(statedConnectedKw(JOB_279)).toBeNull();
  });
});

describe("2043: an outdoor counted like an indoor, and fans named three ways", () => {
  const q = readQuote(JOB_2043);

  it("keeps the 1 x 15.5 kW outdoor and the five rooms it runs", () => {
    expect(q.systems).toHaveLength(1);
    expect(q.systems[0].outdoor).toMatchObject({ qty: 1, capacityKw: 15.5 });
    expect(q.systems[0].indoors.map((r) => r.location)).toEqual(["Study 1", "Study 2", "Bedroom 1", "Bedroom 2", "Bedroom 3"]);
  });

  it("counts the in-line fans from the total under them, names the subfloor pair by model, and invents none from a sentence", () => {
    expect(q.fans.map((f) => ({ location: f.location, model: f.model, qty: f.qty }))).toEqual([
      { location: "", model: "", qty: 6 },
      { location: "Sub floor, exhaust", model: "SJMF150-S", qty: 1 },
      { location: "Sub floor, supply", model: "SJMF150-S", qty: 1 },
    ]);
    expect(q.ventilation).toBe(true);
    expect(q.ductwork).toBe(true);
  });
});

describe("1212: where the outdoor unit went", () => {
  it("reads 'down the side of property' as the side of the house", () => {
    const q = readQuote("- 15.5KW Mitsubishi Electric VRF outdoor to be installed down the side of property.\n\nConnected units:\n- 1 x 7.1KW indoor for the Kitchen Area.");
    expect(q.systems[0].outdoor).toMatchObject({ location: "Side of the house", capacityKw: 15.5 });
    expect(q.systems[0].indoors.map((r) => r.location)).toEqual(["Kitchen Area"]);
  });
});

describe("Section J, under either edition", () => {
  it("matches a list that says J5 (BCA 2019) or J6 (NCC 2022)", () => {
    expect(matchRequirement("Installation in accordance with Part J5 of the BCA").clause).toBe("j5");
    expect(matchRequirement("Air-conditioning complies with Part J6 of NCC 2022").clause).toBe("j5");
  });
});

describe("2885: one system said twice", () => {
  it("reads the summary sentence and the model lines as one system, in the kitchen, and leaves the service of the old one out", () => {
    const q = readQuote(JOB_2885);
    expect(q.systems).toHaveLength(1);
    expect(q.systems[0].outdoor).toMatchObject({ model: "RZAC71G2V1", capacityKw: 7.1 });
    expect(q.systems[0].indoors).toEqual([expect.objectContaining({ model: "FDYBA71AV1", location: "Kitchen" })]);
    expect(q.systems[0].test.refrigerant).toBe("R32");
    expect(q.ductwork).toBe(true);
  });
});

describe("readQuote on the October samples", () => {
  it("3140: a two-port multi and its two bulkheads, and not the controller fitted one per indoor unit", () => {
    const q = readQuote(JOB_3140);
    expect(rows(q)).toEqual([
      {
        outdoor: ["MXZ-2F52VF-A2", 5.2, ""],
        indoors: [
          [1, "SEZ-M35DA3", 3.5, ""],
          [1, "SEZ-M25DA3", 2.5, ""],
        ],
      },
    ]);
    expect([q.refrigerant, q.ductwork]).toEqual(["R32", true]);
  });

  it("2933: one 24 kW ducted system on the roof, ductwork, and the bathroom fan", () => {
    const q = readQuote(JOB_2933);
    expect(rows(q)).toEqual([{ outdoor: ["", 24, "Roof"], indoors: [[1, "", 24, ""]] }]);
    expect([q.ductwork, q.ventilation, q.fans.length]).toEqual([true, true, 1]);
  });

  it("248: two ducted systems, each with the floor it serves", () => {
    expect(rows(readQuote(JOB_248))).toEqual([
      { outdoor: ["", 8.5, ""], indoors: [[1, "", 8.5, "First floor beds"]] },
      { outdoor: ["", 8.5, ""], indoors: [[1, "", 8.5, "Ground floor"]] },
    ]);
  });

  /* The quotes held back from more rules (2933's asterisked models, 2207's
     "63 VMHS ducted system to …", 1930's bold room headings, 2147's "final
     agreed location") are Tiff's to read: description-reader.test.ts. */
});
