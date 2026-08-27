/* The job sheet's "Next on site" line. ServiceM8's activity feed mixes two
   kinds of row under one table: activity_was_scheduled=1 is a dispatched
   booking, =0 is a recorded time-on-site session. Seen live on job #3188
   (2026-08-14): the sheet said "Next on site 10:15am–12:13pm" — a recording,
   note the 12:13 end — while the actual booking that day was 11:30am–2pm.
   Only scheduled rows may become the next booking; recorded rows feed the
   time-on-site sum and nothing else. */

const rowsBy: Record<string, Record<string, unknown>[]> = {};
const singleBy: Record<string, Record<string, unknown> | null> = {};
/* The fake honours nothing it is asked — so where the QUESTION is the thing
   under test (does the family read ask by name or by prefix?), the calls are
   recorded and asserted directly. */
const calls: { table: string; method: string; args: unknown[] }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const sub: Record<string, unknown> = {};
      const note =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ table, method, args });
          return sub;
        };
      sub.select = () => sub;
      sub.eq = () => sub;
      sub.in = note("in");
      sub.ilike = note("ilike");
      sub.order = () => sub;
      sub.limit = note("limit");
      sub.maybeSingle = () => Promise.resolve({ data: singleBy[table] ?? null });
      sub.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: rowsBy[table] ?? [] }).then(res);
      return sub;
    },
  },
}));

import { readJobFamily, readMirrorJobDetail } from "@/lib/workboard/all-jobs-query";

const TODAY = "2026-08-14";

const jobRow = {
  uuid: "j-3188",
  generated_job_id: "3188",
  status: "Work Order",
  company_uuid: null,
  job_address: null,
  geo_city: null,
  geo_state: null,
  geo_postcode: null,
  category_uuid: null,
  queue_uuid: null,
  queue_expiry_date: null,
  queue_assigned_staff_uuid: null,
  job_description: "Split not cooling",
  work_done_description: null,
  purchase_order_number: null,
  date: "2026-08-10 08:00:00",
  quote_date: null,
  work_order_date: null,
  completion_date: null,
};

/* Rows arrive ordered by start_date ascending, as the query asks. */
const recorded = {
  start_date: "2026-08-14 10:15:00",
  end_date: "2026-08-14 12:13:00",
  staff_uuid: null,
  activity_was_scheduled: 0,
};
const booked = {
  start_date: "2026-08-14 11:30:00",
  end_date: "2026-08-14 14:00:00",
  staff_uuid: null,
  activity_was_scheduled: 1,
};

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rowsBy)) delete rowsBy[k];
  for (const k of Object.keys(singleBy)) delete singleBy[k];
  singleBy["sm8_jobs"] = jobRow;
});

describe("next booking comes only from scheduled rows", () => {
  it("skips a recorded session earlier today when the real booking sits after it", async () => {
    rowsBy["sm8_job_activities"] = [recorded, booked];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    // The dispatched 11:30–2pm block, not the 10:15–12:13 recording.
    expect(detail?.nextBooking).toEqual({
      start: "2026-08-14 11:30:00",
      end: "2026-08-14 14:00:00",
      staffName: null,
    });

    // The recording still counts where it belongs: time on site.
    expect(detail?.timeOnSite).toEqual({ minutes: 118, sessions: 1 });
  });

  it("shows no booking at all when only recordings exist ahead of now", async () => {
    rowsBy["sm8_job_activities"] = [recorded];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    expect(detail?.nextBooking).toBeNull();
    expect(detail?.timeOnSite).toEqual({ minutes: 118, sessions: 1 });
  });
});

/* ── the family read ──────────────────────────────────────────────────────
   Every row here is job #2380's, off the live mirror: a $27,960 quote billed
   as a 30% deposit (#2380A) and a 50% progress claim (#2380B), with the
   parent netted down to the $6,268.06 balance. */

const FAMILY = [
  {
    uuid: "j-2380",
    generated_job_id: "2380",
    total_invoice_amount: "6268.0600",
    invoice_date: "2026-08-21 10:49:09",
    date: "2026-01-12 00:00:00",
  },
  {
    uuid: "j-2380a",
    generated_job_id: "2380A",
    total_invoice_amount: null,
    invoice_date: null,
    date: "2026-03-27 00:00:00",
  },
  {
    uuid: "j-2380b",
    generated_job_id: "2380B",
    total_invoice_amount: null,
    invoice_date: null,
    date: "2026-04-02 00:00:00",
  },
];

const line = (job: string, name: string, qty: string, amount: string) => ({
  uuid: `${job}-${name}`,
  job_uuid: job,
  name,
  quantity: qty,
  price: amount,
  displayed_amount: amount,
  displayed_amount_is_tax_inclusive: 0,
});

describe("readJobFamily", () => {
  beforeEach(() => {
    singleBy["sm8_jobs"] = { generated_job_id: "2380" };
    rowsBy["sm8_jobs"] = FAMILY;
    rowsBy["sm8_job_materials"] = [
      line("j-2380", "As Per Quote", "1.0000", "27960.0000"),
      line("j-2380", "Partial invoice #2380A", "-1.0000", "8388.0000"),
      line("j-2380", "Partial invoice #2380B", "-1.0000", "13980.0000"),
      line("j-2380", "Credit Card Processing Fee 1.9%", "1.0000", "106.2400"),
      line("j-2380a", "Progress payment 30%", "1.0000", "8388.0000"),
      line("j-2380a", "Credit Card Processing Fee 1.9%", "1.0000", "159.3700"),
      line("j-2380b", "Progress payment", "1.0000", "13980.0000"),
      line("j-2380b", "Credit Card Processing Fee 1.9%", "1.0000", "265.6200"),
    ];
    rowsBy["sm8_job_payments"] = [
      { job_uuid: "j-2380a", amount: "9402.1100", timestamp: "2026-04-02 09:12:00" },
      { job_uuid: "j-2380b", amount: "15670.1800", timestamp: "2026-04-10 15:02:00" },
    ];
  });

  it("reads the three cards as one job worth $31,340.35", async () => {
    const money = await readJobFamily("org-1", "j-2380", "2026-08-26", null);

    expect(money?.valueCents).toBe(3134035);
    expect(money?.basis).toBe("inc");
    expect(money?.claims.map((c) => c.jobNumber)).toEqual(["2380A", "2380B", "2380"]);
    expect(money?.claims.map((c) => c.percent)).toEqual([30, 50, 20]);
  });

  it("counts the deposit that landed on a clone, which a uuid join never does", async () => {
    const money = await readJobFamily("org-1", "j-2380", "2026-08-26", null);

    expect(money?.paidCents).toBe(2507229);
    expect(money?.awaitingCents).toBe(626806);
    expect(money?.claims[0].state).toBe("paid");
    expect(money?.claims[2].state).toBe("awaiting");
  });

  /* 255 of the 284 parents in a family live carry NO total of their own, so
     the netting rows are the only thing that says what is left on the parent
     — dropping them would value it at the whole quote and double-count every
     clone. This is that case: the parent is unpriced and unpaid. */
  it("nets the partials out of an unpriced parent instead of billing twice", async () => {
    rowsBy["sm8_jobs"] = [{ ...FAMILY[0], total_invoice_amount: null }, FAMILY[1], FAMILY[2]];

    const money = await readJobFamily("org-1", "j-2380", "2026-08-26", null);
    // $27,960 − $8,388 − $13,980 + $106.24 = $5,698.24, on the lines' own
    // ex-GST basis — which is why the family total stands down
    expect(money?.claims[2].amountCents).toBe(569824);
    expect(money?.claims[2].basis).toBe("ex");
    expect(money?.mixedBasis).toBe(true);
    expect(money?.valueCents).toBeNull();
  });

  /* The common live shape: the parent is unpriced but PAID, and a payment
     that clears its netted ex-GST lines is the balance, stated by
     ServiceM8 — no 1.1 anywhere. */
  it("values an unpriced parent from the payment that settled it", async () => {
    rowsBy["sm8_jobs"] = [{ ...FAMILY[0], total_invoice_amount: null }, FAMILY[1], FAMILY[2]];
    rowsBy["sm8_job_payments"] = [
      ...rowsBy["sm8_job_payments"],
      { job_uuid: "j-2380", amount: "6268.0600", timestamp: "2026-08-25 11:00:00" },
    ];

    const money = await readJobFamily("org-1", "j-2380", "2026-08-26", null);
    expect(money?.claims[2].amountCents).toBe(626806);
    expect(money?.claims[2].state).toBe("paid");
    expect(money?.valueCents).toBe(3134035);
  });

  it("refuses a longer number the prefix match dragged in", async () => {
    singleBy["sm8_jobs"] = { generated_job_id: "238" };
    rowsBy["sm8_jobs"] = [
      { uuid: "j-238", generated_job_id: "238", total_invoice_amount: "1100.0000", invoice_date: null, date: null },
      ...FAMILY,
    ];
    rowsBy["sm8_job_materials"] = [];
    rowsBy["sm8_job_payments"] = [];

    const money = await readJobFamily("org-1", "j-238", "2026-08-26", null);
    expect(money?.claims.map((c) => c.jobNumber)).toEqual(["238"]);
    expect(money?.valueCents).toBe(110000);
  });

  /* `ilike '15%'` asks for #15, #150-#159 and every #15xx in the account —
     hundreds of rows — and a capped window over them can come back without a
     single one of #15's own members in it. Twenty-seven exact equalities have
     no window to overflow. */
  it("asks for the family by name and never by prefix", async () => {
    await readJobFamily("org-1", "j-2380", "2026-08-26", null);

    expect(calls.some((c) => c.table === "sm8_jobs" && c.method === "ilike")).toBe(false);
    const byName = calls.find((c) => c.table === "sm8_jobs" && c.method === "in");
    expect(byName).toBeDefined();
    const wanted = byName!.args[1] as string[];
    expect(wanted).toHaveLength(27);
    expect(wanted[0]).toBe("2380");
    expect(wanted).toContain("2380B");
    expect(wanted).toContain("2380Z");
    expect(wanted).not.toContain("23800");
    // and no cap on the job read at all, so no family can be half-read
    expect(calls.some((c) => c.table === "sm8_jobs" && c.method === "limit")).toBe(false);
  });

  /* A cap that is reached is a number that is wrong: the rows that went
     unread are money that went uncounted. Saying nothing beats saying a
     figure that is quietly short. */
  it("declines to speak for the family when the ledger read saturates", async () => {
    rowsBy["sm8_job_materials"] = Array.from({ length: 600 }, (_, i) =>
      line("j-2380", `Filler ${i}`, "1.0000", "1.0000")
    );

    expect(await readJobFamily("org-1", "j-2380", "2026-08-26", null)).toBeNull();
  });

  it("says nothing at all about a job number it cannot read", async () => {
    singleBy["sm8_jobs"] = { generated_job_id: "SVC-11" };
    expect(await readJobFamily("org-1", "j-x", "2026-08-26", null)).toBeNull();
  });
});
