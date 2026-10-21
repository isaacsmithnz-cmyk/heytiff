import { render, screen } from "@testing-library/react";
import { JobMoneyGlance } from "../job-money-block";
import type { JobMoney } from "@/lib/workboard/job-money";

/* The Overview's Money tile (Isaac, 22 October 2026, "Job card, four
   tiles"): the figure, where collection stands in its state's colour, and
   one line under it, read from the block's own reading. */

const money = (over: Partial<JobMoney> = {}): JobMoney => ({
  valueCents: 1045000,
  invoiced: true,
  invoicedOn: "2026-10-20",
  quoteSent: true,
  quoteSentOn: null,
  paid: false,
  paidOn: null,
  ...over,
});

it("shows an invoiced job nobody has paid as its value, owed in orange, and the day it was invoiced", () => {
  render(<JobMoneyGlance family={null} money={money()} ledgerPaidCents={0} statusLabel="Work Order" />);
  expect(screen.getByText("$10,450")).toHaveClass("jt-big");
  expect(screen.getByText("Nothing paid yet").closest(".pt-state")).toHaveClass("pt-state--look");
  expect(screen.getByText("Invoiced Tue 20 Oct")).toHaveClass("jt-cap");
});

it("shows what's still owing once part is paid, with the job's value under it", () => {
  render(<JobMoneyGlance family={null} money={money()} ledgerPaidCents={450000} statusLabel="Work Order" />);
  expect(screen.getByText("$5,950")).toHaveClass("jt-big");
  expect(screen.getByText("Job value $10,450")).toBeInTheDocument();
});

it("says a paid job is paid in green", () => {
  render(<JobMoneyGlance family={null} money={money()} ledgerPaidCents={1045000} statusLabel="Completed" />);
  expect(screen.getByText("Paid in full").closest(".pt-state")).toHaveClass("pt-state--good");
});

it("leaves a quote's word grey", () => {
  render(<JobMoneyGlance family={null} money={money({ invoiced: false, invoicedOn: null })} ledgerPaidCents={0} statusLabel="Quote" />);
  expect(screen.getByText(/^Quote sent|^Not sent yet/).closest(".pt-state")).toBeNull();
});

it("says so when ServiceM8's figures didn't load, and shows no figure", () => {
  render(<JobMoneyGlance family={null} money={null} ledgerPaidCents={0} statusLabel={null} unavailable />);
  expect(screen.getByText(/didn.t load just now/)).toBeInTheDocument();
  expect(document.querySelector(".jt-big")).toBeNull();
});
