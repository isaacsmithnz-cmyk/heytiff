/**
 * @jest-environment node
 */

/* Tiff writes your day up at Clock off: one entry per job on the sheet, its
   first line who, when, and what was photographed and asked; the paragraph
   only from what was left on the job (notes, and questions asked while
   there), and a job with nothing said on it just its time. Drawn on Isaac's
   29 October 2026 at 1352: 7:15 to 3:00, four photos, the PUMY-SP140's feet
   asked of the Library at 9:40. */

jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const tests: ((r: Row) => boolean)[] = [];
      const q: Record<string, unknown> = {};
      const keep = (t: (r: Row) => boolean) => (tests.push(t), q);
      q.select = () => q;
      q.order = () => q;
      q.eq = (c: string, v: unknown) => keep((r) => r[c] === v);
      q.in = (c: string, vs: unknown[]) => keep((r) => vs.includes(r[c]));
      q.gte = (c: string, v: string) => keep((r) => String(r[c]) >= v);
      q.is = (c: string, v: unknown) => keep((r) => (r[c] ?? null) === v);
      q.not = (c: string, _op: string, v: string) => keep((r) => !String(r[c]).startsWith(v.replace("%", "")));
      q.maybeSingle = async () => ({ data: (tables[table] ?? []).find((r) => tests.every((t) => t(r))) ?? null });
      q.then = (res: (v: { data: Row[] }) => unknown) => Promise.resolve({ data: (tables[table] ?? []).filter((r) => tests.every((t) => t(r))) }).then(res);
      return q;
    },
  },
}));
jest.mock("@/lib/integrations/sm8-booking-zone", () => ({ bookingZone: async () => ({ zone: "Australia/Sydney" }) }));
jest.mock("@/lib/integrations/sm8-writes", () => ({}));
jest.mock("@/lib/integrations/sm8-press", () => ({}));
jest.mock("@/app/actions/sm8-booking-queue", () => ({}));
jest.mock("@/lib/integrations/sm8-drain", () => ({}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "card-isaac" }));
const summary = {
  from: "2026-10-28T20:00:00.000Z",
  until: "2026-10-29T04:15:00.000Z",
  minutes: 495,
  jobs: [
    { jobUuid: "j-1352", number: "1352", where: "9/6 Holbrook Avenue", from: "2026-10-28T20:15:00.000Z", until: "2026-10-29T04:00:00.000Z", minutes: 465, how: "phone" },
    { jobUuid: "j-3372", number: "3372", where: "12 Pittwater Rd", from: "2026-10-29T04:00:00.000Z", until: "2026-10-29T04:15:00.000Z", minutes: 15, how: "phone" },
  ],
  office: { minutes: 0, spans: [] },
  travel: 15,
};
jest.mock("@/lib/mobile/day", () => ({
  readDay: async () => ({ day: { id: "d1", workDate: "2026-10-29", onAt: "2026-10-28T20:00:00.000Z", offAt: null }, summary }),
}));
const create = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({ __esModule: true, default: class { beta = { messages: { create } }; } }));

import { askedThere, filedAt, headOfNote, jobsOfDay, lineOf, promptOf, wordsOfNote, writeUpDay } from "@/lib/mobile/day-writeup";

const ctx = { userId: "auth0|isaac", orgId: "org-1" } as never;
const at = (iso: string) => Date.parse(iso);

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "k";
  create.mockReset();
  tables.staff_profiles = [
    { org_id: "org-1", id: "card-isaac", user_id: "auth0|isaac", first_name: "Isaac", full_name: "Isaac Smith" },
    { org_id: "org-1", id: "card-dave", user_id: "auth0|dave", first_name: "David", full_name: "David Hann" },
  ];
  tables.sm8_jobs = [{ org_id: "org-1", uuid: "j-1352", job_address: "9/6 Holbrook Avenue\nKirribilli NSW 2061" }];
  tables.workboard_notes = [
    { org_id: "org-1", author_id: "card-isaac", target_kind: "job", target_id: "j-1352", transcript: "Pipes run balcony to lounge and bedroom heads. Lounge head up and wired, bedroom tomorrow", created_at: "2026-10-29T01:00:00.000Z" },
    { org_id: "org-1", author_id: "card-isaac", target_kind: "job", target_id: "j-1352", transcript: "yesterday's note", created_at: "2026-10-27T01:00:00.000Z" },
    { org_id: "org-1", author_id: "card-dave", target_kind: "job", target_id: "j-1352", transcript: "Dave's own note", created_at: "2026-10-29T02:00:00.000Z" },
  ];
  tables.documents = [1, 2, 3, 4].map((n) => ({ id: `p${n}`, org_id: "org-1", uploaded_by: "card-isaac", kind: "job_photo", sm8_job_uuid: "j-1352", created_at: `2026-10-29T0${n}:00:00.000Z` }));
  tables.tiff_threads = [
    {
      org_id: "org-1",
      user_sub: "auth0|isaac",
      id: "t-1",
      updated_at: "2026-10-28T22:41:00.000Z",
      messages: [
        { role: "user", text: "Feet spacing for pumy 140", at: at("2026-10-28T22:40:00.000Z") },
        { role: "tiff", text: "The PUMY-SP140's feet are 600 mm apart (install manual, Fig. 2-1).", at: at("2026-10-28T22:40:30.000Z") },
      ],
    },
    { org_id: "org-1", user_sub: "auth0|isaac", id: "email-1", updated_at: "2026-10-29T01:00:00.000Z", messages: [{ role: "user", text: "Fwd: a quote", at: at("2026-10-29T01:00:00.000Z") }] },
  ];
});

test("the first line: who, when, and what was photographed and asked", () => {
  const spans = [{ from: "2026-10-28T20:15:00.000Z", until: "2026-10-29T04:00:00.000Z" }];
  expect(lineOf("Isaac", { spans, photos: 4, asked: [{ question: "q", answer: "a" }] }, "Australia/Sydney")).toBe("Isaac, 7:15 to 3:00 · 4 photos · 1 question to the Library");
  expect(lineOf("Isaac", { spans, photos: 1, asked: [] }, "Australia/Sydney")).toBe("Isaac, 7:15 to 3:00 · 1 photo");
});

test("a job reached twice is one entry with both stretches", () => {
  const jobs = jobsOfDay({ ...summary, jobs: [summary.jobs[0]!, summary.jobs[1]!, { ...summary.jobs[0]!, from: "2026-10-29T05:00:00.000Z", until: "2026-10-29T05:30:00.000Z" }] } as never);
  expect(jobs.map((j) => [j.number, j.spans.length])).toEqual([["1352", 2], ["3372", 1]]);
});

test("only what was asked while there counts, with Tiff's answer", () => {
  const spans = [{ from: "2026-10-28T20:15:00.000Z", until: "2026-10-28T23:00:00.000Z" }];
  expect(askedThere(tables.tiff_threads as { messages: unknown }[], spans)).toEqual([{ question: "Feet spacing for pumy 140", answer: "The PUMY-SP140's feet are 600 mm apart (install manual, Fig. 2-1)." }]);
  expect(askedThere(tables.tiff_threads as { messages: unknown }[], [{ from: "2026-10-29T03:00:00.000Z", until: "2026-10-29T04:00:00.000Z" }])).toEqual([]);
});

test("the day written up: each job's own notes, photos and questions; a job with nothing said is just its time", async () => {
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ entries: ["Pipes run from the balcony to the lounge and bedroom heads. The PUMY-SP140's feet are 600 mm apart. Lounge head up and wired; bedroom head to finish tomorrow."] }) }] });
  const { entries } = await writeUpDay(ctx, null);
  expect(entries).toEqual([
    {
      jobUuid: "j-1352",
      number: "1352",
      where: "9/6 Holbrook Avenue",
      line: "Isaac, 7:15 to 3:00 · 4 photos · 1 question to the Library",
      name: "Isaac",
      photos: 4,
      asked: 1,
      text: expect.stringContaining("600 mm apart"),
      /* the wrap-up's: your own notes and photos today, and everyone else's notes on the job */
      spans: [{ from: "2026-10-28T20:15:00.000Z", until: "2026-10-29T04:00:00.000Z" }],
      address: "9/6 Holbrook Avenue, Kirribilli NSW 2061",
      mine: [{ at: "2026-10-29T01:00:00.000Z", text: expect.stringContaining("Lounge head up") }],
      photoIds: ["p1", "p2", "p3", "p4"],
      others: [{ name: "David", at: "2026-10-29T02:00:00.000Z", text: "Dave's own note" }],
      filed: null,
      filedText: null,
    },
    { jobUuid: "j-3372", number: "3372", where: "12 Pittwater Rd", line: "Isaac, 3:00 to 3:15", name: "Isaac", photos: 0, asked: 0, text: "", spans: [{ from: "2026-10-29T04:00:00.000Z", until: "2026-10-29T04:15:00.000Z" }], address: null, mine: [], photoIds: [], others: [], filed: null, filedText: null },
  ]);
  /* only the job with something said is sent, with today's own note and nobody else's */
  const sent = create.mock.calls[0]![0].messages[0].content as string;
  expect(sent).toContain("Job 1: 1352, 9/6 Holbrook Avenue");
  expect(sent).toContain("Lounge head up and wired");
  expect(sent).not.toContain("yesterday's note");
  expect(sent).not.toContain("Dave's own note");
  expect(sent).not.toContain("3372");
  expect(sent).not.toContain("Fwd: a quote");
});

test("when the writing fails, each entry is still its time", async () => {
  create.mockRejectedValue(new Error("overloaded"));
  const err = jest.spyOn(console, "error").mockImplementation(() => {});
  const { entries } = await writeUpDay(ctx, null);
  expect(entries.map((e) => e.text)).toEqual(["", ""]);
  expect(entries[0]!.line).toContain("7:15 to 3:00");
  err.mockRestore();
});

test("the material reads job by job", () => {
  expect(promptOf([{ jobUuid: "j", number: "1352", where: "Holbrook Ave", spans: [], notes: ["a note"], photos: 0, asked: [], mine: [], photoIds: [], others: [], address: null, own: [] }])).toBe(
    "Job 1: 1352, Holbrook Ave\nNotes:\n- a note\nQuestions:\n(no questions)",
  );
});

/* 11 November 2026: 3324's note went to ServiceM8 at 3:40 pm and again, as Tiff's tidy of it, at 6:30 the next morning */
test("a wrap-up note already in is found by its who and when, Tiff's full stop or not", () => {
  const mine = (text: string) => [{ at: "2026-11-10T04:40:00.000Z", text }];
  expect(filedAt("Isaac, 8:45 to 2:45", mine("Isaac, 8:45 to 2:45 · 4 photos\n\nGot the unit up and running."))).toBe("2026-11-10T04:40:00.000Z");
  expect(filedAt("Isaac, 7:15 to 7:45", mine("Isaac, 7:15 to 7:45.\n\nA quote needs to be added."))).toBe("2026-11-10T04:40:00.000Z");
  /* another stretch, or a note put on the job during the day, is not the wrap-up's */
  expect(filedAt("Isaac, 7:15 to 7:45", mine("Isaac, 7:15 to 7:450"))).toBeNull();
  expect(filedAt("Isaac, 8:45 to 2:45", mine("Isaac, 8:45 to 12:00"))).toBeNull();
  expect(filedAt("Isaac, 8:45 to 2:45", mine("Head's up, bedroom tomorrow"))).toBeNull();
});

test("a job whose note is in says so and isn't written up again", async () => {
  tables.workboard_notes!.push({ org_id: "org-1", author_id: "card-isaac", target_kind: "job", target_id: "j-3372", transcript: "Isaac, 3:00 to 3:15\n\nChecked the drain.", created_at: "2026-10-29T04:20:00.000Z" });
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ entries: ["Lounge head up and wired."] }) }] });
  const { entries } = await writeUpDay(ctx, null);
  expect(entries.map((e) => [e.number, e.filed, e.filedText])).toEqual([["1352", null, null], ["3372", "2026-10-29T04:20:00.000Z", "Checked the drain."]]);
  expect(create.mock.calls[0]![0].messages[0].content).not.toContain("Checked the drain");
});

test("a wrap-up note's who and when, and its words, come off the note itself", () => {
  expect(headOfNote("Isaac, 8:45 to 2:45 · 4 photos\n\nGot the unit up and running.")).toBe("Isaac, 8:45 to 2:45");
  expect(headOfNote("Isaac, 7:15 to 7:45.\n\nA quote needs to be added.")).toBe("Isaac, 7:15 to 7:45");
  expect(wordsOfNote("Isaac, 8:45 to 2:45 · 4 photos\n\nGot the unit up and running.\n\nSecond line.")).toBe("Got the unit up and running.\n\nSecond line.");
  expect(wordsOfNote("Isaac, 8:45 to 2:45")).toBe("");
});
