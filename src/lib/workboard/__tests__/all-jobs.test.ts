import {
  ALL_JOBS_HORIZON_DAYS,
  allJobsRows,
  awaitingPaymentCount,
  completedCountLine,
  filterView,
  fmtMinutesAsHours,
  groupChecklist,
  matchesJobSearch,
  quotesCountLine,
  sm8CategoryColour,
  sm8MinutesBetween,
  workCountLine,
  type AllJobsMirrorJob,
  type AllJobsProject,
  type AllJobsVisit,
  type JobChecklistItem,
} from "@/lib/workboard/all-jobs";
import { jobMoneyOf } from "@/lib/workboard/job-money";

const TODAY = "2026-08-12";

const job = (over: Partial<AllJobsMirrorJob> & { remoteId: string }): AllJobsMirrorJob => ({
  jobNumber: "2200",
  status: "Work Order",
  clientName: "Ardex Logistics",
  description: "Cool room door heater tape failed",
  suburb: "Mascot",
  categoryName: "Service Call",
  categoryColour: null,
  date: "2026-08-08 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  ...over,
});

const visit = (over: Partial<AllJobsVisit> & { id: string }): AllJobsVisit => ({
  jobNo: 1004,
  remoteId: null,
  clientName: "Kingsford Medical Centre",
  label: "Quarterly service",
  siteLabel: "Kingsford",
  categoryName: "Annual Maintenance",
  dueDate: "2026-08-20",
  bookedDate: null,
  status: "upcoming",
  completedAt: null,
  ...over,
});

const project = (over: Partial<AllJobsProject> & { id: string }): AllJobsProject => ({
  name: "Belmont change-over",
  clientName: "Belmont",
  siteLabel: "Belmont",
  status: "active",
  stage: "Pre-install",
  remoteIds: [],
  nextBookedDate: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const view = (over: {
  jobs?: AllJobsMirrorJob[];
  visits?: AllJobsVisit[];
  projects?: AllJobsProject[];
  today?: string;
}) =>
  allJobsRows({
    jobs: over.jobs ?? [],
    visits: over.visits ?? [],
    projects: over.projects ?? [],
    today: over.today ?? TODAY,
  });

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("the tabs mirror ServiceM8's own lanes", () => {
  it("sorts each status onto its own tab", () => {
    const v = view({
      jobs: [
        job({ remoteId: "a", status: "Work Order" }),
        job({ remoteId: "b", status: "Quote", quoteDate: "2026-08-05 00:00:00" }),
        job({ remoteId: "c", status: "Completed", completionDate: "2026-08-01 00:00:00" }),
        job({ remoteId: "d", status: "Unsuccessful", completionDate: "2026-07-28 00:00:00" }),
      ],
    });
    expect(keys([...v.work.booked, ...v.work.unbooked])).toEqual(["sm8:a"]);
    expect(keys(v.quotes)).toEqual(["sm8:b"]);
    expect(keys(v.completed)).toEqual(["sm8:c"]);
    expect(keys(v.unsuccessful)).toEqual(["sm8:d"]);
  });

  /* Mirrors store verbatim and never CHECK the value, precisely so ServiceM8
     can add a status without bricking the sync. The reader must be equally
     unbothered: an unknown state is still open work somebody raised. */
  it("puts an unknown status with the open work rather than dropping it", () => {
    const v = view({ jobs: [job({ remoteId: "x", status: "On Hold" })] });
    expect(keys(v.work.unbooked)).toEqual(["sm8:x"]);
    expect(v.work.unbooked[0].statusLabel).toBe("On Hold");
  });

  it("drops a job with no status at all", () => {
    const v = view({ jobs: [job({ remoteId: "x", status: null })] });
    expect(v.work.unbooked).toEqual([]);
  });
});

describe("booked or waiting on a day", () => {
  it("splits work orders by whether ServiceM8's diary has them", () => {
    const v = view({
      jobs: [
        job({ remoteId: "soon", nextBooking: "2026-08-14 07:30:00" }),
        job({ remoteId: "none" }),
      ],
    });
    expect(keys(v.work.booked)).toEqual(["sm8:soon"]);
    expect(keys(v.work.unbooked)).toEqual(["sm8:none"]);
    expect(v.work.booked[0].date).toBe("2026-08-14");
    expect(v.work.booked[0].dateLabel).toBe("booked");
  });

  /* A diary block that has already passed is not a booking — it's history on
     a job still open, which is exactly the job needing a new day. */
  it("treats a past diary block as unbooked", () => {
    const v = view({ jobs: [job({ remoteId: "past", nextBooking: "2026-08-01 07:30:00" })] });
    expect(keys(v.work.unbooked)).toEqual(["sm8:past"]);
  });

  it("puts the soonest booked job first and the newest unbooked job first", () => {
    const v = view({
      jobs: [
        job({ remoteId: "later", nextBooking: "2026-08-20 07:00:00" }),
        job({ remoteId: "sooner", nextBooking: "2026-08-13 07:00:00" }),
        job({ remoteId: "old", date: "2026-07-01 09:00:00" }),
        job({ remoteId: "new", date: "2026-08-10 09:00:00" }),
      ],
    });
    expect(keys(v.work.booked)).toEqual(["sm8:sooner", "sm8:later"]);
    expect(keys(v.work.unbooked)).toEqual(["sm8:new", "sm8:old"]);
  });
});

describe("the union rule", () => {
  it("shows a native visit that has no ServiceM8 job", () => {
    const v = view({ visits: [visit({ id: "v-1" })] });
    expect(keys(v.work.unbooked)).toEqual(["visit:v-1"]);
  });

  /* The headline: a tracked job appears ONCE, as ServiceM8's row wearing a
     chip — not twice, once per system. */
  it("absorbs a visit into its ServiceM8 row and names what it belongs to", () => {
    const v = view({
      jobs: [job({ remoteId: "j-1" })],
      visits: [visit({ id: "v-1", remoteId: "j-1", jobNo: 1004 })],
    });
    expect(keys(v.work.unbooked)).toEqual(["sm8:j-1"]);
    expect(v.work.unbooked[0].tracked).toEqual({ kind: "visit", label: "#1004", id: "v-1" });
  });

  it("absorbs a project into its jobs and names the project", () => {
    const v = view({
      jobs: [job({ remoteId: "j-1" }), job({ remoteId: "j-2" })],
      projects: [project({ id: "p-1", remoteIds: ["j-1", "j-2"] })],
    });
    // Same date on both, so the key breaks the tie — deterministically, which
    // is the point: a list that reshuffles between renders reads as broken.
    expect(keys(v.work.unbooked)).toEqual(["sm8:j-1", "sm8:j-2"]);
    expect(v.work.unbooked[0].tracked).toMatchObject({ kind: "project", label: "Belmont change-over" });
  });

  /* ABSORPTION IS BY PRESENCE, NOT BY LINK. A warming mirror (fresh backfill,
     wipe, standalone) must never make work vanish off the board. */
  it("keeps the native row when the linked job isn't in the mirror yet", () => {
    const v = view({
      jobs: [],
      visits: [visit({ id: "v-1", remoteId: "j-1" })],
      projects: [project({ id: "p-1", remoteIds: ["j-9"] })],
    });
    expect(keys(v.work.unbooked).sort()).toEqual(["project:p-1", "visit:v-1"]);
  });

  it("shows a project with no linked jobs at all", () => {
    const v = view({ projects: [project({ id: "p-1" })] });
    expect(keys(v.work.unbooked)).toEqual(["project:p-1"]);
  });

  it("hides an archived project entirely", () => {
    const v = view({ projects: [project({ id: "p-1", status: "archived" })] });
    expect([...v.work.booked, ...v.work.unbooked, ...v.completed]).toEqual([]);
  });

  it("prefers the visit's chip when a job is somehow both", () => {
    const v = view({
      jobs: [job({ remoteId: "j-1" })],
      visits: [visit({ id: "v-1", remoteId: "j-1" })],
      projects: [project({ id: "p-1", remoteIds: ["j-1"] })],
    });
    expect(v.work.unbooked[0].tracked?.kind).toBe("visit");
  });
});

describe("the horizon", () => {
  it("lists a native visit inside the working horizon", () => {
    const v = view({ visits: [visit({ id: "v-1", dueDate: "2026-09-01" })] });
    expect(keys(v.work.unbooked)).toEqual(["visit:v-1"]);
  });

  /* An agreement generates its whole future — thirteen visits apiece, out for
     years. Those are the same job repeating and would bury 538 real ones. */
  it("holds back a generated visit past the horizon", () => {
    const far = "2027-03-01";
    expect(far > "2026-10-07").toBe(true); // comfortably past TODAY + 56d
    const v = view({ visits: [visit({ id: "v-far", dueDate: far })] });
    expect(v.work.unbooked).toEqual([]);
  });

  /* Fact is not horizoned: a job somebody actually raised in ServiceM8 shows
     at whatever date ServiceM8 gives it. */
  it("still shows a far-future job that exists in ServiceM8", () => {
    const v = view({ jobs: [job({ remoteId: "j-1", nextBooking: "2027-03-01 07:00:00" })] });
    expect(keys(v.work.booked)).toEqual(["sm8:j-1"]);
  });

  it("keeps recent native history and drops the older tail", () => {
    const v = view({
      visits: [
        visit({ id: "recent", status: "done", completedAt: "2026-07-30", dueDate: "2026-07-30" }),
        visit({ id: "ancient", status: "done", completedAt: "2026-01-05", dueDate: "2026-01-05" }),
      ],
    });
    expect(keys(v.completed)).toEqual(["visit:recent"]);
  });

  it("names the horizon in days so the loader and the rules agree", () => {
    expect(ALL_JOBS_HORIZON_DAYS).toBe(56);
  });
});

describe("what each row says", () => {
  it("labels a ServiceM8 number as ServiceM8's and ours as ours", () => {
    const v = view({
      jobs: [job({ remoteId: "j-1", jobNumber: "2214" })],
      visits: [visit({ id: "v-1", jobNo: 1004 })],
    });
    const sm8 = v.work.unbooked.find((r) => r.kind === "sm8")!;
    const native = v.work.unbooked.find((r) => r.kind === "visit")!;
    expect(sm8).toMatchObject({ number: "2214", numberSystem: "sm8" });
    expect(native).toMatchObject({ number: "1004", numberSystem: "ours" });
  });

  it("tones a completed job green and an unsuccessful one red", () => {
    const v = view({
      jobs: [
        job({ remoteId: "c", status: "Completed", completionDate: "2026-08-01 00:00:00" }),
        job({ remoteId: "u", status: "Unsuccessful", completionDate: "2026-08-01 00:00:00" }),
      ],
    });
    expect(v.completed[0].tone).toBe("ok");
    expect(v.unsuccessful[0].tone).toBe("dan");
  });

  it("says a maintenance visit is overdue rather than merely due", () => {
    const v = view({ visits: [visit({ id: "v-1", dueDate: "2026-08-01" })] });
    expect(v.work.unbooked[0].dateLabel).toBe("was due");
  });

  it("says a project has no day booked when it hasn't", () => {
    const v = view({ projects: [project({ id: "p-1" })] });
    expect(v.work.unbooked[0]).toMatchObject({ dateLabel: "no day booked", booked: false });
  });

  it("carries a project's own trouble into its status", () => {
    const v = view({
      projects: [project({ id: "p-1", status: "blocked" }), project({ id: "p-2", status: "on_hold" })],
    });
    const byKey = new Map(v.work.unbooked.map((r) => [r.key, r]));
    expect(byKey.get("project:p-1")).toMatchObject({ statusLabel: "Project blocked", tone: "dan" });
    expect(byKey.get("project:p-2")).toMatchObject({ statusLabel: "Project on hold", tone: "warn" });
  });
});

describe("money on a row", () => {
  it("carries the value and where collection stands", () => {
    const v = view({
      jobs: [
        job({
          remoteId: "j-1",
          status: "Completed",
          completionDate: "2026-08-01 00:00:00",
          money: jobMoneyOf({ total_invoice_amount: "3960.00", invoice_sent: 1 }),
        }),
      ],
    });
    expect(v.completed[0].money).toEqual({
      valueCents: 396000,
      collection: "awaiting",
      quoteSent: false,
      quoteSentOn: null,
    });
  });

  it("is null throughout when the reader has no money access", () => {
    const v = view({ jobs: [job({ remoteId: "j-1", money: null })] });
    expect(v.work.unbooked[0].money).toBeNull();
    expect(awaitingPaymentCount(v)).toBeNull();
  });

  it("counts what finished work is still owed", () => {
    const v = view({
      jobs: [
        job({
          remoteId: "a",
          status: "Completed",
          completionDate: "2026-08-01 00:00:00",
          money: jobMoneyOf({ total_invoice_amount: "100.00", invoice_sent: 1 }),
        }),
        job({
          remoteId: "b",
          status: "Completed",
          completionDate: "2026-08-02 00:00:00",
          money: jobMoneyOf({
            total_invoice_amount: "200.00",
            invoice_sent: 1,
            payment_received: 1,
          }),
        }),
      ],
    });
    expect(awaitingPaymentCount(v)).toBe(1);
  });
});

describe("search", () => {
  const v = () =>
    view({
      jobs: [
        job({ remoteId: "a", jobNumber: "2214", clientName: "Ardex Logistics", suburb: "Mascot" }),
        job({
          remoteId: "b",
          jobNumber: "2240",
          clientName: "Strathfield Dental",
          description: "Replace rooftop package unit",
          suburb: "Strathfield",
          status: "Quote",
          quoteDate: "2026-08-05 00:00:00",
        }),
      ],
    });

  it("finds a job by its number, its client or its suburb", () => {
    expect(filterView(v(), "2214").work.unbooked).toHaveLength(1);
    expect(filterView(v(), "strathfield").quotes).toHaveLength(1);
    expect(filterView(v(), "mascot").work.unbooked).toHaveLength(1);
  });

  /* Every word must land — otherwise "ardex cool" returns every job at Ardex
     and the second word was decoration. */
  it("requires every typed word, so two words narrow rather than widen", () => {
    const rows = v();
    expect(matchesJobSearch(rows.work.unbooked[0], "ardex cool")).toBe(true);
    expect(matchesJobSearch(rows.work.unbooked[0], "ardex rooftop")).toBe(false);
  });

  it("takes typed words literally — a generic word is still a word", () => {
    expect(filterView(v(), "dental").quotes).toHaveLength(1);
  });

  it("an empty search changes nothing", () => {
    expect(filterView(v(), "   ")).toEqual(v());
  });
});

describe("the count lines", () => {
  it("says how the open work splits", () => {
    const v = view({
      jobs: [
        job({ remoteId: "a", nextBooking: "2026-08-14 07:00:00" }),
        job({ remoteId: "b" }),
        job({ remoteId: "c" }),
      ],
    });
    expect(workCountLine(v)).toBe("3 jobs on — 1 booked, 2 waiting on a day");
  });

  it("counts one job in the singular", () => {
    expect(workCountLine(view({ jobs: [job({ remoteId: "a" })] }))).toBe(
      "1 job on — 0 booked, 1 waiting on a day"
    );
  });

  it("has something to say when there is nothing", () => {
    const empty = view({});
    expect(workCountLine(empty)).toBe("Nothing open");
    expect(quotesCountLine(empty)).toBe("No quotes out");
    expect(completedCountLine(empty, false)).toBe("Nothing finished recently");
  });

  it("mentions the unsuccessful tail only while it is showing", () => {
    const v = view({
      jobs: [
        job({ remoteId: "c", status: "Completed", completionDate: "2026-08-01 00:00:00" }),
        job({ remoteId: "u", status: "Unsuccessful", completionDate: "2026-08-01 00:00:00" }),
      ],
    });
    expect(completedCountLine(v, false)).toBe("1 job finished");
    expect(completedCountLine(v, true)).toBe("1 job finished, 1 that didn't go ahead");
  });
});

/* ── the ServiceM8 field readers ── */

describe("sm8CategoryColour", () => {
  it("accepts the bare hex the live mirror actually sends", () => {
    // Verified against prod: colours arrive with NO hash — "e7b5ff".
    expect(sm8CategoryColour("e7b5ff")).toBe("#e7b5ff");
    expect(sm8CategoryColour("CAFFB5")).toBe("#caffb5");
  });

  it("accepts a hash-prefixed value and short and alpha forms", () => {
    expect(sm8CategoryColour("#B5D1FF")).toBe("#b5d1ff");
    expect(sm8CategoryColour("abc")).toBe("#abc");
    expect(sm8CategoryColour("aabbccdd")).toBe("#aabbccdd");
  });

  it("refuses anything that is not hex, so nothing odd reaches a style", () => {
    expect(sm8CategoryColour("red")).toBeNull();
    expect(sm8CategoryColour("url(x)")).toBeNull();
    expect(sm8CategoryColour("e7b5f")).toBeNull(); // five digits is no colour
    expect(sm8CategoryColour("")).toBeNull();
    expect(sm8CategoryColour(null)).toBeNull();
    expect(sm8CategoryColour(undefined)).toBeNull();
  });
});

describe("sm8MinutesBetween", () => {
  it("measures a same-day session", () => {
    expect(sm8MinutesBetween("2026-08-13 07:30:00", "2026-08-13 16:00:00")).toBe(510);
  });

  it("crosses midnight without a timezone anywhere in the sum", () => {
    expect(sm8MinutesBetween("2026-08-13 23:30:00", "2026-08-14 01:00:00")).toBe(90);
  });

  it("returns zero for a zero-length span and null for a negative one", () => {
    expect(sm8MinutesBetween("2026-08-13 07:30:00", "2026-08-13 07:30:00")).toBe(0);
    expect(sm8MinutesBetween("2026-08-13 08:00:00", "2026-08-13 07:00:00")).toBeNull();
  });

  it("returns null for anything malformed", () => {
    expect(sm8MinutesBetween("", "2026-08-13 07:30:00")).toBeNull();
    expect(sm8MinutesBetween("2026-08-13 07:30:00", "soon")).toBeNull();
  });
});

describe("fmtMinutesAsHours", () => {
  it("speaks the shape ServiceM8's billing tab uses", () => {
    // 1110 is job #3137's real recorded total — 18h 30m on their own screen.
    expect(fmtMinutesAsHours(1110)).toBe("18h 30m");
    expect(fmtMinutesAsHours(45)).toBe("45m");
    expect(fmtMinutesAsHours(180)).toBe("3h");
    expect(fmtMinutesAsHours(0)).toBe("0m");
  });
});

describe("groupChecklist", () => {
  const item = (name: string, section: string | null): JobChecklistItem => ({
    name,
    itemType: "Todo",
    section,
    done: false,
    doneOn: null,
    doneBy: null,
  });

  it("keeps order and splits on section changes, unlabelled run first", () => {
    const groups = groupChecklist([
      item("Isolate power", null),
      item("Gas down", null),
      item("Site photos", "Handover"),
      item("Client sign-off", "Handover"),
    ]);
    expect(groups.map((g) => g.section)).toEqual([null, "Handover"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["Isolate power", "Gas down"]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["Site photos", "Client sign-off"]);
  });

  it("starts a new group when a section repeats after a gap, as sort order says", () => {
    const groups = groupChecklist([item("a", "One"), item("b", null), item("c", "One")]);
    expect(groups.map((g) => g.section)).toEqual(["One", null, "One"]);
  });

  it("hands an empty list back as no groups", () => {
    expect(groupChecklist([])).toEqual([]);
  });
});

describe("what an sm8 row carries through", () => {
  it("keeps the category colour and the quote-sent facts beside the money", () => {
    const v = view({
      jobs: [
        job({
          remoteId: "q",
          status: "Quote",
          quoteDate: "2026-08-01 09:00:00",
          categoryColour: "#e7b5ff",
          money: jobMoneyOf({
            total_invoice_amount: "6850.0000",
            quote_sent: 1,
            quote_sent_stamp: "2026-08-03 10:00:00",
          }),
        }),
      ],
    });
    expect(v.quotes[0].categoryColour).toBe("#e7b5ff");
    expect(v.quotes[0].money).toMatchObject({
      valueCents: 685000,
      quoteSent: true,
      quoteSentOn: "2026-08-03",
    });
  });
});
