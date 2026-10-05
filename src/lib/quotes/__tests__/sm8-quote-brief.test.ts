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
