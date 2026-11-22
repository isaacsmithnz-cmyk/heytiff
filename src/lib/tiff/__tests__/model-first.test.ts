import { modelAhead, modelCodes, titleNamesModel, topDocs } from "../model-first";

/* Bug 75 (23 November 2026): asked about an RZA60C2V1, the search let
   Mitsubishi pages push "Daikin RZA R32 Ducted" off the list. */
describe("the model asked about, first", () => {
  it("finds model codes, not years, sizes or refrigerants", () => {
    expect(modelCodes("What's the pre charged pipe length on the RZA60C2V1 / FDYAN60AV1?")).toEqual([
      "RZA60C2V1",
      "FDYAN60AV1",
    ]);
    expect(modelCodes("PUMY-SP140VKM")).toEqual(["PUMYSP140VKM"]);
    expect(modelCodes("R32 in 2026, 7.1kW, 12KW unit, 230V")).toEqual([]);
  });

  it("knows a title that names the model", () => {
    expect(titleNamesModel("Daikin RZA R32 Ducted", ["RZA60C2V1"])).toBe(true);
    expect(titleNamesModel("PUMY-P200YKMD2-A IM", ["RZA60C2V1"])).toBe(false);
    expect(titleNamesModel("Daikin VRV Diagnosis Manual", ["RZA60C2V1"])).toBe(false);
  });

  it("takes the documents with most hits", () => {
    expect(topDocs([{ documentId: "a" }, { documentId: "b" }, { documentId: "b" }, { documentId: "c" }], 2)).toEqual(["b", "a"]);
  });

  it("puts the model's pages ahead, each once", () => {
    expect(modelAhead([{ id: "2" }, { id: "5" }], [{ id: "1" }, { id: "2" }, { id: "3" }]).map((r) => r.id)).toEqual([
      "2",
      "5",
      "1",
      "3",
    ]);
  });
});
