/* The sync engine's pure half, held still. Three families of correctness:
   the zero-trust field coercers (ServiceM8's zero-date sentinel must degrade
   a field, never kill a page), the naive-string cursor arithmetic (gt-only
   forces the one-second overlap), and the shapes' pick lists — which are the
   privacy boundary, so the fields that must NEVER be mirrored are asserted
   absent by name. */

import {
  backfillFloor,
  chunk,
  cursorFloor,
  dateOrNull,
  filterFor,
  fmtSm8,
  intOrNull,
  maxEditDate,
  SM8_OBJECTS,
  SM8_WIPE_TABLES,
  textOrNull,
  type MirrorRow,
} from "../sm8-sync-plan";

describe("field coercers", () => {
  it("dateOrNull nulls the MySQL zero sentinel and empties, keeps real values verbatim", () => {
    expect(dateOrNull("0000-00-00 00:00:00")).toBeNull();
    expect(dateOrNull("0000-00-00")).toBeNull();
    expect(dateOrNull("")).toBeNull();
    expect(dateOrNull(undefined)).toBeNull();
    expect(dateOrNull(null)).toBeNull();
    // Verbatim: no ISO conversion, no timezone reinterpretation — the naive
    // local string IS the honest value.
    expect(dateOrNull("2026-07-28 09:30:00")).toBe("2026-07-28 09:30:00");
  });

  it("intOrNull coerces flags and refuses garbage without throwing", () => {
    expect(intOrNull(1)).toBe(1);
    expect(intOrNull(0)).toBe(0);
    expect(intOrNull("1")).toBe(1);
    expect(intOrNull(" 7 ")).toBe(7);
    expect(intOrNull(1.9)).toBe(1);
    expect(intOrNull("")).toBeNull();
    expect(intOrNull("abc")).toBeNull();
    expect(intOrNull(NaN)).toBeNull();
    expect(intOrNull(undefined)).toBeNull();
  });

  it("textOrNull turns empties into null and non-strings into null", () => {
    expect(textOrNull("Acme")).toBe("Acme");
    expect(textOrNull("")).toBeNull();
    expect(textOrNull(7)).toBeNull();
  });
});

describe("cursor arithmetic on naive strings", () => {
  it("floors one second under the cursor, across boundaries", () => {
    expect(cursorFloor("2026-07-28 10:00:00")).toBe("2026-07-28 09:59:59");
    // midnight rolls the DAY back — the case string subtraction can't do
    expect(cursorFloor("2026-07-28 00:00:00")).toBe("2026-07-27 23:59:59");
    // and month/year boundaries
    expect(cursorFloor("2026-01-01 00:00:00")).toBe("2025-12-31 23:59:59");
  });

  it("returns null for anything that doesn't parse, so callers fall back to the window", () => {
    expect(cursorFloor(null)).toBeNull();
    expect(cursorFloor("")).toBeNull();
    expect(cursorFloor("yesterday")).toBeNull();
    expect(cursorFloor("2026-07-28T10:00:00Z")).toBeNull();
  });

  it("round-trips through fmtSm8 without timezone drift", () => {
    const ms = Date.parse("2026-07-28T09:30:00Z");
    expect(fmtSm8(ms)).toBe("2026-07-28 09:30:00");
  });

  it("filterFor prefers the cursor, falls back to the backfill window, and quotes the value", () => {
    const now = Date.parse("2026-07-28T00:00:00Z");
    const windowed = { backfillMonths: 24 };
    expect(filterFor(windowed, "2026-07-01 12:00:00", now)).toBe(
      "edit_date gt '2026-07-01 11:59:59'"
    );
    expect(filterFor(windowed, null, now)).toBe(`edit_date gt '${backfillFloor(now, 24)}'`);
    // full-history objects with no cursor pull everything
    expect(filterFor({ backfillMonths: null }, null, now)).toBeNull();
    // …but once they HAVE a cursor, they go incremental like everyone else
    expect(filterFor({ backfillMonths: null }, "2026-07-01 12:00:00", now)).toBe(
      "edit_date gt '2026-07-01 11:59:59'"
    );
  });

  it("maxEditDate is a lexicographic max that ignores unreadable rows", () => {
    const rows = [
      { edit_date: "2026-07-01 10:00:00" },
      { edit_date: null },
      { edit_date: "2026-07-02 09:00:00" },
    ] as MirrorRow[];
    expect(maxEditDate(rows, null)).toBe("2026-07-02 09:00:00");
    expect(maxEditDate(rows, "2026-07-03 00:00:00")).toBe("2026-07-03 00:00:00");
    expect(maxEditDate([], null)).toBeNull();
  });
});

describe("the object list", () => {
  it("walks names before the jobs that reference them", () => {
    const order = SM8_OBJECTS.map((s) => s.object);
    expect(order.indexOf("companies")).toBeLessThan(order.indexOf("jobs"));
    expect(order.indexOf("staff")).toBeLessThan(order.indexOf("job_activities"));
    expect(order.indexOf("jobs")).toBeLessThan(order.indexOf("job_checklists"));
  });

  it("names endpoints exactly as verified against the reference pages", () => {
    const endpoints = Object.fromEntries(SM8_OBJECTS.map((s) => [s.object, s.endpoint]));
    expect(endpoints).toEqual({
      staff: "staff.json",
      categories: "category.json",
      queues: "queue.json",
      companies: "company.json",
      company_contacts: "companycontact.json",
      jobs: "job.json",
      job_contacts: "jobcontact.json",
      job_activities: "jobactivity.json",
      job_checklists: "jobchecklist.json",
    });
  });

  it("wipes every mirror plus the bookkeeping on disconnect", () => {
    for (const spec of SM8_OBJECTS) expect(SM8_WIPE_TABLES).toContain(spec.table);
    expect(SM8_WIPE_TABLES).toContain("sm8_vendor");
    expect(SM8_WIPE_TABLES).toContain("sm8_sync_state");
    expect(SM8_WIPE_TABLES).toContain("sm8_sync_runs");
  });
});

describe("shapes as the privacy boundary", () => {
  const spec = (name: string) => SM8_OBJECTS.find((s) => s.object === name)!;

  it("a row without a uuid is dropped, not stored and not fatal", () => {
    expect(spec("jobs").shape({ status: "Quote" })).toBeNull();
  });

  it("the job shape keeps the money it is asked to keep", () => {
    const shaped = spec("jobs").shape({
      uuid: "j-1",
      generated_job_id: "1042",
      status: "Work Order",
      total_invoice_amount: "12345.0000",
      invoice_sent: 1,
      invoice_date: "2026-07-20 00:00:00",
      payment_received: 0,
      payment_received_stamp: "0000-00-00 00:00:00",
      completion_date: "0000-00-00 00:00:00",
      edit_date: "2026-07-28 09:00:00",
    })!;
    expect(shaped.generated_job_id).toBe("1042");
    expect(shaped.completion_date).toBeNull();
    // Stored VERBATIM — the string ServiceM8 sent, padding and all. Reading it
    // is parseSm8AmountToCents's job, at the far end of the gate.
    expect(shaped.total_invoice_amount).toBe("12345.0000");
    expect(shaped.invoice_sent).toBe(1);
    expect(shaped.invoice_date).toBe("2026-07-20 00:00:00");
    expect(shaped.payment_received).toBe(0);
    // The zero-date sentinel is nulled like every other stamp.
    expect(shaped.payment_received_stamp).toBeNull();
  });

  /* The boundary that survives money being mirrored. Money moved behind a
     capability (`workboard_money`); these fields have no feature at all, and
     two of them have no read scope — so the shape must still drop them. The
     deprecated payment_* detail fields belong to the JobPayment endpoint,
     whose scope is a WRITE scope we refuse to ask for. */
  it("the job shape still refuses badges, coordinates and the write-scope payment detail", () => {
    const shaped = spec("jobs").shape({
      uuid: "j-2",
      generated_job_id: "1043",
      badges: '["b-1"]',
      lat: -33.91,
      lng: 151.19,
      billing_address: "PO Box 12, Mascot",
      payment_method: "Credit card",
      payment_amount: "500.00",
      payment_date: "2026-07-21 00:00:00",
      payment_note: "paid on site",
      edit_date: "2026-07-28 09:00:00",
    })!;
    for (const banned of [
      "badges",
      "lat",
      "lng",
      "billing_address",
      "payment_method",
      "payment_amount",
      "payment_date",
      "payment_note",
    ]) {
      expect(shaped).not.toHaveProperty(banned);
    }
  });

  it("the staff shape is names and title only — never contact or location", () => {
    const shaped = spec("staff").shape({
      uuid: "s-1",
      first: "Luke",
      last: "Nguyen",
      job_title: "Technician",
      email: "luke@example.com",
      mobile: "0400 000 000",
      lat: -27.47,
      lng: 153.02,
      status_message: "on my way",
      navigating_to_job_uuid: "j-9",
      active: 1,
      edit_date: "2026-07-28 09:00:00",
    })!;
    expect(shaped).toMatchObject({ first: "Luke", last: "Nguyen", job_title: "Technician" });
    for (const banned of ["email", "mobile", "lat", "lng", "status_message", "navigating_to_job_uuid"]) {
      expect(shaped).not.toHaveProperty(banned);
    }
  });

  it("every shape keys the mirror's conflict target", () => {
    for (const s of SM8_OBJECTS) {
      const shaped = s.shape({ uuid: "u-1", edit_date: "2026-07-28 09:00:00" });
      expect(shaped).not.toBeNull();
      expect(shaped!.uuid).toBe("u-1");
    }
  });
});

describe("chunk", () => {
  it("splits without losing rows", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const parts = chunk(rows, 400);
    expect(parts.map((p) => p.length)).toEqual([400, 400, 200]);
    expect(parts.flat()).toEqual(rows);
  });
});
