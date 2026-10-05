import { makeOf, withMakes } from "../make";
import { EMPTY_FAN, EMPTY_ROW, EMPTY_TEST } from "../mechanical";

/* The make a certifier reads beside each model: job 2905's PEFY and PUMY
   codes are Mitsubishi Electric's, and the certificate said so nowhere. */

describe("makeOf", () => {
  it("reads the maker off its own codes", () => {
    expect(makeOf("PUMY-P200YKMD2-A")).toBe("Mitsubishi Electric");
    expect(makeOf("PEFY-P63VMX-A")).toBe("Mitsubishi Electric");
    expect(makeOf("MSZ-AP35VGKD2")).toBe("Mitsubishi Electric");
    expect(makeOf("FTXM35W")).toBe("Daikin");
  });

  it("falls back to the job's words only when they name one maker", () => {
    expect(makeOf("XF100", "Supply and install Fujitsu ducted system")).toBe("Fujitsu");
    expect(makeOf("XF100", "Remove the old Daikin and install a Mitsubishi")).toBe("");
    expect(makeOf("XF100", "Mitsubishi Heavy Industries outdoor")).toBe("Mitsubishi Heavy Industries");
    expect(makeOf("XF100")).toBe("");
  });

  it("trusts the model over the words", () => {
    expect(makeOf("PEFY-P25VMX-A", "Replacing a Daikin system")).toBe("Mitsubishi Electric");
  });
});

describe("withMakes", () => {
  it("fills a row with no make and keeps one the person typed", () => {
    const reading = {
      systems: [
        {
          outdoor: { ...EMPTY_ROW, model: "PUMY-P200YKMD2-A", location: "Garage" },
          indoors: [
            { ...EMPTY_ROW, model: "PEFY-P63VMX-A" },
            { ...EMPTY_ROW, model: "PEFY-P25VMX-A", make: "Mitsubishi" },
          ],
          test: EMPTY_TEST,
        },
      ],
      fans: [{ ...EMPTY_FAN, model: "XF100" }],
    };
    const out = withMakes(reading, "Mitsubishi Electric VRF system");
    expect(out.systems[0].outdoor.make).toBe("Mitsubishi Electric");
    expect(out.systems[0].indoors.map((r) => r.make)).toEqual(["Mitsubishi Electric", "Mitsubishi"]);
    expect(out.fans[0].make).toBe("Mitsubishi Electric");
  });
});
