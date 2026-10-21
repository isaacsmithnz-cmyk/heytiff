import { sm8QuoteBrief } from "../sm8-quote-brief";

/* Isaac, 2026-10-05: "it pulls whatever information it can from the service
   mate quote to start it" */
it("starts from ServiceM8's scope as written and its line items", () => {
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

/* Isaac, 2026-10-21, on 3421: "Just asking for an option should keep all of
   the original pricing, as the clients have already got that" */
it("keeps each line's price ex GST, and the quote's price where one As Per Quote line holds it", () => {
  expect(
    sm8QuoteBrief({
      scope: "Option 1 ducted\nOption 2 - Basic on/off zoning upgrade to option 1\nOption 3 - 6kw high wall",
      lines: [
        { name: "Option 1", quantity: 1, priceCents: 910000 },
        { name: "Option 2 zoning upgrade", quantity: 1, priceCents: 115000 },
        { name: "6kw high wall", quantity: 1, priceCents: 360000 },
        { name: "Grille", quantity: 2, priceCents: 7500 },
      ],
    })
  ).toBe(
    "As quoted in ServiceM8:\nOption 1 ducted\nOption 2 - Basic on/off zoning upgrade to option 1\nOption 3 - 6kw high wall\n\nIts line items:\n- Option 1: $9,100.00 ex GST\n- Option 2 zoning upgrade: $1,150.00 ex GST\n- 6kw high wall: $3,600.00 ex GST\n- 2 × Grille: $75.00 each ex GST"
  );
  expect(sm8QuoteBrief({ scope: "Supply and install a split", lines: [{ name: "As Per Quote", quantity: 1, priceCents: 330000 }] })).toBe(
    'As quoted in ServiceM8:\nSupply and install a split\n\nQuoted as one line "As Per Quote": $3,300.00 ex GST'
  );
});

