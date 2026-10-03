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
   the card; `paymentProblems` says what doesn't add up before it goes.

   THE DEPOSIT IS THE BUSINESS'S CALL (Isaac, 2026-10-04: "Allow an override
   of the any deposit %. Just show suggested figure"). 10% is suggested — the
   most NSW allows on a home job — and shown beside a deposit set to
   anything else; it never stops one being saved. */

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

/** The deposit suggested on a home job: the Home Building Act's limit (NSW, s 8). */
export const SUGGESTED_DEPOSIT_PCT = 10;

/** The deposit is the first stage, when it says it is one. */
export const isDepositStage = (s: PaymentStage, i: number) => i === 0 && /deposit/i.test(s.when);

/** The suggested deposit, to show beside a home job's deposit set to
    something else; null when it is the suggestion, or there's no deposit. */
export function suggestedDeposit(preset: PaymentPreset, stages: readonly PaymentStage[]): number | null {
  if (preset === "commercial") return null;
  const first = stages[0];
  if (!first || !isDepositStage(first, 0) || first.percent === SUGGESTED_DEPOSIT_PCT) return null;
  return SUGGESTED_DEPOSIT_PCT;
}

/** What the arithmetic won't allow, in words for the card. */
export function paymentProblems(preset: PaymentPreset, stages: readonly PaymentStage[]): string[] {
  const out: string[] = [];
  if (preset === "commercial") return out;
  if (stages.some((s) => s.percent === null)) {
    out.push("Every stage on a home job needs its percentage.");
  } else {
    const total = stages.reduce((n, s) => n + (s.percent ?? 0), 0);
    if (total !== 100) out.push(`The stages add up to ${total}%, not 100%.`);
  }
  return out;
}
