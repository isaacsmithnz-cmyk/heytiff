import { render, screen } from "@testing-library/react";
import { PayrollCard } from "../payroll-card";
import type { PayFields } from "../types";

/* The app holds two answers to "how many hours a week does this person do".
   `contracted_hours` is typed on this card and prices charge-out; the roster
   in Time & Pay is what fills the timesheet in. They can differ by hours with
   nothing said — which is how a card reads 38 beside a week that presumes 40.

   These pin the one job this card has about it: state both, and name the gap.
   It must NEVER correct either figure — which one is wrong is a question about
   the business. */

const onSave = jest.fn(async () => ({ ok: true as const }));

const pay = (over: Partial<PayFields> = {}): PayFields =>
  ({ contracted_hours: 38, ...over }) as PayFields;

const renderCard = (over: { pay?: PayFields | null; rosteredWeek?: number | null } = {}) =>
  render(
    <PayrollCard pay={over.pay ?? pay()} rosteredWeek={over.rosteredWeek ?? null} onSave={onSave} />
  );

it("says nothing about the roster when there isn't one to state", () => {
  // a casual, or times the org hasn't set — rosteredWeekHours returns null
  renderCard({ rosteredWeek: null });
  expect(screen.getByText("38")).toBeInTheDocument();
  expect(screen.queryByText(/Time & Pay rosters/)).not.toBeInTheDocument();
});

it("names the gap when the typed figure and the roster disagree", () => {
  renderCard({ pay: pay({ contracted_hours: 38 }), rosteredWeek: 40 });
  expect(screen.getByText(/Time & Pay rosters 40h a week/)).toBeInTheDocument();
  // and it stays a note, not a correction: the typed figure is still 38
  expect(screen.getByText("38")).toBeInTheDocument();
});

it("confirms the match rather than going quiet, so agreement is visible too", () => {
  renderCard({ pay: pay({ contracted_hours: 40 }), rosteredWeek: 40 });
  expect(screen.getByText(/Matches the 40h week rostered/)).toBeInTheDocument();
});

it("treats a hair's difference as a match — 38 vs 38.001 is not a finding", () => {
  renderCard({ pay: pay({ contracted_hours: 38 }), rosteredWeek: 38.001 });
  expect(screen.getByText(/Matches the/)).toBeInTheDocument();
});

it("still states the roster when nobody has typed a figure at all", () => {
  renderCard({ pay: pay({ contracted_hours: null }), rosteredWeek: 37.5 });
  expect(screen.getByText(/Time & Pay rosters 37.5h a week/)).toBeInTheDocument();
});

/* 38.00 out of a numeric column would read as a precision this figure does not
   have — nobody's contract says thirty-eight point zero zero. */
it("drops trailing zeros from the rostered figure", () => {
  renderCard({ pay: pay({ contracted_hours: 30 }), rosteredWeek: 40.0 });
  expect(screen.getByText(/40h a week/)).toBeInTheDocument();
  expect(screen.queryByText(/40\.00h/)).not.toBeInTheDocument();
});
