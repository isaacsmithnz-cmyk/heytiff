import { namedJobNumber } from "../task-job-number";

describe("namedJobNumber", () => {
  it("reads a number written as a job", () => {
    expect(namedJobNumber("Proceed with 3450 Kingsford")).toBe("3450");
    expect(namedJobNumber("Ring the builder about #2845")).toBe("2845");
    expect(namedJobNumber("Order for job 2845A")).toBe("2845A");
  });

  it("leaves a measure or a model alone", () => {
    expect(
      namedJobNumber(
        "Add to the quote: System redesign: upstairs Mitsubishi Electric VRF (140 single-phase outdoor) with 7.1 kW"
      )
    ).toBeNull();
    expect(namedJobNumber("Pick up 200 mm duct")).toBeNull();
    expect(namedJobNumber("Order 125 of them")).toBeNull();
  });
});
