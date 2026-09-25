/* HOME'S RIGHT-HAND LIST — the placement rules and the words.

   What can go wrong here is quiet: a row in the wrong group, a count that
   counts rows instead of things, a verb that lands where the row already
   does, or a second clock deciding what is late. Each rule below is pinned
   against the day the list is placed on — Friday 25 September 2026. */

import {
  FRESH_WIN_DAYS,
  LIST_EMPTY,
  firstSentence,
  placeHomeList,
  placeList,
  type HomeList,
  type ListAlertRow,
  type ListCaps,
  type ListGroupKey,
  type ListInput,
  type ListIssueRow,
  type ListRollupRow,
  type ListRow,
  type ListTaskRow,
} from "../home-list";
import { licenceChip, orgCredentialChips, regoChip, serviceChip, vehicleChips, type ActionChip } from "../chips";
import { assembleChips } from "../assemble";
import type { DashTask } from "../tasks";
import type { JournalEntry } from "../journal";
import type { HomeIssue } from "../issues";
import { expiryDue } from "@/lib/expiry-due";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { VehicleWithFacts } from "@/components/fleet/logic";
import type { Capability } from "@/lib/permissions";

const DAY = "2026-09-25"; // a Friday
const ALL: ListCaps = { assetsAll: true, placeVisits: true, money: true, sm8: true };

const input = (over: Partial<ListInput> = {}): ListInput => ({
  day: DAY,
  tz: "Australia/Sydney",
  warnDays: 30,
  viewerStaffId: "me",
  names: { me: "Isaac", s2: "Callum", s3: "Leo" },
  tasks: [],
  journal: [],
  chips: [],
  issues: [],
  wins: [],
  visits: [],
  caps: ALL,
  ...over,
});

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  title: "Book your van in for a service",
  detail: null,
  assigneeId: "me",
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "open",
  createdBy: "me",
  // 11 am in Sydney on Tue 15 Sept
  createdAt: "2026-09-15T01:00:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at",
  ...over,
});

const entry = (id: string, day: string, taskIds: string[] = [], issueIds: string[] = []): JournalEntry => ({
  id,
  said: "Order filters for the next job",
  day,
  at: "8:42 pm",
  outcomes: [
    ...taskIds.map((t) => ({ kind: "todo" as const, text: "a task", go: { type: "task" as const, id: t } })),
    ...issueIds.map((i) => ({ kind: "kept" as const, text: "an issue", go: { type: "issue" as const, id: i } })),
  ],
  spoken: false,
  isDebrief: false,
});

const job = (over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId: "j1",
  jobNumber: "3323",
  status: "Work Order",
  clientName: "Coogee Strata",
  description: null,
  suburb: "Randwick",
  categoryName: null,
  categoryColour: null,
  date: "2026-09-20 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: { valueCents: 847_000, invoiced: null, invoicedOn: null, quoteSent: null, quoteSentOn: null, paid: false, paidOn: null },
  paidCents: 0,
  ...over,
});

const won = (id: string, jobNumber: string, suburb: string, wonOn: string) => ({
  job: job({ remoteId: id, jobNumber, suburb }),
  wonOn,
});

const issue = (over: Partial<HomeIssue> = {}): HomeIssue => ({
  id: "i1",
  summary: "Rooftop unit keeps tripping",
  equipmentRef: null,
  occurrences: 1,
  firstSeen: "2026-07-30",
  lastSeen: "2026-09-14",
  targetKind: "none",
  targetId: null,
  where: null,
  ...over,
});

const vehicle = (over: Partial<VehicleWithFacts> = {}): VehicleWithFacts => ({
  id: "v1",
  name: "Spare van",
  make: "Toyota",
  model: "Hiace",
  year: 2019,
  plate: "CY14FE",
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
});

/** A fleet van's chips as the bell builds them, counted on `today`. */
const van = (over: Partial<VehicleWithFacts>, today = DAY, href = "/dashboard/assets"): ActionChip[] =>
  vehicleChips(vehicle(over), { subject: over.name ?? "Spare van", href, warnDays: 30, today });

const licence = (typeName: string, expiryDate: string, owner: { kind: "staff" | "self"; id: string }, subject: string, today = DAY) =>
  licenceChip({ id: `${owner.id}-${typeName}`, typeName, expiryDate }, { subject, href: "/x", today, warnDays: 30, owner })!;

const group = (list: HomeList, key: ListGroupKey) => list.groups.find((g) => g.key === key);
const rows = (list: HomeList, key: ListGroupKey): ListRow[] => group(list, key)?.rows ?? [];
const titles = (list: HomeList, key: ListGroupKey) => rows(list, key).map((r) => r.title);
const find = <T extends ListRow>(list: HomeList, id: string): T => {
  for (const g of list.groups)
    for (const r of g.rows) {
      if (r.id === id) return r as T;
      if (r.kind === "rollup") for (const m of r.rows) if (m.id === id) return m as T;
    }
  throw new Error(`no row ${id}`);
};

/* ── one due date, one rule ── */

/* The rule itself is lib/expiry-due's, pinned in its own suite and read by
   the calendar too. The list only words its answer, and counts no day of its
   own: the bell's bad is Late, its warn is Today on the day itself and coming
   up before it, and its ok (no chip at all) is nowhere. */
describe("a dated chip's place is expiryDue's answer", () => {
  /** The group a chip's row landed in, a roll-up's members included. */
  const placedIn = (list: HomeList, id: string): ListGroupKey | null => {
    for (const g of list.groups)
      for (const r of g.rows) if (r.id === id || (r.kind === "rollup" && r.rows.some((m) => m.id === id))) return g.key;
    return null;
  };

  it("agrees with the bell's own chip on every day either side of the window", () => {
    for (const warnDays of [14, 30]) {
      for (let d = -40; d <= 40; d++) {
        const due = new Date(Date.parse(`${DAY}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
        const chip = licenceChip(
          { id: "l", typeName: "White Card", expiryDate: due },
          { subject: "Isaac Smith", href: "/x", today: DAY, warnDays, owner: { kind: "self", id: "me" } },
        );
        const state = expiryDue(due, DAY, warnDays)!.state;
        const where = placedIn(placeList(input({ warnDays, chips: chip ? [chip] : [] })), "chip:licence:l");
        const want = state === "ok" ? null : state === "bad" ? "late" : d === 0 ? "today" : "later";
        expect([due, warnDays, where]).toEqual([due, warnDays, want]);
        expect([due, warnDays, chip?.state ?? "ok"]).toEqual([due, warnDays, state]);
      }
    }
  });
});

/* ── tasks ── */

describe("tasks", () => {
  it("land in Late, Today, Later or No date by their due day", () => {
    const list = placeList(
      input({
        tasks: [
          task({ id: "late", title: "Late one", dueDate: "2026-09-24" }),
          task({ id: "today", title: "Today one", dueDate: DAY }),
          task({ id: "later", title: "Later one", dueDate: "2026-10-02" }),
          task({ id: "none", title: "Undated one", dueDate: null }),
        ],
      }),
    );
    expect(titles(list, "late")).toEqual(["Late one"]);
    expect(titles(list, "today")).toEqual(["Today one"]);
    expect(titles(list, "later")).toEqual(["Later one"]);
    expect(titles(list, "nodate")).toEqual(["Undated one"]);
    expect((rows(list, "late")[0] as ListTaskRow).tone).toBe("late");
    expect((rows(list, "later")[0] as ListTaskRow).tone).toBe("");
  });

  it("leave a finished task off", () => {
    expect(placeList(input({ tasks: [task({ status: "done", dueDate: DAY })] })).groups).toEqual([]);
  });

  it("come before alerts in every group", () => {
    const list = placeList(
      input({
        tasks: [task({ id: "t-late", dueDate: "2026-09-20" }), task({ id: "t-today", dueDate: DAY }), task({ id: "t-later", dueDate: "2026-10-20" })],
        chips: [...van({ regoDays: -8 }), ...van({ id: "v2", name: "Hilux", insuranceDays: 0 }), ...van({ id: "v3", name: "Trailer", ctpDays: 10 })],
        issues: [issue()],
        visits: [{ id: "vis1", clientName: "Bayview Apartments", label: "annual service", dueDate: "2026-09-20" }],
      }),
    );
    for (const g of list.groups) {
      const kinds = g.rows.map((r) => r.kind);
      const firstOther = kinds.findIndex((k) => k !== "task");
      if (firstOther >= 0) expect(kinds.slice(firstOther)).not.toContain("task");
    }
    expect(rows(list, "late").map((r) => r.kind)).toEqual(["task", "alert", "alert"]);
    expect(rows(list, "later").map((r) => r.kind)).toEqual(["task", "issue", "rollup"]);
  });

  it("sort by due day, then newest; Late puts the oldest first", () => {
    const list = placeList(
      input({
        tasks: [
          task({ id: "a", title: "Newer late", dueDate: "2026-09-20", createdAt: "2026-09-19T00:00:00Z" }),
          task({ id: "b", title: "Oldest late", dueDate: "2026-09-01" }),
          task({ id: "c", title: "Older late same day", dueDate: "2026-09-20", createdAt: "2026-09-01T00:00:00Z" }),
          task({ id: "d", title: "Newest undated", createdAt: "2026-09-24T00:00:00Z" }),
          task({ id: "e", title: "Older undated", createdAt: "2026-09-02T00:00:00Z" }),
        ],
      }),
    );
    expect(titles(list, "late")).toEqual(["Oldest late", "Newer late", "Older late same day"]);
    expect(titles(list, "nodate")).toEqual(["Newest undated", "Older undated"]);
  });

  it("take yours and the team's once each, tagging the team's with the first name", () => {
    const mine = task({ id: "t1", title: "Mine", dueDate: DAY });
    const leos = task({ id: "t2", title: "Leo's", assigneeId: "s3", assigneeName: "Leo Marsh", createdBy: "me", dueDate: DAY });
    const list = placeHomeList(
      { day: DAY, tz: "Australia/Sydney", warnDays: 30, caps: ALL, names: {}, wins: [], visits: [] },
      {
        viewerStaffId: "me",
        // the team list carries your own delegated work again
        tasks: { mine: [mine], team: [mine, leos] },
        chips: { self: [], team: [] },
        issues: [],
        journal: [],
      },
    );
    const today = rows(list, "today") as ListTaskRow[];
    expect(today.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(today.map((r) => r.who)).toEqual([null, "Leo"]);
    expect(group(list, "today")!.count).toBe(2);
  });

  /* A task you gave a colleague comes back on the team's list. It is not
     "From Isaac" to Isaac: you are never told a task came from you. */
  it("never say a task you gave a colleague came from you", () => {
    const base = { viewerStaffId: "me", chips: { self: [], team: [] }, issues: [], journal: [] };
    const reads = { day: DAY, tz: "Australia/Sydney", warnDays: 30, caps: ALL, names: { me: "Isaac", s2: "Callum" }, wins: [], visits: [] };
    const leo = { assigneeId: "s3", assigneeName: "Leo Marsh" };
    const list = placeHomeList(reads, {
      ...base,
      tasks: {
        mine: [],
        team: [
          task({ id: "gave", ...leo, createdBy: "me" }),
          task({ id: "callum-gave", ...leo, createdBy: "s2" }),
        ],
      },
    });
    expect(find<ListTaskRow>(list, "gave")).toMatchObject({ sub: "Added Tue 15 Sept.", who: "Leo" });
    expect(find<ListTaskRow>(list, "callum-gave")).toMatchObject({ sub: "From Callum, Tue 15 Sept.", who: "Leo" });
  });

  it("open the diary entry they came from, the mention that asked, or else themselves on the Tasks tab", () => {
    const list = placeList(
      input({
        tasks: [task({ id: "t-diary" }), task({ id: "t-mention" }), task({ id: "t-plain" })],
        journal: [entry("e1", "2026-08-28", ["t-diary"])],
        mentions: [{ taskId: "t-mention", noteId: "n1", asker: "Luke", day: "2026-09-21" }],
      }),
    );
    expect(find<ListTaskRow>(list, "t-diary").door).toEqual({ to: "entry", id: "e1" });
    expect(find<ListTaskRow>(list, "t-mention").door).toEqual({ to: "mention", id: "n1" });
    expect(find<ListTaskRow>(list, "t-plain").door).toEqual({ to: "task", id: "t-plain" });
  });

  it("say where they came from, or when they are due, or the hour they named", () => {
    const list = placeList(
      input({
        tasks: [
          task({ id: "late", dueDate: "2026-08-25", detail: "Wipers not working. The left one squeals too." }),
          task({ id: "at", dueDate: DAY, remindAt: "2026-09-25T06:30:00Z", remindKind: "at" }),
          task({ id: "by", dueDate: DAY, remindAt: "2026-09-25T06:30:00Z", remindKind: "by" }),
          task({ id: "diary" }),
          task({ id: "mention" }),
          task({ id: "from", assigneeId: "me", createdBy: "s2", createdAt: "2026-09-21T02:00:00Z" }),
          task({ id: "added" }),
          task({ id: "later", dueDate: "2026-10-20" }),
        ],
        journal: [entry("e1", "2026-08-28", ["diary"])],
        mentions: [{ taskId: "mention", noteId: "n1", asker: "Luke", day: "2026-09-21" }],
      }),
    );
    const sub = (id: string) => find<ListTaskRow>(list, id).sub;
    expect(sub("late")).toBe("Due Tue 25 Aug. Wipers not working.");
    expect(sub("at")).toBe("At 4:30 pm.");
    expect(sub("by")).toBe("By 4:30 pm.");
    expect(sub("diary")).toBe("Your diary, Fri 28 Aug.");
    expect(sub("mention")).toBe("Luke asked you, Mon 21 Sept.");
    expect(sub("from")).toBe("From Callum, Mon 21 Sept.");
    expect(sub("added")).toBe("Added Tue 15 Sept.");
    expect(sub("later")).toBe("Due Tue 20 Oct.");
  });

  it("date an added task by the workspace's clock, not the server's", () => {
    // 10:30 pm in Perth on Mon 14 Sept is already Tuesday in Sydney
    const t = task({ createdAt: "2026-09-14T14:30:00Z" });
    expect(find<ListTaskRow>(placeList(input({ tasks: [t], tz: "Australia/Perth" })), "t1").sub).toBe("Added Mon 14 Sept.");
    expect(find<ListTaskRow>(placeList(input({ tasks: [t], tz: "Australia/Sydney" })), "t1").sub).toBe("Added Tue 15 Sept.");
  });
});

describe("firstSentence", () => {
  it("takes the first sentence, adds a stop where there is none, and cuts at 60", () => {
    expect(firstSentence("Wipers not working. Left one squeals.")).toBe("Wipers not working.");
    expect(firstSentence("  Wipers\nnot working ")).toBe("Wipers not working.");
    expect(firstSentence(null)).toBe("");
    const long = "a".repeat(80);
    expect(firstSentence(long)).toBe(`${"a".repeat(59)}…`);
    expect(firstSentence(long).length).toBe(60);
  });
});

/* ── the bell's dated chips ── */

describe("expiries", () => {
  /* A PERTH EVENING. The bell counts on Sydney's date, already Saturday; the
     workspace is still on Friday. A licence that runs out on Friday is `bad`
     to the bell (a day gone) and today's to the list, which places by the
     day, not by the state. */
  it("are placed by their day against the list's day, never by the bell's state", () => {
    const sydneyTomorrow = "2026-09-26";
    const chip = licence("White Card", DAY, { kind: "self", id: "me" }, "Isaac Smith", sydneyTomorrow);
    expect(chip.state).toBe("bad");
    const list = placeList(input({ chips: [chip] }));
    expect(titles(list, "today")).toEqual(["Your White Card"]);
    expect(group(list, "late")).toBeUndefined();
    expect(find<ListAlertRow>(list, "chip:licence:me-White Card").sub).toBe("Runs out today.");
  });

  it("show nowhere past the window, and inside it roll up as coming up", () => {
    const list = placeList(
      input({
        warnDays: 14,
        chips: [
          licence("White Card", "2026-10-05", { kind: "staff", id: "s2" }, "Callum Reid"),
          // built on a 30-day window, placed on the org's 14: nowhere
          licence("Forklift", "2026-10-20", { kind: "staff", id: "s3" }, "Leo Marsh"),
        ],
      }),
    );
    const up = rows(list, "later")[0] as ListRollupRow;
    expect(up).toMatchObject({ kind: "rollup", title: "1 coming up", count: 1 });
    expect(up.rows.map((r) => r.title)).toEqual(["White Card, Callum Reid"]);
  });

  it("name three when coming up, and say how many more", () => {
    const list = placeList(
      input({
        chips: [
          ...van({ id: "tr", name: "Trailer", plate: "", regoDays: 5 }),
          ...van({ id: "hx", name: "Hilux", plate: "", serviceIntervalKm: null, serviceDays: 9 }),
          ...orgCredentialChips(
            [{ id: "pl", kind: "insurance", name: "Public liability", issuer: "QBE", expiryDate: "2026-10-10" }],
            { href: "/o", today: DAY, warnDays: 30 },
          ),
          licence("White Card", "2026-10-12", { kind: "self", id: "me" }, "Isaac Smith"),
          licence("Forklift", "2026-10-14", { kind: "staff", id: "s3" }, "Leo Marsh"),
        ],
      }),
    );
    const up = rows(list, "later")[0] as ListRollupRow;
    expect(up.title).toBe("5 coming up");
    expect(up.sub).toBe("Trailer rego, Hilux service, public liability, and 2 more.");
    expect(up.count).toBe(5);
    expect(group(list, "later")!.count).toBe(5);

    const three = placeList(input({ chips: [...van({ id: "tr", name: "Trailer", plate: "", regoDays: 5 })] }));
    expect((rows(three, "later")[0] as ListRollupRow).sub).toBe("Trailer rego.");
  });

  it("keep a business paper's capitals when its first word is an acronym", () => {
    const chips = orgCredentialChips(
      [{ id: "arc", kind: "licence", name: "ARC authorisation", issuer: null, expiryDate: "2026-10-10" }],
      { href: "/o", today: DAY, warnDays: 30 },
    );
    expect((rows(placeList(input({ chips })), "later")[0] as ListRollupRow).sub).toBe("ARC authorisation.");
  });

  it("word a vehicle's papers, a person's and the business's", () => {
    const list = placeList(
      input({
        chips: [
          ...van({ regoDays: -8 }),
          ...van({ id: "v2", name: "Hilux", plate: "EVD72G", insuranceDays: 0 }),
          ...van({ id: "v3", name: "Ute", plate: "", ctpDays: 25 }),
          ...van({ id: "v4", name: "Canter", plate: "", serviceIntervalKm: null, serviceDays: -3 }),
          ...van({ id: "v5", name: "Crafter", plate: "", odometer: 99_200 }),
          ...van({ id: "v6", name: "Transit", plate: "", odometer: 97_200 }),
          licence("White Card", "2026-09-14", { kind: "staff", id: "s3" }, "Luke Ingold"),
          licence("White Card", "2026-10-20", { kind: "self", id: "me" }, "Isaac Smith"),
          ...orgCredentialChips(
            [{ id: "pl", kind: "insurance", name: "Public liability", issuer: "QBE", expiryDate: "2026-11-10" }],
            { href: "/o", today: DAY, warnDays: 60 },
          ),
        ],
        warnDays: 60,
      }),
    );
    const alert = (id: string) => find<ListAlertRow>(list, id);
    expect(alert("chip:rego:v1")).toMatchObject({ title: "Spare van, CY14FE", sub: "Rego ran out Thu 17 Sept.", dot: "late", tone: "late" });
    expect(alert("chip:insurance:v2")).toMatchObject({ title: "Hilux, EVD72G", sub: "Insurance runs out today.", dot: "today" });
    expect(alert("chip:ctp:v3")).toMatchObject({ title: "Ute", sub: "Green slip runs out Tue 20 Oct.", dot: "quiet" });
    expect(alert("chip:service:v4").sub).toBe("Service was due Tue 22 Sept.");
    expect(alert("chip:service:v5").sub).toBe("Service overdue 1,200 km.");
    expect(alert("chip:service:v6").sub).toBe("Service due in 800 km.");
    expect(alert("chip:licence:s3-White Card")).toMatchObject({ title: "White Card, Luke Ingold", sub: "Ran out Mon 14 Sept." });
    expect(alert("chip:licence:me-White Card")).toMatchObject({ title: "Your White Card", sub: "Runs out Tue 20 Oct." });
    expect(alert("chip:org-cred:pl")).toMatchObject({ title: "Public liability", sub: "Runs out Tue 10 Nov. QBE." });
  });

  it("place a service judged by distance by its state: overdue is late, near is coming up", () => {
    const list = placeList(
      input({ chips: [...van({ id: "a", name: "Crafter", odometer: 99_200 }), ...van({ id: "b", name: "Transit", odometer: 97_200 })] }),
    );
    expect(rows(list, "late").map((r) => r.id)).toEqual(["chip:service:a"]);
    expect((rows(list, "later")[0] as ListRollupRow).rows.map((r) => r.id)).toEqual(["chip:service:b"]);
  });

  it("carry only the kinds that count down to a date", () => {
    const chips = assembleChips(
      {
        isOwner: true,
        today: DAY,
        warnDays: 30,
        viewerStaffId: "me",
        self: null,
        selfVehicle: null,
        teamPeople: [],
        fleet: [],
        orgCredentials: [],
        pendingClaims: 3,
        pendingLeave: 1,
        ownSheet: { status: "sent_back", periodStart: "2026-09-14", periodLabel: "14 – 20 Sept" },
        ownDeclinedClaims: [],
        ownDeclinedLeave: [],
        swmsTemplatePending: true,
        sm8Stuck: { reason: "reconnect", waiting: 2 },
      },
      new Set<Capability>(["approvals", "team"]),
    );
    expect(chips.self.length + chips.team.length).toBeGreaterThan(0);
    expect(placeList(input({ chips: [...chips.self, ...chips.team] })).groups).toEqual([]);
  });

  /* The switch for the bell's other kinds (spec question 1): a kind off the
     list stays off it even when it carries a day. */
  it("leave a kind off the list even when it carries a day", () => {
    const dated: ActionChip = {
      key: "claim-declined:c1",
      kind: "claim",
      state: "bad",
      label: "Expense claim declined",
      subject: "Fittings, $10",
      href: "/dashboard/my-expenses",
      urgency: 1,
      due: "2026-09-24",
      ref: null,
    };
    expect(placeList(input({ chips: [dated] })).groups).toEqual([]);
    expect(titles(placeList(input({ chips: [{ ...dated, kind: "licence" }] })), "late")).toEqual(["Fittings, $10"]);
  });

  it("open the vehicle on the register with Renew or Log service, for whoever holds it", () => {
    const list = placeList(
      input({
        chips: [
          ...van({ regoDays: -8 }),
          ...van({ id: "v2", name: "Hilux", insuranceDays: -1, ctpDays: -1 }),
          ...van({ id: "v3", name: "Canter", odometer: 99_200 }),
        ],
      }),
    );
    expect(find<ListAlertRow>(list, "chip:rego:v1")).toMatchObject({
      door: { to: "href", href: "/dashboard/assets?v=v1" },
      verb: { label: "Renew", door: { to: "href", href: "/dashboard/assets?v=v1&screen=rego" } },
    });
    expect(find<ListAlertRow>(list, "chip:insurance:v2").verb).toMatchObject({
      label: "Renew",
      door: { href: "/dashboard/assets?v=v2&screen=insurance" },
    });
    expect(find<ListAlertRow>(list, "chip:ctp:v2").verb).toMatchObject({ label: "Renew", door: { href: "/dashboard/assets?v=v2&screen=ctp" } });
    expect(find<ListAlertRow>(list, "chip:service:v3").verb).toMatchObject({
      label: "Log service",
      door: { href: "/dashboard/assets?v=v3&screen=add:service" },
    });
  });

  it("open your own van on My vehicle, with no verb, for someone without the register", () => {
    const mine = vehicleChips(vehicle({ regoDays: -8 }), { subject: "Spare van", href: "/dashboard/my-vehicle", warnDays: 30, today: DAY });
    const list = placeList(input({ chips: mine, caps: { ...ALL, assetsAll: false } }));
    expect(find<ListAlertRow>(list, "chip:rego:v1")).toMatchObject({
      door: { to: "href", href: "/dashboard/my-vehicle" },
      verb: null,
    });
  });

  it("offer no verb where it would land on the door: a person's paper, the business's", () => {
    const list = placeList(
      input({
        chips: [
          licence("White Card", "2026-09-14", { kind: "staff", id: "s3" }, "Luke Ingold"),
          licence("White Card", "2026-09-20", { kind: "self", id: "me" }, "Isaac Smith"),
          ...orgCredentialChips(
            [{ id: "pl", kind: "insurance", name: "Public liability", issuer: null, expiryDate: "2026-09-01" }],
            { href: "/o", today: DAY, warnDays: 30 },
          ),
        ],
      }),
    );
    expect(find<ListAlertRow>(list, "chip:licence:s3-White Card")).toMatchObject({
      door: { to: "href", href: "/dashboard/team/s3?sec=licences" },
      verb: null,
    });
    expect(find<ListAlertRow>(list, "chip:licence:me-White Card")).toMatchObject({
      door: { to: "href", href: "/dashboard/profile?sec=licences" },
      verb: null,
    });
    expect(find<ListAlertRow>(list, "chip:org-cred:pl")).toMatchObject({
      door: { to: "href", href: "/dashboard/admin/organization?sec=credentials" },
      verb: null,
      sub: "Ran out Tue 1 Sept.",
    });
  });

  it("open a visa on the work rights section", () => {
    const chips = assembleChips(
      {
        isOwner: false,
        today: DAY,
        warnDays: 30,
        viewerStaffId: "me",
        self: {
          staffId: "me",
          name: "Isaac Smith",
          licences: [],
          workRights: { status: "Visa holder", visaType: "482 TSS", visaExpiry: "2026-09-20", vevoCheckedAt: "2026-01-01" },
        },
        selfVehicle: null,
        teamPeople: [],
        fleet: [],
        orgCredentials: [],
        pendingClaims: 0,
        pendingLeave: 0,
        ownSheet: null,
        ownDeclinedClaims: [],
        ownDeclinedLeave: [],
      },
      new Set<Capability>(),
    );
    const list = placeList(input({ chips: chips.self }));
    expect(find<ListAlertRow>(list, "chip:work-rights-visa:me")).toMatchObject({
      title: "Your 482 TSS",
      door: { to: "href", href: "/dashboard/profile?sec=workrights" },
    });
  });
});

/* ── won jobs, never booked ── */

describe("won jobs", () => {
  it("give a job won within two days its own row under Today; the rest roll up to book", () => {
    const list = placeList(
      input({
        wins: [
          won("fresh", "3323", "Randwick", "2026-09-23"),
          won("old", "3050", "Oatley", "2026-07-20"),
          won("mid", "3210", "Mosman", "2026-09-04"),
        ],
      }),
    );
    expect(FRESH_WIN_DAYS).toBe(2);
    expect(find<ListAlertRow>(list, "job:fresh")).toMatchObject({
      title: "Job 3323, Randwick",
      sub: "Won 2 days ago. No day yet.",
      figure: "$8,470",
      dot: "today",
      door: { to: "job", remoteId: "fresh" },
      verb: { label: "Book in", door: { to: "href", href: "/dashboard/workboard?job=fresh" } },
    });
    const roll = rows(list, "tobook")[0] as ListRollupRow;
    expect(roll).toMatchObject({
      title: "2 more won jobs with no day",
      sub: "Oldest 3050 Oatley, won 2 months ago.",
      strong: "3050 Oatley",
      verb: { label: "Book", door: { to: "href", href: "/dashboard/workboard" } },
      count: 2,
    });
    // oldest first inside, each its own door and Book in
    expect(roll.rows.map((r) => r.id)).toEqual(["job:old", "job:mid"]);
    expect(roll.rows[1]).toMatchObject({ sub: "Won 3 weeks ago.", verb: { label: "Book in" } });
    // the card opens on the same mirror row
    expect(list.jobs.map((j) => j.remoteId).sort()).toEqual(["fresh", "mid", "old"]);
  });

  it("roll up a job won three days ago; only the last two days are Today's", () => {
    const list = placeList(input({ wins: [won("two", "1", "A", "2026-09-23"), won("three", "2", "B", "2026-09-22")] }));
    expect(rows(list, "today").map((r) => r.id)).toEqual(["job:two"]);
    expect(find<ListRollupRow>(list, "rollup:wins").rows.map((r) => r.id)).toEqual(["job:three"]);
  });

  it("say 'more' only when Today holds a won job, and 'job' for one", () => {
    const list = placeList(input({ wins: [won("old", "3050", "Oatley", "2026-07-20")] }));
    expect((rows(list, "tobook")[0] as ListRollupRow).title).toBe("1 won job with no day");
    expect(group(list, "today")).toBeUndefined();
  });

  it("word today and yesterday as words", () => {
    const list = placeList(input({ wins: [won("a", "1", "A", DAY), won("b", "2", "B", "2026-09-24")] }));
    expect(find<ListAlertRow>(list, "job:a").sub).toBe("Won today. No day yet.");
    expect(find<ListAlertRow>(list, "job:b").sub).toBe("Won yesterday. No day yet.");
    // the newest first under Today
    expect(rows(list, "today").map((r) => r.id)).toEqual(["job:a", "job:b"]);
  });

  it("drop a job won more than 90 days ago", () => {
    const list = placeList(input({ wins: [won("ancient", "1", "A", "2026-06-26"), won("edge", "2", "B", "2026-06-27")] }));
    expect(find<ListRollupRow>(list, "rollup:wins").rows.map((r) => r.id)).toEqual(["job:edge"]);
  });

  it("show no figure without the money grant", () => {
    const list = placeList(input({ wins: [won("a", "1", "A", DAY)], caps: { ...ALL, money: false } }));
    expect(find<ListAlertRow>(list, "job:a").figure).toBeNull();
  });

  it("count the jobs, not the row: Jobs to book 17", () => {
    const wins = Array.from({ length: 17 }, (_, i) => won(`j${i}`, `${3000 + i}`, "Oatley", "2026-08-01"));
    const list = placeList(input({ wins }));
    expect(group(list, "tobook")).toMatchObject({ title: "Jobs to book", count: 17 });
    expect(rows(list, "tobook")).toHaveLength(1);
  });
});

/* ── visits with no day ── */

describe("services with no day", () => {
  const visit = (id: string, dueDate: string) => ({ id, clientName: "Bayview Apartments", label: "annual service", dueDate });

  it("are late, today, or rolled up to book — each with Book in for whoever can place them", () => {
    const list = placeList(input({ visits: [visit("a", "2026-09-14"), visit("b", DAY), visit("c", "2026-10-05"), visit("d", "2026-10-12")] }));
    expect(find<ListAlertRow>(list, "visit:a")).toMatchObject({
      title: "Bayview Apartments, annual service",
      sub: "Was due Mon 14 Sept. No day yet.",
      dot: "late",
      door: { to: "href", href: "/dashboard/workboard?visit=a" },
      verb: { label: "Book in", placeVisit: "a" },
    });
    expect(find<ListAlertRow>(list, "visit:b").sub).toBe("Due today. No day yet.");
    const roll = find<ListRollupRow>(list, "rollup:visits");
    expect(roll).toMatchObject({ title: "2 services due with no day", sub: "Soonest Bayview Apartments, due Mon 5 Oct.", verb: null, count: 2 });
    expect(roll.rows[0].title).toBe("Bayview Apartments, annual service");
    expect((roll.rows[0] as ListAlertRow).sub).toBe("Due Mon 5 Oct. No day yet.");
  });

  it("offer no Book in without the board's manage grant", () => {
    const list = placeList(input({ visits: [visit("a", "2026-09-14")], caps: { ...ALL, placeVisits: false } }));
    expect(find<ListAlertRow>(list, "visit:a").verb).toBeNull();
  });

  it("leave out a visit past the board's horizon", () => {
    expect(placeList(input({ visits: [visit("far", "2026-11-25")] })).groups).toEqual([]);
  });
});

/* ── issues ── */

describe("issues", () => {
  it("sit under Today when seen today, and otherwise in Later after the tasks and before the roll-up", () => {
    const list = placeList(
      input({
        tasks: [task({ id: "t-later", dueDate: "2026-10-20" })],
        chips: [...van({ ctpDays: 10 })],
        issues: [
          issue({ id: "new", summary: "New one", firstSeen: DAY, lastSeen: DAY }),
          issue({ id: "again", summary: "Again", firstSeen: "2026-09-01", lastSeen: DAY }),
          issue({ id: "old", summary: "Rooftop unit keeps tripping", occurrences: 3 }),
        ],
      }),
    );
    expect(find<ListIssueRow>(list, "issue:new")).toMatchObject({ sub: "New today.", dot: "today" });
    expect(find<ListIssueRow>(list, "issue:again").sub).toBe("Seen again today.");
    expect(titles(list, "today")).toEqual(["New one", "Again"]);
    expect(rows(list, "later").map((r) => r.id)).toEqual(["t-later", "issue:old", "rollup:coming"]);
    expect(find<ListIssueRow>(list, "issue:old")).toMatchObject({ sub: "Open since Thu 30 July. Seen 3 times.", dot: "quiet" });
  });

  it("say once as nothing extra, and point at the diary entry that raised them", () => {
    const list = placeList(input({ issues: [issue()], journal: [entry("e9", "2026-07-30", [], ["i1"])] }));
    expect(find<ListIssueRow>(list, "issue:i1")).toMatchObject({ sub: "Open since Thu 30 July.", entryId: "e9" });
  });

  it("offer Create job only on a ServiceM8 job, opening its card", () => {
    const list = placeList(
      input({
        issues: [
          issue({ id: "onjob", targetKind: "job", targetId: "sm8-uuid" }),
          issue({ id: "onvisit", targetKind: "visit", targetId: "v1" }),
          issue({ id: "none" }),
        ],
      }),
    );
    expect(find<ListIssueRow>(list, "issue:onjob").verb).toEqual({ label: "Create job", door: { to: "job", remoteId: "sm8-uuid" } });
    expect(find<ListIssueRow>(list, "issue:onvisit").verb).toBeNull();
    expect(find<ListIssueRow>(list, "issue:none").verb).toBeNull();
  });
});

/* ── without ServiceM8 ── */

describe("a workspace without ServiceM8", () => {
  it("runs on HeyTiff's own data: no won jobs, no money, no Create job, and services still roll up", () => {
    const list = placeList(
      input({
        caps: { ...ALL, sm8: false },
        wins: [won("fresh", "3323", "Randwick", "2026-09-23"), won("old", "3050", "Oatley", "2026-08-01")],
        issues: [issue({ id: "onjob", targetKind: "job", targetId: "sm8-uuid" })],
        visits: [
          { id: "a", clientName: "Bayview Apartments", label: "annual service", dueDate: "2026-10-05" },
          { id: "b", clientName: "Northgate", label: "quarterly clean", dueDate: "2026-10-09" },
          { id: "c", clientName: "Harbour St", label: null, dueDate: "2026-10-19" },
        ],
      }),
    );
    expect(list.jobs).toEqual([]);
    expect(list.groups.flatMap((g) => g.rows).some((r) => r.id.startsWith("job:") || r.id === "rollup:wins")).toBe(false);
    expect(find<ListIssueRow>(list, "issue:onjob").verb).toBeNull();
    expect(rows(list, "tobook").map((r) => r.title)).toEqual(["3 services due with no day"]);
  });
});

/* ── the whole ── */

describe("the list as a whole", () => {
  it("drops empty groups, and an all-clear list has none", () => {
    const list = placeList(input());
    expect(list).toEqual({ day: DAY, groups: [], jobs: [] });
    expect(LIST_EMPTY).toBe("Nothing late, due today or coming up.");
    const one = placeList(input({ tasks: [task({ dueDate: DAY })] }));
    expect(one.groups.map((g) => g.key)).toEqual(["today"]);
  });

  it("keeps the five groups in order, with their titles", () => {
    const list = placeList(
      input({
        tasks: [task({ id: "a", dueDate: "2026-10-20" }), task({ id: "b" }), task({ id: "c", dueDate: DAY }), task({ id: "d", dueDate: "2026-09-01" })],
        wins: [won("old", "3050", "Oatley", "2026-08-01")],
      }),
    );
    expect(list.groups.map((g) => [g.key, g.title])).toEqual([
      ["late", "Late"],
      ["today", "Today"],
      ["tobook", "Jobs to book"],
      ["nodate", "No date"],
      ["later", "Later"],
    ]);
  });

  it("counts things, not rows", () => {
    const list = placeList(
      input({
        tasks: [task({ id: "t", dueDate: "2026-10-20" })],
        issues: [issue()],
        chips: [...van({ id: "a", name: "A", ctpDays: 10 }), ...van({ id: "b", name: "B", ctpDays: 11 })],
      }),
    );
    // a task, an issue and a roll-up of two: four things on three rows
    expect(rows(list, "later")).toHaveLength(3);
    expect(group(list, "later")!.count).toBe(4);
  });

  it("places the page's own data as it stands", () => {
    const list = placeHomeList(
      { day: DAY, tz: null, warnDays: 30, caps: ALL, names: { s2: "Callum" }, wins: [], visits: [] },
      {
        viewerStaffId: "me",
        tasks: { mine: [task({ id: "m", createdBy: "s2" })], team: null },
        chips: { self: [...van({ regoDays: -8 }, DAY, "/dashboard/my-vehicle")], team: [regoChip(vehicle({ id: "v9", regoDays: 3 }), { subject: "Nine", href: "/a", warnDays: 30, today: DAY })!] },
        issues: [issue()],
        journal: [],
      },
    );
    expect(find<ListTaskRow>(list, "m").sub).toBe("From Callum, Tue 15 Sept.");
    expect(rows(list, "late").map((r) => r.id)).toEqual(["chip:rego:v1"]);
    expect(find<ListRollupRow>(list, "rollup:coming").rows.map((r) => r.id)).toEqual(["chip:rego:v9"]);
    expect(find<ListIssueRow>(list, "issue:i1")).toBeTruthy();
    // service chips are built too; none is due here
    expect(serviceChip(vehicle(), { subject: "x", href: "/x", warnDays: 30, today: DAY })).toBeNull();
  });
});
