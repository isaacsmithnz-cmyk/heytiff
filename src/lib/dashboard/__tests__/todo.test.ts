/* HOME › TO DO: every source, and the one button each row gets. Placed
   against Friday 25 September 2026, the day home-list.test places on. */

import { columnOf, bellCount, deskAskHref, todoRows, type TodoInput, type TodoRow } from "../todo";
import { placeList, type ListCaps, type ListInput } from "../home-list";
import { vehicleChips, type ActionChip } from "../chips";
import type { DashTask } from "../tasks";
import type { NewAssignment } from "../assignments";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { VehicleWithFacts } from "@/components/fleet/logic";

const DAY = "2026-09-25";
const ALL: ListCaps = { assetsAll: true, placeVisits: true, money: false, sm8: true };

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  title: "Order the grilles",
  detail: null,
  assigneeId: "me",
  assigneeName: "Isaac Smith",
  dueDate: DAY,
  status: "open",
  createdBy: "me",
  createdAt: "2026-09-15T01:00:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at",
  ...over,
});

const chip = (over: Partial<ActionChip> = {}): ActionChip => ({
  key: "expenses",
  kind: "expenses",
  state: "warn",
  label: "3 claims waiting",
  subject: "Expenses",
  href: "/dashboard/team?view=expenses",
  urgency: 10_000,
  due: null,
  ref: null,
  ...over,
});

const job = (over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId: "j1",
  jobNumber: "2380",
  status: "Work Order",
  clientName: "Kingsford Bakery",
  description: null,
  suburb: "Kingsford",
  categoryName: null,
  categoryColour: null,
  date: "2026-09-24 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
} as AllJobsMirrorJob);

const van = (over: Partial<VehicleWithFacts>): ActionChip[] =>
  vehicleChips(
    {
      id: "v1",
      name: "Hilux",
      make: "Toyota",
      model: "Hilux",
      year: 2019,
      plate: "XQG41B",
      plateState: "NSW",
      status: "active",
      odometer: 90_000,
      regoDays: 200,
      insuranceDays: 200,
      ctpDays: 200,
      serviceIntervalKm: 10_000,
      lastServiceOdo: 88_000,
      serviceIntervalMonths: null,
      serviceDays: null,
      motorised: true,
      ...over,
    },
    { subject: "Hilux", href: "/dashboard/assets", warnDays: 30, today: DAY },
  );

const listOf = (over: Partial<ListInput> = {}) =>
  placeList({
    day: DAY,
    tz: "Australia/Sydney",
    warnDays: 30,
    viewerStaffId: "me",
    names: { me: "Isaac", s2: "Lyle" },
    tasks: [],
    journal: [],
    chips: [],
    issues: [],
    wins: [],
    visits: [],
    caps: ALL,
    ...over,
  });

const given = (over: Partial<NewAssignment> = {}): NewAssignment => ({
  taskId: "a1",
  title: "Measure up the Rozelle fans",
  detail: null,
  fromName: "Lyle Irving",
  dueDate: null,
  createdAt: "2026-09-25T00:00:00Z",
  ...over,
});

const input = (over: Partial<TodoInput> = {}): TodoInput => ({
  reminders: [],
  assignments: [],
  notices: [],
  timesheets: 0,
  chips: [],
  list: listOf(),
  ...over,
});

const byKey = (rows: TodoRow[], key: string) => rows.find((r) => r.key === key)!;

describe("Home's three columns (Isaac, 20 October)", () => {
  it("(F) a reminder due is Today's; new work given to you, timesheets and notices are Activity's", () => {
    const rows = todoRows(
      input({
        reminders: [{ taskId: "t9", title: "Ring the dealer", late: "now" }],
        timesheets: 2,
        notices: [{ id: "n1", title: "Toolbox talk", from: "Lyle", day: "2026-10-20" }],
      }),
    );
    expect(columnOf(byKey(rows, "reminder:t9"))).toBe("today");
    expect(columnOf(byKey(rows, "timesheets"))).toBe("activity");
    expect(columnOf(byKey(rows, "notice:n1"))).toBe("activity");
  });

  /* Today is only what has a time (Isaac, 20 October 2026: "So schedule should only be today should only be timed events") */
  it("(F) an approval comes in under Activity; a paper due, today or later, is To do's, the late one first", () => {
    const rows = todoRows(
      input({
        today: "2026-10-20",
        list: null,
        chips: [
          chip({ key: "cw", kind: "cert-wording" }),
          chip({ key: "r0", kind: "rego", due: "2026-10-20" }),
          chip({ key: "r1", kind: "licence", due: "2026-11-30" }),
        ],
      }),
    );
    expect(columnOf(byKey(rows, "alert:cw"))).toBe("activity");
    expect(columnOf(byKey(rows, "alert:r0"))).toBe("todo");
    expect(columnOf(byKey(rows, "alert:r1"))).toBe("todo");
  });
});

describe("the bell's own rows", () => {
  it("(F) a reminder due: a tick to finish it, and Later", () => {
    const [row] = todoRows(input({ reminders: [{ taskId: "t9", title: "Ring the Hilux dealer", late: "20 minutes ago" }] }));
    expect(row).toEqual<TodoRow>({
      key: "reminder:t9",
      source: "reminder",
      col: "today",
      tone: "look",
      name: "Ring the Hilux dealer",
      line: "Reminder, 20 minutes ago",
      lineTone: false,
      tick: "t9",
      act: { kind: "later", taskId: "t9" },
    });
  });

  it("(F) work given to you: a tick, and Got it; once, when it is also a reminder due", () => {
    const rows = todoRows(
      input({
        reminders: [{ taskId: "a2", title: "Due one", late: "now" }],
        assignments: [given(), given({ taskId: "a2", title: "Due one" })],
      }),
    );
    expect(rows.map((r) => r.key)).toEqual(["reminder:a2", "assignment:a1"]);
    expect(byKey(rows, "assignment:a1")).toMatchObject({
      tick: "a1",
      line: "From Lyle Irving",
      act: { kind: "gotit", taskId: "a1" },
    });
  });

  it.each([
    ["expenses", "Review"],
    ["leave-queue", "Review"],
    ["timesheet", "Open"],
    ["claim", "Open"],
    ["leave-declined", "Open"],
    ["profile", "Finish"],
    ["swms", "Sign on"],
    ["swms-issue", "Review"],
    ["swms-template", "Approve"],
    ["cert-wording", "Approve"],
    ["sm8-writes", "Open"],
    ["sm8-done", "Open"],
    ["sm8-booking", "Open"],
  ] as const)("(F) an alert of kind %s gets one button, %s, to where the bell sent it", (kind, verb) => {
    const rows = todoRows(input({ chips: [chip({ key: kind, kind, state: "bad", href: `/x/${kind}` })] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "alert", tone: "wrong", act: { kind: "link", label: verb, href: `/x/${kind}` } });
  });

  it("(F) an alert's state is its dot: past is red, coming is orange", () => {
    const rows = todoRows(input({ chips: [chip({ key: "w", state: "warn" }), chip({ key: "b", state: "bad", urgency: 0 })] }));
    expect(rows.map((r) => [r.key, r.tone])).toEqual([
      ["alert:b", "wrong"],
      ["alert:w", "look"],
    ]);
  });

  it("(F) a dated expiry comes once, in the list's own words, with Renew where the register renews it", () => {
    const chips = van({ regoDays: 0 });
    const rows = todoRows(input({ chips, list: listOf({ chips }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "list",
      tone: "look",
      name: "Hilux, XQG41B",
      line: "Rego runs out today",
      lineTone: true,
      act: { kind: "link", label: "Renew", href: "/dashboard/vehicles/v1" },
    });
  });

  it("carries the dated expiries itself when there is no list to carry them", () => {
    const rows = todoRows(input({ chips: van({ regoDays: -3 }), list: null }));
    expect(rows[0]).toMatchObject({ source: "alert", tone: "wrong", act: { label: "Renew", href: "/dashboard/assets" } });
  });
});

describe("the old list's rows", () => {
  it("(F) your task late or due today: a tick, and Open on the desk; the team's and later ones wait", () => {
    const list = listOf({
      tasks: [
        task({ id: "late", title: "Late one", dueDate: "2026-09-20" }),
        task({ id: "today" }),
        task({ id: "later", dueDate: "2026-10-20" }),
        task({ id: "nodate", dueDate: null }),
        task({ id: "theirs", assigneeId: "s2", assigneeName: "Lyle Irving" }),
      ],
    });
    const rows = todoRows(input({ list }));
    expect(rows.map((r) => [r.key, r.tone, r.tick])).toEqual([
      ["task:late", "wrong", "late"],
      ["task:today", "look", "today"],
    ]);
    expect(rows[0].act).toEqual({ kind: "task", label: "Open", taskId: "late" });
    expect(rows[0].line).toBe("Due Sun 20 Sept");
  });

  it("(F) a task a ServiceM8 ask made says who asked, and Reply opens the conversation", () => {
    const list = listOf({
      tasks: [task({ id: "m1", title: "Which fans for Rozelle?" })],
      mentions: [{ taskId: "m1", noteId: "n-77", asker: "Lyle", day: DAY }],
    });
    const [row] = todoRows(input({ list }));
    expect(row).toMatchObject({ name: "Which fans for Rozelle?", tick: "m1", act: { kind: "link", label: "Reply", href: deskAskHref("n-77") } });
  });

  it("(F) a won job never booked: Book in, on its page's Visits", () => {
    const list = listOf({ wins: [{ job: job(), wonOn: "2026-09-24" }] });
    const [row] = todoRows(input({ list }));
    expect(row).toMatchObject({ key: "job:j1", tone: "look", name: "Job 2380, Kingsford", act: { label: "Book in" } });
    expect((row.act as { href: string }).href).toBe("/dashboard/jobs/j1");
  });

  it("(F) a won job books in with the Visit form over Home where bookings are offered, its row on its Visits", () => {
    const list = listOf({ wins: [{ job: job(), wonOn: "2026-09-24" }], caps: { ...ALL, bookIn: true } });
    expect(todoRows(input({ list }))[0].act).toEqual({ kind: "bookIn", label: "Book in", jobUuid: "j1", href: "/dashboard/jobs/j1?tab=visits" });
  });

  it("(F) a service with no day: Book in on the visit; an issue: Open on its job", () => {
    const list = listOf({
      visits: [{ id: "v9", clientName: "Bayview Apartments", label: "annual service", dueDate: "2026-09-20" }],
      issues: [
        {
          id: "i1",
          summary: "Rooftop unit keeps tripping",
          equipmentRef: null,
          occurrences: 2,
          firstSeen: "2026-09-01",
          lastSeen: DAY,
          targetKind: "job",
          targetId: "j7",
          where: null,
        },
      ],
    });
    const rows = todoRows(input({ list }));
    expect(byKey(rows, "visit:v9")).toMatchObject({ tone: "wrong", act: { label: "Book in", href: "/dashboard/jobs?open=visit.v9" } });
    expect(byKey(rows, "issue:i1")).toMatchObject({ tone: "look", act: { label: "Open", href: "/dashboard/jobs/j7" } });
  });

  it("keeps the older won jobs as one row, Book on the board", () => {
    const wins = ["j1", "j2"].map((id, i) => ({ job: job({ remoteId: id, jobNumber: `30${i}` }), wonOn: "2026-09-01" }));
    const rows = todoRows(input({ list: listOf({ wins }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "rollup:wins", name: "2 won jobs with no day", act: { label: "Book", href: "/dashboard/schedule" } });
  });

  it("(F) drops a task's list row when the bell already has it", () => {
    const list = listOf({ tasks: [task({ id: "a1" })] });
    const rows = todoRows(input({ list, assignments: [given({ taskId: "a1" })] }));
    expect(rows.map((r) => r.key)).toEqual(["assignment:a1"]);
  });
});

describe("notices and timesheets", () => {
  it("(F) a notice you haven't read is for your information, opened on the board", () => {
    const [row] = todoRows(input({ notices: [{ id: "n1", title: "Toolbox talk", from: "Callum", day: "2026-09-25" }] }));
    expect(row).toMatchObject({ tone: "info", name: "Toolbox talk", line: "A notice from Callum, Fri 25 Sept", act: { label: "Open", href: "/dashboard/team?view=notices" } });
  });

  it("(F) timesheets sent in: Review, for an approver", () => {
    expect(todoRows(input({ timesheets: 4 }))[0]).toMatchObject({ name: "Timesheets", line: "4 to approve", act: { label: "Review", href: "/dashboard/team?view=timesheets" } });
    expect(todoRows(input({ timesheets: 0 }))).toEqual([]);
  });
});

describe("the order", () => {
  it("(F) wrong first, then a look, then for your information", () => {
    const rows = todoRows(
      input({
        notices: [{ id: "n1", title: "Toolbox talk", from: null, day: DAY }],
        timesheets: 2,
        chips: [chip({ key: "b", state: "bad" })],
        reminders: [{ taskId: "t9", title: "Ring", late: "now" }],
      }),
    );
    expect(rows.map((r) => r.tone)).toEqual(["wrong", "look", "look", "info"]);
    expect(rows.map((r) => r.key)).toEqual(["alert:b", "reminder:t9", "timesheets", "notice:n1"]);
  });
});

describe("bellCount, the sidebar's number", () => {
  it("(F) counts what the bell counted, once each, and the notices unread", () => {
    expect(
      bellCount({
        chips: [{ key: "a" }, { key: "a" }, { key: "b" }],
        reminders: [{ taskId: "t1" }],
        assignments: [given({ taskId: "t1" }), given({ taskId: "t2" })],
        notices: [{}],
      }),
    ).toBe(2 + 1 + 1 + 1);
    expect(bellCount({ chips: [], reminders: [], assignments: [], notices: [] })).toBe(0);
  });
});
