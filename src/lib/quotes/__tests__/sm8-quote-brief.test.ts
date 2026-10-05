import { sm8QuoteBrief } from "../sm8-quote-brief";

/* Isaac, 2026-10-05: "it pulls whatever information it can from the service
   mate quote to start it" */
it("starts from ServiceM8's scope as written and its line items, without prices", () => {
  expect(
    sm8QuoteBrief({
      scope: "1 x MXZ-5F100 outdoor\n2 x MSZ-AP25 heads",
      lines: [
        { name: "MXZ-5F100VGD", quantity: 1 },
        { name: "Condensate pump", quantity: 3 },
      ],
    })
  ).toBe("As quoted in ServiceM8:\n1 x MXZ-5F100 outdoor\n2 x MSZ-AP25 heads\n\nIts line items:\n- MXZ-5F100VGD\n- 3 × Condensate pump");
});

it("leaves out a line that only stands for the total", () => {
  expect(sm8QuoteBrief({ scope: "Supply and install a split", lines: [{ name: "As Per Quote", quantity: 1 }] })).toBe(
    "As quoted in ServiceM8:\nSupply and install a split"
  );
  expect(sm8QuoteBrief({ scope: null, lines: [{ name: "As per quote.", quantity: 1 }] })).toBeNull();
  expect(sm8QuoteBrief({ scope: "  ", lines: [] })).toBeNull();
});

/* Isaac's 2905, 2026-10-05: "Partial invoice #2905A" reached the brief */
it("leaves out the lines that bill for the job, and keeps every variation", () => {
  const names = [
    "Partial invoice #2905A",
    "30% Deposit",
    "Progress claim 2",
    "Final invoice",
    "Credit card surcharge",
    "50% of the quoted price",
    "Variation to Quote (HWS Not Installed)",
    "Variations: extra exhaust fan",
  ];
  const brief = sm8QuoteBrief({ scope: "Scope", lines: names.map((name) => ({ name, quantity: 1 })) });
  expect(brief).toBe("As quoted in ServiceM8:\nScope\n\nIts line items:\n- Variation to Quote (HWS Not Installed)\n- Variations: extra exhaust fan");
});

it("reads 2905 as its scope alone, and a negative line that isn't billing as taken off", () => {
  expect(sm8QuoteBrief({ scope: "VRF system", lines: [{ name: "As Per Quote", quantity: 1 }, { name: "Partial invoice #2905A", quantity: -1 }] })).toBe(
    "As quoted in ServiceM8:\nVRF system"
  );
  expect(sm8QuoteBrief({ scope: "Split", lines: [{ name: "Variation: HWS not installed", quantity: -1 }] })).toBe(
    "As quoted in ServiceM8:\nSplit\n\nIts line items:\n- Taken off: Variation: HWS not installed"
  );
});

it("leads with ServiceM8's heading even when the quote is only line items", () => {
  expect(sm8QuoteBrief({ scope: null, lines: [{ name: "Daikin 7.1 kW split", quantity: 1 }] })).toBe("As quoted in ServiceM8:\nIts line items:\n- Daikin 7.1 kW split");
});
