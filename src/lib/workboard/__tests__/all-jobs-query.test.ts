/* The job sheet's "Next on site" line. ServiceM8's activity feed mixes two
   kinds of row under one table: activity_was_scheduled=1 is a dispatched
   booking, =0 is a recorded time-on-site session. Seen live on job #3188
   (2026-08-14): the sheet said "Next on site 10:15am–12:13pm" — a recording,
   note the 12:13 end — while the actual booking that day was 11:30am–2pm.
   Only scheduled rows may become the next booking; recorded rows feed the
   time-on-site sum and nothing else. */

const rowsBy: Record<string, Record<string, unknown>[]> = {};
const singleBy: Record<string, Record<string, unknown> | null> = {};
/* Some reads ask the same table twice for different things — resolveJobCard
   asks for a number and then for that number's parent. A queue lets a test
   answer the two calls differently; empty, singleBy answers both. */
const singleQueue: Record<string, (Record<string, unknown> | null)[]> = {};
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
      sub.order = note("order");
      sub.gte = () => sub;
      sub.or = note("or");
      sub.limit = note("limit");
      sub.maybeSingle = () => {
        const q = singleQueue[table];
        if (q && q.length) return Promise.resolve({ data: q.shift() ?? null });
        return Promise.resolve({ data: singleBy[table] ?? null });
      };
      sub.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: rowsBy[table] ?? [] }).then(res);
      return sub;
    },
  },
}));

import {
  readJobFamily,
  readMirrorJobDetail,
  readMirrorJobRow,
  resolveJobCard,
  searchAllMirrorJobs,
} from "@/lib/workboard/all-jobs-query";
import { buildJobStory, storyLineOf } from "@/lib/workboard/job-story";

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
  for (const k of Object.keys(singleQueue)) delete singleQueue[k];
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
      staffTitle: null,
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

describe("who went, and what they are", () => {
  /* The titles ride the staff read the detail was already paying for. They
     appear ONLY on a visit's crew and the next booking — the one place the
     card introduces people rather than naming them. */
  const onSite = (staff: string, start: string, end: string) => ({
    start_date: start,
    end_date: end,
    staff_uuid: staff,
    activity_was_scheduled: 0,
  });

  it("carries each name with its ServiceM8 job title, trimmed", async () => {
    rowsBy["sm8_job_activities"] = [
      onSite("s-1", "2026-08-13 07:00:00", "2026-08-13 11:00:00"),
      onSite("s-2", "2026-08-13 07:30:00", "2026-08-13 11:30:00"),
    ];
    rowsBy["sm8_staff"] = [
      /* Live titles arrive with trailing spaces — "HVAC " is a real row. */
      { uuid: "s-1", first: "Oleh", last: "Ivanov", job_title: "Senior HVAC " },
      { uuid: "s-2", first: "Sam", last: "Petrie", job_title: null },
    ];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    expect(detail?.visits).toEqual([
      {
        day: "2026-08-13",
        minutes: 480,
        crew: [
          { name: "Oleh Ivanov", title: "Senior HVAC" },
          /* 3 of the 21 live staff have no title; a name alone is the
             honest answer, never an invented one. */
          { name: "Sam Petrie", title: null },
        ],
      },
    ]);
  });

  it("counts one person's two sessions in a day as ONE name on the visit", async () => {
    rowsBy["sm8_job_activities"] = [
      onSite("s-1", "2026-08-13 07:00:00", "2026-08-13 11:00:00"),
      onSite("s-1", "2026-08-13 12:00:00", "2026-08-13 14:00:00"),
    ];
    rowsBy["sm8_staff"] = [
      { uuid: "s-1", first: "Oleh", last: "Ivanov", job_title: "HVAC" },
    ];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    expect(detail?.visits[0].crew).toEqual([{ name: "Oleh Ivanov", title: "HVAC" }]);
    expect(detail?.timeOnSite).toEqual({ minutes: 360, sessions: 2 });
  });

  it("names the booked tech's title too", async () => {
    rowsBy["sm8_job_activities"] = [
      {
        start_date: "2026-08-14 11:30:00",
        end_date: "2026-08-14 14:00:00",
        staff_uuid: "s-1",
        activity_was_scheduled: 1,
      },
    ];
    rowsBy["sm8_staff"] = [
      { uuid: "s-1", first: "Jack", last: "Reid", job_title: "Apprentice" },
    ];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    expect(detail?.nextBooking).toMatchObject({
      staffName: "Jack Reid",
      staffTitle: "Apprentice",
    });
  });
});

/* ── check-ins left open ──────────────────────────────────────────────────
   Jobs #3237 and #3225, every active activity row off the live mirror. A
   check-in left open overnight is a person on site whose time is unknown —
   ServiceM8 still counts its whole span, and the summary used to repeat it:
   "Oleksii Khalameida and Louis Jones on site 12 September, 54 hours
   logged" (#3237) and "Louis Jones and Leonardo Martins put in a 32h 36m
   stint on 9 September" (#3225). The bookings ride along so the test also
   proves nothing was capped at a booking's end. */

describe("check-ins left open — #3237 and #3225", () => {
  const STAFF = [
    { uuid: "s-oleksii", first: "Oleksii", last: "Khalameida", job_title: "HVAC" },
    { uuid: "s-louis", first: "Louis", last: "Jones", job_title: "HVAC" },
    { uuid: "s-michael", first: "Michael", last: "Diamond", job_title: "Director" },
    { uuid: "s-callum", first: "Callum", last: "Vrieze", job_title: "Apprentice " },
    { uuid: "s-leo", first: "Leonardo", last: "Martins", job_title: "HVAC" },
  ];
  const act = (scheduled: 0 | 1, staff: string, start: string, end: string) => ({
    start_date: start,
    end_date: end,
    staff_uuid: staff,
    activity_was_scheduled: scheduled,
  });
  const storyLines = (detail: Awaited<ReturnType<typeof readMirrorJobDetail>>) =>
    buildJobStory({
      detail,
      notes: null,
      ourNotes: null,
      ledger: null,
      family: null,
      invoicedOn: null,
      media: null,
      picklist: null,
      timezone: null,
    })
      .filter((e) => e.kind === "visit")
      .map(storyLineOf);

  it("#3237: the 12 Sep is Oleksii's 6h 46m, with Louis on site and no 47 hours", async () => {
    singleBy["sm8_jobs"] = { ...jobRow, uuid: "j-3237", generated_job_id: "3237" };
    rowsBy["sm8_staff"] = STAFF;
    rowsBy["sm8_job_activities"] = [
      act(0, "s-oleksii", "2026-08-31 10:38:47", "2026-09-01 06:28:42"), // 19.8h, open
      act(1, "s-michael", "2026-08-31 11:00:00", "2026-08-31 15:00:00"),
      act(1, "s-oleksii", "2026-08-31 11:00:00", "2026-08-31 15:00:00"),
      act(0, "s-michael", "2026-08-31 12:25:50", "2026-08-31 14:10:53"),
      act(0, "s-louis", "2026-08-31 13:55:43", "2026-09-01 07:17:18"), // 17.4h, open
      act(1, "s-callum", "2026-09-01 11:00:00", "2026-09-01 15:00:00"),
      act(1, "s-oleksii", "2026-09-01 11:00:00", "2026-09-01 15:00:00"),
      act(0, "s-callum", "2026-09-01 12:56:29", "2026-09-01 14:56:23"),
      act(0, "s-oleksii", "2026-09-01 14:33:41", "2026-09-01 14:54:31"),
      act(1, "s-oleksii", "2026-09-12 07:00:00", "2026-09-12 15:00:00"),
      act(1, "s-louis", "2026-09-12 07:00:00", "2026-09-12 15:00:00"),
      act(0, "s-oleksii", "2026-09-12 07:27:33", "2026-09-12 14:13:13"),
      act(0, "s-louis", "2026-09-12 07:43:40", "2026-09-14 06:58:24"), // 47.2h, open
    ];

    const detail = await readMirrorJobDetail("org-1", "j-3237", "2026-10-01", {
      includeMoney: false,
    });

    expect(detail?.visits).toEqual([
      {
        day: "2026-09-12",
        /* Oleksii's own 6h 46m. Capped at the booking's 3pm, Louis would
           have added 7h 16m nobody recorded — 842 here, not 406. */
        minutes: 406,
        crew: [
          { name: "Oleksii Khalameida", title: "HVAC" },
          { name: "Louis Jones", title: "HVAC", leftOpen: true },
        ],
      },
      {
        day: "2026-09-01",
        minutes: 120 + 21,
        crew: [
          { name: "Callum Vrieze", title: "Apprentice" },
          { name: "Oleksii Khalameida", title: "HVAC" },
        ],
      },
      {
        day: "2026-08-31",
        minutes: 105, // Michael's 1h 45m; the other two left theirs open
        crew: [
          { name: "Oleksii Khalameida", title: "HVAC", leftOpen: true },
          { name: "Michael Diamond", title: "Director" },
          { name: "Louis Jones", title: "HVAC", leftOpen: true },
        ],
      },
    ]);
    /* The tally is the same believable sessions — it was 109h 19m. */
    expect(detail?.timeOnSite).toEqual({ minutes: 406 + 141 + 105, sessions: 4 });

    /* What the summary is written from: no 54 hours, and the day says whose
       time it leaves out. */
    expect(storyLines(detail)).toEqual([
      "2026-09-12 — site visit, 6h 46m (Oleksii Khalameida, Louis Jones); Louis Jones left a check-in open, so that time isn't counted",
      "2026-09-01 — site visit, 2h 21m (Callum Vrieze, Oleksii Khalameida)",
      "2026-08-31 — site visit, 1h 45m (Oleksii Khalameida, Michael Diamond, Louis Jones); Oleksii Khalameida and Louis Jones left check-ins open, so that time isn't counted",
    ]);
  });

  it("#3225: the 9 Sep is Leonardo's 7h 5m, not a 32h 36m stint", async () => {
    singleBy["sm8_jobs"] = { ...jobRow, uuid: "j-3225", generated_job_id: "3225" };
    rowsBy["sm8_staff"] = STAFF;
    rowsBy["sm8_job_activities"] = [
      act(1, "s-michael", "2026-09-02 07:00:00", "2026-09-02 08:00:00"),
      act(0, "s-louis", "2026-09-09 05:27:59", "2026-09-10 06:59:21"), // 25.5h, open
      act(1, "s-leo", "2026-09-09 06:00:00", "2026-09-09 14:00:00"),
      act(1, "s-michael", "2026-09-09 06:00:00", "2026-09-09 14:00:00"),
      act(1, "s-louis", "2026-09-09 06:00:00", "2026-09-09 14:00:00"),
      act(0, "s-leo", "2026-09-09 06:12:15", "2026-09-09 13:16:52"),
      act(0, "s-leo", "2026-09-10 06:05:15", "2026-09-10 10:03:16"),
      act(1, "s-michael", "2026-09-10 07:00:00", "2026-09-10 12:00:00"),
      act(1, "s-leo", "2026-09-10 07:00:00", "2026-09-10 12:00:00"),
    ];

    const detail = await readMirrorJobDetail("org-1", "j-3225", "2026-10-01", {
      includeMoney: false,
    });

    expect(detail?.visits.map((v) => [v.day, v.minutes])).toEqual([
      ["2026-09-10", 238],
      ["2026-09-09", 425],
    ]);
    expect(detail?.visits[1].crew).toEqual([
      { name: "Louis Jones", title: "HVAC", leftOpen: true },
      { name: "Leonardo Martins", title: "HVAC" },
    ]);
    expect(detail?.timeOnSite).toEqual({ minutes: 238 + 425, sessions: 2 });

    expect(storyLines(detail)).toEqual([
      "2026-09-10 — site visit, 3h 58m (Leonardo Martins)",
      "2026-09-09 — site visit, 7h 5m (Louis Jones, Leonardo Martins); Louis Jones left a check-in open, so that time isn't counted",
    ]);
  });

  it("a day whose only check-in was left open names the person and says no figure", async () => {
    rowsBy["sm8_staff"] = STAFF;
    rowsBy["sm8_job_activities"] = [act(0, "s-louis", "2026-09-12 07:43:40", "2026-09-14 06:58:24")];

    const detail = await readMirrorJobDetail("org-1", "j-3188", "2026-10-01", {
      includeMoney: false,
    });

    expect(detail?.visits).toEqual([
      { day: "2026-09-12", minutes: 0, crew: [{ name: "Louis Jones", title: "HVAC", leftOpen: true }] },
    ]);
    /* no believable minutes anywhere — the heading claims no time on site */
    expect(detail?.timeOnSite).toBeNull();
    expect(storyLines(detail)).toEqual([
      "2026-09-12 — site visit, hours unknown (Louis Jones); Louis Jones left a check-in open",
    ]);
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

  /* A ZERO-PRICED ROW IS AN UNREADABLE MEMBER, NOT AN UNPRICED ONE.
     parseSm8AmountToCents("0.0000") is null, so one such row makes that
     member's lines unaddable — and passing that on as "no lines" let its
     payment stand as the claim's whole value and read Paid. */
  it("marks a member with an unpriced row unreadable rather than line-less", async () => {
    rowsBy["sm8_job_materials"] = [
      line("j-2380a", "Progress payment 30%", "1.0000", "8388.0000"),
      line("j-2380a", "Site allowance", "1.0000", "0.0000"),
    ];
    rowsBy["sm8_job_payments"] = [
      { job_uuid: "j-2380a", amount: "2500.0000", timestamp: "2026-04-02 09:12:00" },
    ];

    const money = await readJobFamily("org-1", "j-2380", "2026-08-26", null);
    const a = money?.claims.find((c) => c.jobNumber === "2380A");

    expect(a?.amountCents).toBeNull();
    expect(a?.state).toBe("part");
    expect(money?.unknownClaim).toBe(true);
    expect(money?.valueCents).toBeNull();
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


/* ── which card a row opens ────────────────────────────────────────────── */

describe("resolveJobCard", () => {
  it("opens a plain job as itself", async () => {
    singleQueue["sm8_jobs"] = [{ generated_job_id: "2380" }];
    expect(await resolveJobCard("org-1", "j-2380")).toEqual({
      parentRemoteId: "j-2380",
      focusRemoteId: null,
    });
  });

  it("opens a clone as its parent, with the claim to land on", async () => {
    singleQueue["sm8_jobs"] = [{ generated_job_id: "2380A" }, { uuid: "j-2380" }];
    expect(await resolveJobCard("org-1", "j-2380a")).toEqual({
      parentRemoteId: "j-2380",
      focusRemoteId: "j-2380a",
    });
  });

  /* 44 clones live have no active parent, and they are not empty — 674 files
     sit on them. There is nothing to be a claim OF, so they open as cards. */
  it("leaves an orphan clone opening as itself", async () => {
    singleQueue["sm8_jobs"] = [{ generated_job_id: "1243A" }, null];
    expect(await resolveJobCard("org-1", "j-1243a")).toEqual({
      parentRemoteId: "j-1243a",
      focusRemoteId: null,
    });
  });

  it("falls back to opening itself for a number it cannot read", async () => {
    singleQueue["sm8_jobs"] = [{ generated_job_id: "SVC-11" }];
    expect(await resolveJobCard("org-1", "j-x")).toEqual({
      parentRemoteId: "j-x",
      focusRemoteId: null,
    });
  });

  it("falls back for a row that is not in this org's mirror at all", async () => {
    singleQueue["sm8_jobs"] = [null];
    expect(await resolveJobCard("org-1", "j-nope")).toEqual({
      parentRemoteId: "j-nope",
      focusRemoteId: null,
    });
  });
});

/* ⌘K finds a job anywhere in the mirror and opens it on the Workboard, whose
   own book only holds 56 days of finished work — so the link reads the one
   job itself when the book doesn't have it. */
describe("readMirrorJobRow", () => {
  it("reads one job past the board's window, in the board's own shape", async () => {
    singleBy["sm8_jobs"] = {
      ...jobRow,
      uuid: "j-288",
      generated_job_id: "288",
      status: "Completed",
      company_uuid: "c-1",
      geo_city: "Kingsford",
      completion_date: "2024-03-04 15:00:00",
    };
    rowsBy["sm8_companies"] = [{ uuid: "c-1", name: "Kingsford Bakery" }];

    const job = await readMirrorJobRow("org-1", "j-288", TODAY, { includeMoney: false });

    expect(job).toMatchObject({
      remoteId: "j-288",
      jobNumber: "288",
      status: "Completed",
      clientName: "Kingsford Bakery",
      description: "Split not cooling",
      suburb: "Kingsford",
      completionDate: "2024-03-04 15:00:00",
      money: null,
      paidCents: 0,
    });
  });

  it("answers null for a job this org's mirror does not hold", async () => {
    singleBy["sm8_jobs"] = null;
    expect(await readMirrorJobRow("org-1", "j-elsewhere", TODAY)).toBeNull();
  });
});

describe("searchAllMirrorJobs", () => {
  /* Unordered, "23" could come back as thirty of the hundred-odd jobs from
     230 to 2399 and leave out job 23 itself; in number order a prefix sorts
     before everything it starts. */
  it("asks for the number in number order, so the number typed comes first", async () => {
    rowsBy["sm8_jobs"] = [];
    await searchAllMirrorJobs("org-1", "23", TODAY, { includeMoney: false });

    const byNumber = calls.findIndex(
      (c) => c.table === "sm8_jobs" && c.method === "ilike" && c.args[0] === "generated_job_id"
    );
    expect(byNumber).toBeGreaterThanOrEqual(0);
    const order = calls.slice(byNumber + 1).find((c) => c.table === "sm8_jobs" && c.method === "order");
    expect(order?.args).toEqual(["generated_job_id", { ascending: true }]);
  });
});
