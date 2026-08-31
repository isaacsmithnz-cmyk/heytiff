import {
  buildJobStory,
  emptyStoryLine,
  filterStory,
  groupStoryDays,
  stampDay,
  storyEventLabel,
  storyLineOf,
  storySince,
  storyStamp,
  STORY_PHOTOS_SHOWN,
  type StoryEntry,
  type StoryInputs,
} from "../job-story";
import type { FamilyClaim, FamilyMoney } from "../job-family";
import type { JobNoteEntry } from "../all-jobs-query";
import type { JobMediaItem } from "../job-media";
import type { JobPaymentEntry } from "../job-ledger";

/* The diary's merge is the one door two surfaces read through — the feed
   renders these entries and the summary is written from them — so the rules
   pinned here are the rules of both: order, gating, sweeping, clustering,
   and the stamp that decides when the summary is allowed to cost a cent. */

const note = (over: Partial<JobNoteEntry> = {}): JobNoteEntry => ({
  remoteId: "n-1",
  text: "Need to do drain kit on outdoor in carpark",
  writtenOn: "2026-06-12",
  writtenAt: "2026-06-12 14:31:00",
  writtenBy: "David Hann",
  actionRequired: false,
  fromClaim: null,
  ...over,
});

const photo = (over: Partial<JobMediaItem> = {}): JobMediaItem => ({
  remoteId: "m-1",
  name: "IMG_0001.jpg",
  fileType: "jpg",
  kind: "photo",
  width: null,
  height: null,
  origin: null,
  takenAt: "2026-06-12 09:00:00",
  url: null,
  fromClaim: null,
  ...over,
});

const payment = (over: Partial<JobPaymentEntry> = {}): JobPaymentEntry => ({
  remoteId: "p-1",
  amountCents: 940211,
  method: "Stripe",
  note: null,
  takenOn: "2026-04-02",
  takenAt: "2026-04-02 10:12:00",
  isDeposit: true,
  takenBy: "Luke Ingold",
  ...over,
});

const claim = (over: Partial<FamilyClaim> = {}): FamilyClaim => ({
  remoteId: "c-1",
  jobNumber: "2380A",
  index: 1,
  stage: "Deposit",
  amountCents: 940211,
  basis: "inc",
  percent: 30,
  raisedOn: "2026-03-30",
  paidCents: 940211,
  paidOn: "2026-04-02",
  state: "paid",
  dueOn: null,
  overdueDays: null,
  ...over,
});

const familyOf = (claims: FamilyClaim[]): FamilyMoney => ({
  memberCount: claims.length,
  isFamily: true,
  claims,
  valueCents: 3134035,
  basis: "inc",
  mixedBasis: false,
  unknownClaim: false,
  invoicedCents: 3134035,
  toComeCents: 0,
  paidCents: 3134035,
  awaitingCents: 0,
});

const detail = (over: Partial<NonNullable<StoryInputs["detail"]>> = {}): StoryInputs["detail"] => ({
  date: "2026-01-12",
  quoteDate: null,
  workOrderDate: null,
  completionDate: null,
  visits: [],
  checklist: [],
  designs: [],
  ...over,
});

const inputs = (over: Partial<StoryInputs> = {}): StoryInputs => ({
  detail: detail(),
  notes: [],
  ourNotes: [],
  ledger: null,
  family: null,
  invoicedOn: null,
  media: [],
  picklist: [],
  timezone: "Australia/Sydney",
  ...over,
});

describe("buildJobStory — order", () => {
  it("reads newest first, day-grouped, with timed entries by clock inside a day", () => {
    const story = buildJobStory(
      inputs({
        notes: [
          note({ remoteId: "n-old", writtenAt: "2026-06-12 08:00:00", writtenOn: "2026-06-12" }),
          note({ remoteId: "n-new", writtenAt: "2026-06-12 16:00:00", writtenOn: "2026-06-12" }),
        ],
        detail: detail({ visits: [{ day: "2026-06-12", minutes: 260, crew: [{ name: "David Hann", title: "HVAC" }] }] }),
      })
    );
    // one day: the later note, the earlier note, then the date-only visit —
    // no: the visit is date-only and visits LEAD the date-only rank, but
    // timed entries come first inside the day.
    expect(story.map((e) => e.key)).toEqual([
      "note:n-new",
      "note:n-old",
      "visit:2026-06-12",
      "milestone:raised",
    ]);
  });

  it("sinks date-only facts in rank: visit, photos, tick, claim, milestone last", () => {
    const story = buildJobStory(
      inputs({
        detail: detail({
          date: "2026-08-21",
          completionDate: "2026-08-21",
          visits: [{ day: "2026-08-21", minutes: 260, crew: [] }],
          checklist: [
            {
              name: "Isolate old unit",
              itemType: "Todo",
              section: null,
              done: true,
              doneOn: "2026-08-21",
              doneAt: null,
              doneBy: "Jake T",
            },
          ],
        }),
        media: [photo({ takenAt: "2026-08-21 10:00:00" })],
        family: familyOf([claim({ raisedOn: "2026-08-21", paidOn: null, state: "awaiting" })]),
        ledger: { materials: [], payments: [] },
      })
    );
    expect(story.map((e) => e.kind)).toEqual([
      "visit",
      "photos",
      "tick",
      "claim",
      "milestone", // Job completed
      "milestone", // Job raised — same day here, stable by key
    ]);
  });

  it("day groups arrive newest day first and groupStoryDays keeps them whole", () => {
    const story = buildJobStory(
      inputs({
        notes: [
          note({ remoteId: "a", writtenOn: "2026-05-15", writtenAt: "2026-05-15 09:00:00" }),
          note({ remoteId: "b", writtenOn: "2026-06-12", writtenAt: "2026-06-12 09:00:00" }),
        ],
      })
    );
    const days = groupStoryDays(story);
    expect(days.map((d) => d.day)).toEqual(["2026-06-12", "2026-05-15", "2026-01-12"]);
  });
});

describe("buildJobStory — notes", () => {
  it("sweeps ServiceM8's partial-invoice stubs and keeps real clone notes, badged", () => {
    const story = buildJobStory(
      inputs({
        notes: [
          note({
            remoteId: "stub",
            text: "This job was created as a Partial Invoice for Job #2380.",
            fromClaim: "2380B",
          }),
          note({ remoteId: "real", text: "Grille 1060 x 175 to order", fromClaim: "2380A" }),
        ],
      })
    );
    const notes = story.filter((e) => e.kind === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ key: "note:real", fromClaim: "2380A" });
  });

  it("carries the action-required flag", () => {
    const story = buildJobStory(inputs({ notes: [note({ actionRequired: true })] }));
    expect(story.find((e) => e.kind === "note")).toMatchObject({ actionRequired: true });
  });

  /* OUR OWN NOTES — a ServiceM8 job has no notes column we may write, so the
     pen's words live in `workboard_notes` and arrive here as the same kind of
     entry, told apart only by their origin. */
  it("merges HeyTiff's own notes into the one stream, in time order", () => {
    const story = buildJobStory(
      inputs({
        notes: [note({ writtenAt: "2026-06-12 09:00:00" })],
        ourNotes: [
          {
            id: "our-1",
            text: "Ring the builder about roof access",
            at: "2026-06-12T04:31:00.000Z",
            author: "Isaac Smith",
          },
        ],
        timezone: "Australia/Sydney",
      })
    );
    const notes = story.filter((e) => e.kind === "note");
    /* 04:31Z is 14:31 in Sydney — OUR stamps are instants in our own columns
       and pass through the zone; ServiceM8's are already naive local. */
    expect(notes.map((n) => (n.kind === "note" ? [n.origin, n.at] : null))).toEqual([
      ["heytiff", "2026-06-12 14:31"],
      ["servicem8", "2026-06-12 09:00:00"],
    ]);
  });

  it("keys ours by our row id, so the diary can take one back off", () => {
    const story = buildJobStory(
      inputs({
        notes: [],
        ourNotes: [
          { id: "our-9", text: "Drain kit still to go on", at: "2026-06-12T04:31:00.000Z", author: null },
        ],
        timezone: "Australia/Sydney",
      })
    );
    expect(story[0]).toMatchObject({ key: "ournote:our-9", id: "our-9", origin: "heytiff" });
  });

  it("gives ServiceM8's notes no id — they are in a mirror we may not touch", () => {
    const story = buildJobStory(inputs({ notes: [note()] }));
    expect(story.find((e) => e.kind === "note")).toMatchObject({ origin: "servicem8", id: null });
  });
});

describe("buildJobStory — photos", () => {
  it("clusters per day, shows four, counts the rest into +N", () => {
    const media = Array.from({ length: 7 }, (_, i) =>
      photo({ remoteId: `m-${i}`, takenAt: `2026-06-12 0${Math.min(9, 9 - 0)}:0${i}:00` })
    );
    const story = buildJobStory(inputs({ media }));
    const cluster = story.find((e) => e.kind === "photos");
    expect(cluster).toMatchObject({ count: 7, day: "2026-06-12" });
    if (cluster?.kind === "photos") expect(cluster.shown).toHaveLength(STORY_PHOTOS_SHOWN);
  });

  it("only photos cluster — documents and videos stay out of the feed", () => {
    const story = buildJobStory(
      inputs({
        media: [
          photo({ remoteId: "d", kind: "document", name: "Invoice.pdf" }),
          photo({ remoteId: "v", kind: "video", name: "site.mp4" }),
        ],
      })
    );
    expect(story.some((e) => e.kind === "photos")).toBe(false);
  });
});

describe("buildJobStory — money is whoever sent it", () => {
  it("with no ledger and no family there are no money events at all", () => {
    const story = buildJobStory(
      inputs({ ledger: null, family: null, invoicedOn: null })
    );
    expect(story.some((e) => e.kind === "claim" || e.kind === "payment")).toBe(false);
  });

  it("a family contributes raised and settled claim events, and suppresses raw payments", () => {
    const story = buildJobStory(
      inputs({
        family: familyOf([
          claim(),
          claim({
            remoteId: "c-3",
            jobNumber: "2380",
            index: 3,
            stage: "Final",
            amountCents: 626806,
            raisedOn: "2026-08-21",
            paidOn: "2026-08-22",
          }),
        ]),
        /* the parent's own payment rows — already the final claim settling */
        ledger: { materials: [], payments: [payment({ remoteId: "p-parent" })] },
      })
    );
    expect(story.filter((e) => e.kind === "payment")).toHaveLength(0);
    const claims = story.filter((e) => e.kind === "claim");
    expect(claims.map((e) => e.kind === "claim" && `${e.title} ${e.event}`)).toEqual([
      "Payment 3 — Final settled",
      "Payment 3 — Final raised",
      "Payment 1 — Deposit settled",
      "Payment 1 — Deposit raised",
    ]);
  });

  it("a part-paid claim raises but never settles — the feed passes no verdict", () => {
    const story = buildJobStory(
      inputs({
        family: familyOf([claim({ state: "part", paidOn: "2026-04-02" })]),
      })
    );
    const events = story.filter((e) => e.kind === "claim");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "raised" });
  });

  it("a plain job gets payment rows and the invoice milestone", () => {
    const story = buildJobStory(
      inputs({
        ledger: { materials: [], payments: [payment()] },
        invoicedOn: "2026-04-01",
      })
    );
    expect(story.some((e) => e.kind === "payment")).toBe(true);
    expect(
      story.some((e) => e.kind === "milestone" && e.label === "Invoice raised")
    ).toBe(true);
  });

  it("the last claim by index is the final one", () => {
    const story = buildJobStory(
      inputs({
        family: familyOf([
          claim({ remoteId: "c-2", index: 2, stage: "Final", paidOn: "2026-08-22" }),
          claim(),
        ]),
      })
    );
    const settled = story.filter((e) => e.kind === "claim" && e.event === "settled");
    expect(settled.map((e) => e.kind === "claim" && [e.title, e.isFinal])).toEqual([
      ["Payment 2 — Final", true],
      ["Payment 1 — Deposit", false],
    ]);
  });
});

const ckRow = (
  over: Partial<import("@/lib/workboard/job-story").JobStoryPicklistRow> = {}
): import("@/lib/workboard/job-story").JobStoryPicklistRow => ({
  id: "pk-1",
  name: "MSZ-AP25VGD",
  kind: "material",
  designId: "d1",
  addedAt: "2026-06-12T00:30:00Z",
  pickedAt: null,
  pickedBy: null,
  ...over,
});

describe("buildJobStory — our own contributions", () => {
  it("says a Studio design's day in the account's zone, not UTC", () => {
    /* 2026-06-12T20:30Z is 06:30 on the 13th in Sydney — the day must be
       the yard's, or a late-evening edit lands on yesterday. */
    const story = buildJobStory(
      inputs({
        detail: detail({
          designs: [{ id: "d1", name: "Peterson", updatedAt: "2026-06-12T20:30:00Z" }],
        }),
      })
    );
    expect(story.find((e) => e.kind === "design")).toMatchObject({ day: "2026-06-13" });
  });

  it("groups a picklist push into one event per day with the line count", () => {
    const story = buildJobStory(
      inputs({
        picklist: [
          ckRow({ id: "pk-1", addedAt: "2026-06-12T00:30:00Z" }),
          ckRow({ id: "pk-2", addedAt: "2026-06-12T00:30:05Z" }),
          ckRow({ id: "pk-3", addedAt: "2026-06-12T00:31:00Z" }),
        ],
      })
    );
    const pushes = story.filter((e) => e.kind === "push");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ count: 3 });
  });

  it("makes no push event of a typed row — only a design's rows push", () => {
    const story = buildJobStory(
      inputs({
        picklist: [
          ckRow({ id: "pk-1", designId: null, kind: "todo" }),
          ckRow({ id: "pk-2", designId: null, kind: "material" }),
        ],
      })
    );
    expect(story.filter((e) => e.kind === "push")).toHaveLength(0);
  });

  it("turns a ticked row into a diary entry, keyed by the row's id", () => {
    const story = buildJobStory(
      inputs({
        picklist: [
          ckRow({
            id: "pk-9",
            designId: null,
            kind: "todo",
            name: "Isolate old unit",
            /* 01:52Z = 11:52 in Sydney winter */
            pickedAt: "2026-08-14T01:52:00Z",
            pickedBy: "Jake Thompson",
          }),
        ],
      })
    );
    const tick = story.find((e) => e.kind === "tick" && e.key === "pick:pk-9");
    expect(tick).toMatchObject({
      day: "2026-08-14",
      name: "Isolate old unit",
      by: "Jake Thompson",
    });
    expect(tick && tick.at).toMatch(/11:52/);
  });

  it("agrees on the stamp whether or not the reader resolved names", () => {
    /* The summary's server read passes pickedBy null; the sheet passes the
       name. The stamp — day|at|key + count — must not care, or the stored
       summary regenerates forever. */
    const named = buildJobStory(
      inputs({ picklist: [ckRow({ pickedAt: "2026-08-14T01:52:00Z", pickedBy: "Jake Thompson" })] })
    );
    const anon = buildJobStory(
      inputs({ picklist: [ckRow({ pickedAt: "2026-08-14T01:52:00Z", pickedBy: null })] })
    );
    expect(storyStamp(named)).toEqual(storyStamp(anon));
  });
});

describe("the stamp — what lets the summary cost a cent", () => {
  it("is null for an empty story and stable for an unchanged one", () => {
    expect(storyStamp([])).toBeNull();
    const a = buildJobStory(inputs({ notes: [note()] }));
    const b = buildJobStory(inputs({ notes: [note()] }));
    expect(storyStamp(a)).toEqual(storyStamp(b));
  });

  it("moves when a new event lands on top", () => {
    const before = storyStamp(buildJobStory(inputs({ notes: [note()] })));
    const after = storyStamp(
      buildJobStory(
        inputs({
          notes: [note(), note({ remoteId: "n-2", writtenOn: "2026-08-21", writtenAt: "2026-08-21 09:00:00" })],
        })
      )
    );
    expect(after).not.toEqual(before);
  });

  it("moves when an event backfills into the past, because the count is part of it", () => {
    const before = storyStamp(buildJobStory(inputs({ notes: [note()] })));
    const after = storyStamp(
      buildJobStory(
        inputs({
          notes: [note(), note({ remoteId: "n-0", writtenOn: "2026-02-01", writtenAt: "2026-02-01 09:00:00" })],
        })
      )
    );
    expect(after).not.toEqual(before);
  });

  it("stampDay reads the newest event's day back out", () => {
    const stamp = storyStamp(buildJobStory(inputs({ notes: [note()] })));
    expect(stamp && stampDay(stamp)).toBe("2026-06-12");
  });
});

describe("what moved it — the stamp's own words", () => {
  const labelOf = (e: StoryEntry) => storyEventLabel(e);

  it("names the note's author", () => {
    const story = buildJobStory(inputs({ notes: [note()] }));
    expect(labelOf(story[0])).toBe("David's note");
  });

  it("calls the last claim settling the final payment", () => {
    const story = buildJobStory(
      inputs({
        family: familyOf([
          claim({ remoteId: "c-3", index: 3, stage: "Final", raisedOn: "2026-08-21", paidOn: "2026-08-22" }),
        ]),
      })
    );
    expect(labelOf(story[0])).toBe("the final payment");
  });
});

describe("filters and framing", () => {
  it("money covers claims, payments and the invoice milestone; notes only notes", () => {
    const story = buildJobStory(
      inputs({
        notes: [note()],
        ledger: { materials: [], payments: [payment()] },
        invoicedOn: "2026-04-01",
      })
    );
    expect(filterStory(story, "money").every((e) => e.kind !== "note")).toBe(true);
    expect(filterStory(story, "money").length).toBe(2);
    expect(filterStory(story, "notes").every((e) => e.kind === "note")).toBe(true);
  });

  it("storySince is the oldest day on the feed", () => {
    const story = buildJobStory(inputs({ notes: [note()] }));
    expect(storySince(story)).toBe("2026-01-12");
  });

  it("an empty story names what was checked, money words only behind the grant", () => {
    expect(emptyStoryLine(true)).toContain("payments");
    expect(emptyStoryLine(false)).not.toContain("payments");
  });
});

describe("storyLineOf — the writer's raw material", () => {
  it("spells a claim event with its dollars", () => {
    const story = buildJobStory(
      inputs({
        family: familyOf([
          claim({ remoteId: "c-3", index: 3, stage: "Final", amountCents: 626806, raisedOn: "2026-08-21", paidOn: "2026-08-22" }),
        ]),
      })
    );
    expect(storyLineOf(story[0])).toBe("2026-08-22 — Payment 3 — Final settled — $6,268.06");
  });

  it("flags an action-required note and quotes the words", () => {
    const story = buildJobStory(
      inputs({ notes: [note({ actionRequired: true, text: "Please make double detection" })] })
    );
    expect(storyLineOf(story[0])).toBe(
      '2026-06-12 14:31 — note by David Hann [action required]: "Please make double detection"'
    );
  });
});
