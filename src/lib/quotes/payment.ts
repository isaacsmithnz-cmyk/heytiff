/* PAYMENT TERMS — three presets, switched by the kind of job.

   STAGES, NOT DATES. A progress payment on a home job over $20,000 in NSW is
   authorised only as a specified amount or percentage "payable following
   completion of a specified stage of the work", with the stage described in
   plain language (Home Building Act s 8A), and the deposit on any home job
   is capped at 10% (s 8). Stages also follow a long job naturally: rough-in
   happens at frame stage and fit-off months later, so a six-month build is
   spread out without anyone picking dates.

   Commercial work is claimed monthly for work done, which is the ordinary
   way under the Security of Payment Act.

   The percentages are a starting point. A person can change any stage on
   the card; `paymentProblems` says what the law won't allow before it goes. */

export type PaymentPreset = "domestic_small" | "domestic_construction" | "commercial";

export type PaymentStage = {
  /** When it falls due, in plain words — the stage of the work. */
  when: string;
  /** Whole percent of the contract price. Null for a claim that is not a
      fixed share (commercial monthly claims). */
  percent: number | null;
};

export const PAYMENT_PRESETS: Record<PaymentPreset, { label: string; stages: PaymentStage[] }> = {
  domestic_small: {
    label: "Home, small job",
    stages: [
      { when: "Deposit, on accepting", percent: 10 },
      { when: "Balance, within 7 days of finishing", percent: 90 },
    ],
  },
  domestic_construction: {
    label: "Home, construction",
    stages: [
      { when: "Deposit, on accepting", percent: 10 },
      { when: "Rough-in done: pipes, drains, ducting and cabling in place", percent: 40 },
      { when: "Units installed and connected", percent: 40 },
      { when: "Commissioned and handed over", percent: 10 },
    ],
  },
  commercial: {
    label: "Business",
    stages: [
      { when: "Progress claims at the end of each month, for work done", percent: null },
      { when: "Balance on completion", percent: null },
    ],
  },
};

export const PAYMENT_PRESET_KEYS = Object.keys(PAYMENT_PRESETS) as PaymentPreset[];

/** What the law or the arithmetic won't allow, in words for the card. */
export function paymentProblems(preset: PaymentPreset, stages: readonly PaymentStage[]): string[] {
  const out: string[] = [];
  if (preset === "commercial") return out;
  const first = stages[0];
  if (first && first.percent !== null && first.percent > 10 && /deposit/i.test(first.when)) {
    out.push("A deposit on a home job can't be more than 10%.");
  }
  if (stages.some((s) => s.percent === null)) {
    out.push("Every stage on a home job needs its percentage.");
  } else {
    const total = stages.reduce((n, s) => n + (s.percent ?? 0), 0);
    if (total !== 100) out.push(`The stages add up to ${total}%, not 100%.`);
  }
  return out;
}
