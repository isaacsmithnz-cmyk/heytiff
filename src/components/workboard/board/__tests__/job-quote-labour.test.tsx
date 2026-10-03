import { render, screen } from "@testing-library/react";
import { JobQuoteLabour } from "../job-quote-labour";
import type { QuoteLabour } from "@/lib/quotes/quote-labour-server";

/* Isaac, 2026-10-04: labour from the brief, else the business's own
   history, else nothing — and money only where there's a rate. */

const answer = (labour: QuoteLabour) => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, labour }) }));
};
const brief: QuoteLabour["advice"] = {
  from: "brief",
  labour: {
    visits: [
      { stage: "Install", people: 3, days: 1 },
      { stage: "Return", people: 1, days: 0.5 },
    ],
    personHours: 28,
    said: ["3 x pax for 1 day", "Dave for 4 hrs for patching following day"],
  },
};

it("from the brief: the visits, the hours, what it was read from, and the cost at the business's own rate", async () => {
  answer({ kind: "multi", advice: brief, rate: { perHourCents: 14000, from: "charged" } });
  render(<JobQuoteLabour job="j-1" visible />);
  expect(await screen.findByText("28 hrs, from the brief")).toBeInTheDocument();
  expect(screen.getByText("3 people, 1 day")).toBeInTheDocument();
  expect(screen.getByText("1 person, half a day")).toBeInTheDocument();
  expect(screen.getByText("Labour at your $140/hr")).toBeInTheDocument();
  expect(screen.getByText("$3,920")).toBeInTheDocument();
  expect(screen.getByText("“3 x pax for 1 day” “Dave for 4 hrs for patching following day”")).toBeInTheDocument();
});

it("no rate (a new business, or no money access): hours only, no cost", async () => {
  answer({ kind: "multi", advice: brief, rate: null });
  render(<JobQuoteLabour job="j-1" visible />);
  expect(await screen.findByText("28 hrs, from the brief")).toBeInTheDocument();
  expect(screen.queryByText(/\/hr/)).toBeNull();
});

it("not in the brief: what the business typically takes, from its own jobs", async () => {
  answer({
    kind: "maintenance",
    advice: { from: "history", typical: { kind: "maintenance", hours: 6, jobs: 37, words: "You typically use 6 hrs labour for maintenance (37 of your jobs)." } },
    rate: { perHourCents: 14200, from: "recommended" },
  });
  render(<JobQuoteLabour job="j-1" visible />);
  expect(await screen.findByText("Not in the brief")).toBeInTheDocument();
  expect(screen.getByText("You typically use 6 hrs labour for maintenance (37 of your jobs).")).toBeInTheDocument();
  expect(screen.getByText("6 hrs at your recommended $142/hr")).toBeInTheDocument();
});

it("neither: says so, and makes nothing up", async () => {
  answer({ kind: "vrf", advice: { from: "none" }, rate: { perHourCents: 14000, from: "charged" } });
  render(<JobQuoteLabour job="j-1" visible />);
  expect(await screen.findByText("Not in the brief")).toBeInTheDocument();
  expect(screen.queryByText(/hrs/)).toBeNull();
});

it("reads nothing until the Quote section is open", () => {
  const f = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = f;
  render(<JobQuoteLabour job="j-1" visible={false} />);
  expect(f).not.toHaveBeenCalled();
});
