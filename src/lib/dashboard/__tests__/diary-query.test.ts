/* The diary's one call: who gets a mention read at all, and that a failed
   one costs the diary its conversations and nothing else. */

import type { Capability } from "@/lib/permissions";
import type { DiaryEntry } from "../journal";
import { DIARY_ENTRY_LIMIT, type DiaryConversation } from "../diary-feed";

const listDiaryEntries = jest.fn();
const listMyMentions = jest.fn();
jest.mock("../journal-query", () => ({ listDiaryEntries: (...a: unknown[]) => listDiaryEntries(...a) }));
jest.mock("../mentions-query", () => ({ listMyMentions: (...a: unknown[]) => listMyMentions(...a) }));

const syncReads: string[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      syncReads.push(t);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: { last_finished_at: "2026-09-25T06:00:00Z" } });
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
  isDebrief: false,
  stamp: "2026-09-25 08:42",
  routed: false,
  taskFor: {},
};
const CONVO = { key: "j-2041:u-luke", lastTheirs: "2026-09-21 13:42:10" } as DiaryConversation;

const ctx = (over: Partial<DiaryFeedContext> = {}): DiaryFeedContext => ({
  orgId: "org-1",
  viewerStaffId: "s-isaac",
  caps: new Set<Capability>(["workboard"]),
  tz: "Australia/Brisbane",
  railDay: "2026-09-25",
  mineUuid: "u-isaac",
  ...over,
});

beforeEach(() => {
  listDiaryEntries.mockReset().mockResolvedValue([ENTRY]);
  listMyMentions.mockReset().mockResolvedValue([CONVO]);
  syncReads.length = 0;
});

it("reads your entries on the account's clock and your mentions on its today", async () => {
  const feed = await loadDiaryFeed(ctx());
  expect(listDiaryEntries).toHaveBeenCalledWith("org-1", "s-isaac", "Australia/Brisbane");
  expect(listMyMentions).toHaveBeenCalledWith("org-1", "u-isaac", "2026-09-25");
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
