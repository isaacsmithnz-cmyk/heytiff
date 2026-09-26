/* The diary's one call: who gets a mention read at all, and that a failed
   one costs the diary its conversations and nothing else. */

import type { Capability } from "@/lib/permissions";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";
import type { DiaryEntry } from "../journal";
import { DIARY_ENTRY_LIMIT, buildConversations, type DiaryConversation, type MentionNote, type OurReply } from "../diary-feed";

const listDiaryEntries = jest.fn();
const listDiaryReplies = jest.fn();
const replyViewerOf = jest.fn();
const listMyMentions = jest.fn();
jest.mock("../journal-query", () => ({
  listDiaryEntries: (...a: unknown[]) => listDiaryEntries(...a),
  listDiaryReplies: (...a: unknown[]) => listDiaryReplies(...a),
  replyViewerOf: (...a: unknown[]) => replyViewerOf(...a),
}));
jest.mock("../mentions-query", () => ({ listMyMentions: (...a: unknown[]) => listMyMentions(...a) }));

const syncReads: string[] = [];
/** The conversations the viewer hid (diary_hidden), and what each read asked. */
let hiddenRows: { conversation_key: string; hidden_at: string }[] | null = [];
const hiddenAsked: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      syncReads.push(t);
      const asked: Record<string, unknown> = {};
      if (t === "diary_hidden") hiddenAsked.push(asked);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        asked[col] = val;
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: { last_finished_at: "2026-09-25T06:00:00Z" } });
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          hiddenRows === null ? { data: null, error: { code: "42P01" } } : { data: hiddenRows, error: null },
        ).then(res);
      return chain;
    },
  },
}));

import { loadDiaryFeed, type DiaryFeedContext } from "../diary-query";

const ENTRY: DiaryEntry = {
  id: "e1",
  said: "Ring the wholesaler",
  day: "2026-09-25",
  at: "8:42 am",
  outcomes: [],
  spoken: false,
  stamp: "2026-09-25 08:42",
  routed: false,
  taskFor: {},
  turns: [],
  undo: false,
  undone: false,
};
const CONVO = { key: "j-2041:u-luke", lastTheirs: "2026-09-21 13:42:10", messages: [] } as unknown as DiaryConversation;

const ctx = (over: Partial<DiaryFeedContext> = {}): DiaryFeedContext => ({
  orgId: "org-1",
  viewerStaffId: "s-isaac",
  caps: new Set<Capability>(["workboard"]),
  tz: "Australia/Brisbane",
  railDay: "2026-09-25",
  mineUuid: "u-isaac",
  ...over,
});

/** Who the viewer is to ServiceM8, as the loader hands it to both reads of
    their replies: a stand-in, never called here. */
const VIEWER = () => Promise.reject(new Error("not read in this suite"));

beforeEach(() => {
  listDiaryEntries.mockReset().mockResolvedValue([ENTRY]);
  listDiaryReplies.mockReset().mockResolvedValue([]);
  replyViewerOf.mockReset().mockReturnValue(VIEWER);
  listMyMentions.mockReset().mockResolvedValue([CONVO]);
  syncReads.length = 0;
  hiddenRows = [];
  hiddenAsked.length = 0;
});

/* "the option to hide/archive other peoples" (Isaac, 2026-09-26): a
   conversation you hid stays out until its asker writes again. The zone is
   Brisbane's, so the hiding is said on the account's clock before it is
   set beside the asker's message. */
it("leaves out a conversation you hid, until its asker writes again", async () => {
  // 04:05Z is 14:05 in Brisbane, after Luke's 13:42 on the 21st
  hiddenRows = [{ conversation_key: "j-2041:u-luke", hidden_at: "2026-09-21T04:05:00Z" }];
  const feed = await loadDiaryFeed(ctx());
  expect(feed.earlier.map((i) => i.key)).toEqual([]);
  expect(hiddenAsked).toEqual([{ org_id: "org-1", staff_id: "s-isaac" }]);

  // hidden before he last wrote: back
  hiddenRows = [{ conversation_key: "j-2041:u-luke", hidden_at: "2026-09-21T03:00:00Z" }];
  expect((await loadDiaryFeed(ctx())).earlier.map((i) => i.key)).toEqual(["mention:j-2041:u-luke"]);
});

it("hides nothing when the hidden read fails, or before the table exists", async () => {
  hiddenRows = null;
  const feed = await loadDiaryFeed(ctx());
  expect(feed.earlier.map((i) => i.key)).toEqual(["mention:j-2041:u-luke"]);
});

it("reads your entries on the account's clock and your mentions on its today", async () => {
  const feed = await loadDiaryFeed(ctx());
  expect(listDiaryEntries).toHaveBeenCalledWith("org-1", "s-isaac", "Australia/Brisbane");
  /* with the viewer's own staff card: the tasks their asks made are theirs
     alone (H18) */
  expect(listMyMentions).toHaveBeenCalledWith("org-1", "u-isaac", "2026-09-25", { staffId: "s-isaac" });
  expect(feed.today.map((i) => i.key)).toEqual(["entry:e1"]);
  expect(feed.earlier.map((i) => i.key)).toEqual(["mention:j-2041:u-luke"]);
  expect(feed).toMatchObject({ day: "2026-09-25", mentions: true, syncedAt: "2026-09-25T06:00:00Z" });
});

it.each([
  ["a viewer integration_links doesn't name", ctx({ mineUuid: null })],
  ["a viewer without workboard", ctx({ caps: new Set<Capability>() })],
  ["an account with no staff card", ctx({ viewerStaffId: null })],
])("reads no mentions and nothing of the mirror for %s", async (_, c) => {
  const feed = await loadDiaryFeed(c);
  expect(listMyMentions).not.toHaveBeenCalled();
  expect(syncReads).toEqual([]);
  expect(feed.mentions).toBe(false);
  expect(feed.syncedAt).toBeNull();
});

it("reads no diary for an account with no staff card — there is no author to file under", async () => {
  await loadDiaryFeed(ctx({ viewerStaffId: null }));
  expect(listDiaryEntries).not.toHaveBeenCalled();
});

it("keeps your entries when the mention read fails", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  listMyMentions.mockRejectedValue(new Error("network"));
  const feed = await loadDiaryFeed(ctx());
  expect(feed.today.map((i) => i.key)).toEqual(["entry:e1"]);
  expect(feed.earlier).toEqual([]);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

it("stops the column at your oldest entry when the entry read came back full", async () => {
  const full = Array.from({ length: DIARY_ENTRY_LIMIT }, (_, i) => ({ ...ENTRY, id: `e${i}`, stamp: "2026-09-24 08:00" }));
  listDiaryEntries.mockResolvedValue(full);
  const feed = await loadDiaryFeed(ctx());
  // Luke's ask of the 21st is older than every entry read, so older ones may be missing
  expect(feed.earlier.map((i) => i.key)).not.toContain("mention:j-2041:u-luke");
  expect(feed.earlier).toHaveLength(DIARY_ENTRY_LIMIT);

  listDiaryEntries.mockResolvedValue(full.slice(1));
  expect((await loadDiaryFeed(ctx())).earlier.map((i) => i.key)).toContain("mention:j-2041:u-luke");
});

it("with no ServiceM8 is your own entries, on the day the loader gives it", async () => {
  const feed = await loadDiaryFeed(ctx({ tz: null, mineUuid: null, railDay: "2026-09-25" }));
  expect(listDiaryEntries).toHaveBeenCalledWith("org-1", "s-isaac", null);
  expect(feed).toMatchObject({ day: "2026-09-25", mentions: false });
  expect(feed.today).toHaveLength(1);
});

/* YOUR REPLIES (two-way phase 2): a reply of yours from HeyTiff, and a
   task's Done, go to the mentions read as your entries come back, so each
   is drawn once, in its conversation — and where the deployment sends
   files only, the mentions read is asked exactly as it always was. */
describe("your replies from HeyTiff", () => {
  const had = process.env.SM8_WRITES;
  afterEach(() => {
    if (had === undefined) delete process.env.SM8_WRITES;
    else process.env.SM8_WRITES = had;
  });
  const line = { text: "Sending to ServiceM8…", tone: null, again: null, ask: null };
  const STILL_IN = {
    text: "Still in ServiceM8. HeyTiff hasn't taken it out yet.",
    tone: "bad" as const,
    again: { act: "take_out_again" as const, label: "Try again" },
    ask: null,
  };
  const REPLY: DiaryEntry = {
    ...ENTRY,
    id: "wn-reply",
    said: "a caminho",
    stamp: "2026-09-25 09:10",
    reply: {
      to: "n-ask",
      jobUuid: "j-2041",
      words: "@lukeingold on my way",
      at: "2026-09-25 09:10:42",
      savedAt: "2026-09-24T23:10:42.123456+00:00",
      line,
    },
  };
  /* the conversation as the mentions read threads it: the reply in it */
  const HOLDING = {
    ...CONVO,
    messages: [
      { id: "n-ask", from: "them", addressed: true, text: "call Mary", named: "Isaac call Mary", at: "2026-09-21 13:42:10" },
      { id: "wn-reply", from: "you", addressed: true, text: "on my way", named: "Luke on my way", at: "2026-09-25 09:10:42", ours: { jobUuid: "j-2041", line } },
    ],
  } as unknown as DiaryConversation;

  /* The mentions read, as far as the diary's threading goes: the real
     conversations of these notes, with the replies the loader hands in. */
  const ISAAC_P: Sm8Person = { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" };
  const LUKE_P: Sm8Person = { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" };
  const threads =
    (notes: MentionNote[]) =>
    async (_org: string, _mine: string, today: string, opts: { replies?: PromiseLike<readonly OurReply[]> }) =>
      buildConversations({
        notes,
        me: { uuid: ISAAC_P.uuid, handle: ISAAC_P.handle },
        people: [ISAAC_P, LUKE_P],
        jobs: new Map([["j-2041", { label: "2041 Wollstonecraft", live: true }]]),
        today,
        ...(opts.replies ? { replies: await opts.replies } : {}),
      });
  const luke = (uuid: string, at: string, text: string): MentionNote => ({ uuid, jobUuid: "j-2041", author: "u-luke", at, text });
  const itemsOf = (feed: Awaited<ReturnType<typeof loadDiaryFeed>>) => [...feed.today, ...feed.earlier];
  const talkIn = (feed: Awaited<ReturnType<typeof loadDiaryFeed>>) => {
    const item = itemsOf(feed).find((i) => i.key === "mention:j-2041:u-luke");
    return item?.kind === "conversation" ? item.conversation : null;
  };

  it("hands them to the mentions read as your entries come back, and draws each once, in its conversation", async () => {
    process.env.SM8_WRITES = "attachment,note";
    listDiaryEntries.mockResolvedValue([ENTRY, REPLY]);
    listMyMentions.mockResolvedValue([HOLDING]);

    const feed = await loadDiaryFeed(ctx());

    const [, , , opts] = listMyMentions.mock.calls[0];
    expect(opts.staffId).toBe("s-isaac");
    await expect(opts.replies).resolves.toEqual([
      {
        id: "wn-reply",
        to: "n-ask",
        jobUuid: "j-2041",
        words: "@lukeingold on my way",
        // to the second, as it was saved: not the entry's minute
        at: "2026-09-25 09:10:42",
        savedAt: "2026-09-24T23:10:42.123456+00:00",
        line,
      },
    ]);
    expect(itemsOf(feed).map((i) => i.key)).toEqual(["entry:e1", "mention:j-2041:u-luke"]);
  });

  it("reads your replies over the mentions' reach on their own, with one read of who you are to ServiceM8 for both reads", async () => {
    process.env.SM8_WRITES = "attachment,note";
    await loadDiaryFeed(ctx());
    expect(replyViewerOf).toHaveBeenCalledTimes(1);
    expect(replyViewerOf).toHaveBeenCalledWith("org-1", "s-isaac");
    // sixty days back from the account's today, on its clock
    expect(listDiaryReplies).toHaveBeenCalledWith("org-1", "s-isaac", "Australia/Brisbane", "2026-07-27", VIEWER);
    expect(listDiaryEntries).toHaveBeenCalledWith("org-1", "s-isaac", "Australia/Brisbane", DIARY_ENTRY_LIMIT, VIEWER);
  });

  it("threads a reply older than your newest entries in its conversation, once", async () => {
    process.env.SM8_WRITES = "attachment,note";
    /* sixty entries from the 10th to the 24th: the read is full, and your
       reply of the 5th isn't among them */
    const sixty = Array.from({ length: DIARY_ENTRY_LIMIT }, (_, i) => ({
      ...ENTRY,
      id: `e${i}`,
      stamp: `2026-09-${String(10 + Math.floor(i / 4)).padStart(2, "0")} 08:00`,
    }));
    const OLD: DiaryEntry = {
      ...REPLY,
      id: "wn-old",
      stamp: "2026-09-05 10:30",
      reply: { ...REPLY.reply!, to: "n-ask", at: "2026-09-05 10:30:12", savedAt: "2026-09-05T00:30:12.000000+00:00" },
    };
    listDiaryEntries.mockResolvedValue(sixty);
    listDiaryReplies.mockResolvedValue([OLD]);
    listMyMentions.mockImplementation(
      threads([
        luke("n-ask", "2026-09-05 10:00:00", "@isaacsmith please call Mary"),
        // his note on the job the next day, naming nobody: after your answer, not part of the ask
        luke("n-invoice", "2026-09-06 09:00:00", "Invoice sent to client"),
        luke("n-thanks", "2026-09-25 07:00:00", "@isaacsmith thanks"),
      ]),
    );

    const feed = await loadDiaryFeed(ctx());

    expect(talkIn(feed)?.messages.map((m) => [m.id, m.from])).toEqual([
      ["n-ask", "them"],
      ["wn-old", "you"],
      ["n-thanks", "them"],
    ]);
    // his thanks came after your answer: it is his newest, and today's
    expect(talkIn(feed)).toMatchObject({ answered: false, fresh: true });
    // drawn in its thread only: no entry of it, and the column reaches back only as far as your entries do
    expect(itemsOf(feed).filter((i) => i.kind === "entry")).toHaveLength(DIARY_ENTRY_LIMIT);
  });

  it("threads a reply sent seconds after his later note after it: answered, and not lit", async () => {
    process.env.SM8_WRITES = "attachment,note";
    // your Done, saved at 13:42:50, answers his ask of the morning; his "any update?" came at 13:42:20
    const DONE: DiaryEntry = {
      ...REPLY,
      id: "wn-done",
      stamp: "2026-09-25 13:42",
      reply: { ...REPLY.reply!, words: "@lukeingold Done.", at: "2026-09-25 13:42:50", savedAt: "2026-09-25T03:42:50.000000+00:00" },
    };
    listDiaryEntries.mockResolvedValue([DONE]);
    listMyMentions.mockImplementation(
      threads([
        luke("n-ask", "2026-09-25 08:00:00", "@isaacsmith please call Mary"),
        luke("n-update", "2026-09-25 13:42:20", "@isaacsmith any update?"),
      ]),
    );

    const feed = await loadDiaryFeed(ctx());

    expect(talkIn(feed)?.messages.map((m) => m.id)).toEqual(["n-ask", "n-update", "wn-done"]);
    expect(talkIn(feed)).toMatchObject({ answered: true, fresh: false });
  });

  it("hands in a reply both reads found once, and those of the other when one read fails", async () => {
    process.env.SM8_WRITES = "attachment,note";
    const OLDER: DiaryEntry = { ...REPLY, id: "wn-older", reply: { ...REPLY.reply!, at: "2026-09-20 10:00:00" } };
    listDiaryEntries.mockResolvedValue([ENTRY, REPLY]);
    listDiaryReplies.mockResolvedValue([REPLY, OLDER]);
    await loadDiaryFeed(ctx());
    const replies = (opts: unknown) => (opts as { replies: PromiseLike<OurReply[]> }).replies;
    expect((await replies(listMyMentions.mock.calls[0][3])).map((r) => r.id)).toEqual(["wn-reply", "wn-older"]);

    // the replies' own read failed: the entries' replies are still threaded
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    listMyMentions.mockClear();
    listDiaryReplies.mockRejectedValue(new Error("network"));
    await loadDiaryFeed(ctx());
    expect((await replies(listMyMentions.mock.calls[0][3])).map((r) => r.id)).toEqual(["wn-reply"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("couldn't read org org-1's replies"));
    spy.mockRestore();
  });

  it("leaves them your entries when the entries read fails, as the mentions read is told", async () => {
    process.env.SM8_WRITES = "attachment,note";
    listDiaryEntries.mockRejectedValue(new Error("network"));
    await expect(loadDiaryFeed(ctx())).rejects.toThrow("network");
    const [, , , opts] = listMyMentions.mock.calls[0];
    await expect(opts.replies).resolves.toEqual([]);
  });

  /* ONE YOU TOOK BACK that may still be in ServiceM8 is no entry of the
     entry read: it comes from the replies' own read, and is drawn in its
     thread — or, when no conversation on the page holds it, as your entry,
     inside the stretch your entries cover. */
  describe("a reply you took back, still in ServiceM8", () => {
    const GONE_BACK = (to: string, stamp: string): DiaryEntry => ({
      ...REPLY,
      id: "wn-back",
      stamp,
      reply: { ...REPLY.reply!, to, line: STILL_IN, takenBack: true },
    });

    it("is drawn in its thread, and not again as your entry", async () => {
      process.env.SM8_WRITES = "attachment,note";
      listDiaryReplies.mockResolvedValue([GONE_BACK("n-ask", "2026-09-25 09:10")]);
      listMyMentions.mockImplementation(threads([luke("n-ask", "2026-09-25 08:00:00", "@isaacsmith please call Mary")]));
      const feed = await loadDiaryFeed(ctx());
      expect(talkIn(feed)?.messages.map((m) => [m.id, m.ours?.line?.text ?? null])).toEqual([
        ["n-ask", null],
        ["wn-back", STILL_IN.text],
      ]);
      // and says it was taken back: its Try again is its door, not a Delete
      expect(talkIn(feed)?.messages[1].ours?.takenBack).toBe(true);
      expect(itemsOf(feed).map((i) => i.key)).toEqual(["entry:e1", "mention:j-2041:u-luke"]);
    });

    it("is your entry when no conversation holds the note it answers, never dropped", async () => {
      process.env.SM8_WRITES = "attachment,note";
      listDiaryReplies.mockResolvedValue([GONE_BACK("n-removed-in-servicem8", "2026-09-25 09:10")]);
      listMyMentions.mockImplementation(threads([luke("n-ask", "2026-09-25 08:00:00", "@isaacsmith please call Mary")]));
      const feed = await loadDiaryFeed(ctx());
      const entry = itemsOf(feed).find((i) => i.key === "entry:wn-back");
      expect(entry?.kind === "entry" && entry.entry.reply?.line).toEqual(STILL_IN);
    });

    it("stays out when it is older than every entry a full entry read reached, as the column does", async () => {
      process.env.SM8_WRITES = "attachment,note";
      const full = Array.from({ length: DIARY_ENTRY_LIMIT }, (_, i) => ({ ...ENTRY, id: `e${i}`, stamp: "2026-09-24 08:00" }));
      listDiaryEntries.mockResolvedValue(full);
      listDiaryReplies.mockResolvedValue([
        GONE_BACK("n-removed-in-servicem8", "2026-09-23 09:10"),
        { ...GONE_BACK("n-removed-in-servicem8", "2026-09-24 09:10"), id: "wn-back-later" },
      ]);
      const feed = await loadDiaryFeed(ctx());
      const keys = itemsOf(feed).map((i) => i.key);
      expect(keys).not.toContain("entry:wn-back");
      expect(keys).toContain("entry:wn-back-later");
    });
  });

  /* HIDE puts someone else's conversation out of your diary until they
     write again (actions/diary, ../diary-hidden). Your reply in it is part
     of it now, and goes with it: never left behind as an entry of its own,
     which the page would draw the moment it came round after the fold. It
     comes back with it — and one you send from HeyTiff after you hid it is
     you writing in it again, so it brings the conversation back rather
     than going out of your diary unseen. Brisbane's clock: 23:20Z the day
     before is 09:20 on the 25th. */
  describe("in a conversation you hid", () => {
    beforeEach(() => {
      process.env.SM8_WRITES = "attachment,note";
      listDiaryEntries.mockResolvedValue([ENTRY, REPLY]);
      listMyMentions.mockImplementation(threads([luke("n-ask", "2026-09-25 08:00:00", "@isaacsmith please call Mary")]));
    });

    it("goes with it, and is not drawn on its own", async () => {
      // hidden at 09:20, after your reply of 09:10 and his ask of 08:00
      hiddenRows = [{ conversation_key: "j-2041:u-luke", hidden_at: "2026-09-24T23:20:00Z" }];
      const feed = await loadDiaryFeed(ctx());
      expect(itemsOf(feed).map((i) => i.key)).toEqual(["entry:e1"]);
    });

    it("brings it back, threaded, when you sent it after you hid it", async () => {
      // hidden at 09:00: his ask was before it, your reply of 09:10 after
      hiddenRows = [{ conversation_key: "j-2041:u-luke", hidden_at: "2026-09-24T23:00:00Z" }];
      const feed = await loadDiaryFeed(ctx());
      expect(itemsOf(feed).map((i) => i.key)).toEqual(["entry:e1", "mention:j-2041:u-luke"]);
      expect(talkIn(feed)?.messages.map((m) => m.id)).toEqual(["n-ask", "wn-reply"]);
    });
  });

  it("asks every read exactly as before where the deployment sends files only (production today)", async () => {
    process.env.SM8_WRITES = "1";
    listDiaryEntries.mockResolvedValue([ENTRY, REPLY]);
    listMyMentions.mockResolvedValue([CONVO]);
    const feed = await loadDiaryFeed(ctx());
    expect(listDiaryEntries).toHaveBeenCalledWith("org-1", "s-isaac", "Australia/Brisbane");
    expect(listMyMentions).toHaveBeenCalledWith("org-1", "u-isaac", "2026-09-25", { staffId: "s-isaac" });
    // no read of your replies on their own, and nothing of who you are to ServiceM8
    expect(listDiaryReplies).not.toHaveBeenCalled();
    expect(replyViewerOf).not.toHaveBeenCalled();
    // nothing holds the reply, so it is an entry as it always was
    expect(itemsOf(feed).map((i) => i.key)).toEqual(["entry:wn-reply", "entry:e1", "mention:j-2041:u-luke"]);
  });

  it("reads none of your replies on their own without a conversation to hold them", async () => {
    process.env.SM8_WRITES = "attachment,note";
    await loadDiaryFeed(ctx({ mineUuid: null }));
    expect(listDiaryEntries).toHaveBeenCalledWith("org-1", "s-isaac", "Australia/Brisbane");
    expect(listDiaryReplies).not.toHaveBeenCalled();
    expect(replyViewerOf).not.toHaveBeenCalled();
  });
});
