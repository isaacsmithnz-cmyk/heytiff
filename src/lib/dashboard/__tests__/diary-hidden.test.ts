import { isConversationKey, repliesPutAway, unhidden } from "../diary-hidden";
import type { DiaryConversation, DiaryMessage } from "../diary-feed";

/* A CONVERSATION YOU HID stays out of your diary until its asker writes
   again (Isaac, 2026-09-26: "the option to hide/archive other peoples"),
   or you reply in it from HeyTiff, and your replies in it go with it. */

const talk = (key: string, lastTheirs: string, messages: Partial<DiaryMessage>[] = []): DiaryConversation =>
  ({ key, lastTheirs, messages }) as unknown as DiaryConversation;
/** A message of yours in its thread: as HeyTiff saved it (`ours`), or
    one written in ServiceM8. */
const yours = (id: string, at: string, ours: boolean): Partial<DiaryMessage> => ({
  id,
  from: "you",
  at,
  ...(ours ? { ours: { jobUuid: "job-1", line: null } } : {}),
});

describe("isConversationKey", () => {
  it("takes the diary's own key, a job and an asker", () => {
    expect(isConversationKey("3f2b8c1e-0d4a-4b6f-9a2e-1c5d7e9f0a11:5b1d2c3e-aaaa-4bbb-8ccc-1d2e3f4a5b6c")).toBe(true);
    expect(isConversationKey("job-1:u-luke")).toBe(true);
  });

  it("refuses anything else a browser could send", () => {
    for (const bad of ["", "job-1", "job-1:", ":u-luke", "a:b:c", "job 1:u-luke", "job-1:u-luke; drop", 42, null]) {
      expect(isConversationKey(bad)).toBe(false);
    }
    expect(isConversationKey(`${"x".repeat(81)}:u`)).toBe(false);
  });
});

describe("unhidden", () => {
  const hidden = new Map([["job-1:u-luke", "2026-09-26 14:05"]]);

  it("leaves out a conversation hidden since its asker last wrote", () => {
    const out = unhidden([talk("job-1:u-luke", "2026-09-21 13:42:10"), talk("job-2:u-luke", "2026-09-21 09:00:00")], hidden);
    expect(out.map((c) => c.key)).toEqual(["job-2:u-luke"]);
  });

  it("brings it back once they write again, after the minute it was hidden", () => {
    expect(unhidden([talk("job-1:u-luke", "2026-09-26 14:06:01")], hidden)).toHaveLength(1);
    // the same minute is not after it
    expect(unhidden([talk("job-1:u-luke", "2026-09-26 14:05:59")], hidden)).toHaveLength(0);
  });

  it("hides nothing when nothing was hidden", () => {
    const all = [talk("job-1:u-luke", "2026-09-21 13:42:10")];
    expect(unhidden(all, new Map())).toEqual(all);
  });

  /* A reply you send from a job card, or a task's Done, threads into the
     conversation holding the note it answers (./diary-reply). Sent after
     you hid it, it is you writing in it again: the conversation comes back
     with it, rather than your reply going out of your diary unseen. */
  it("brings it back once you reply in it from HeyTiff, after the minute it was hidden", () => {
    const after = talk("job-1:u-luke", "2026-09-21 13:42:10", [yours("wn-1", "2026-09-26 14:06:30", true)]);
    expect(unhidden([after], hidden)).toHaveLength(1);
    // the same minute is not after it, and one sent before stays hidden with it
    const sameMinute = talk("job-1:u-luke", "2026-09-21 13:42:10", [yours("wn-1", "2026-09-26 14:05:59", true)]);
    const before = talk("job-1:u-luke", "2026-09-21 13:42:10", [yours("wn-1", "2026-09-22 08:00:00", true)]);
    expect(unhidden([sameMinute, before], hidden)).toHaveLength(0);
  });

  it("keeps it hidden for an answer of yours written in ServiceM8, never an entry of your diary", () => {
    const inSm8 = talk("job-1:u-luke", "2026-09-21 13:42:10", [yours("n-mine", "2026-09-26 15:00:00", false)]);
    expect(unhidden([inSm8], hidden)).toHaveLength(0);
  });
});

describe("repliesPutAway", () => {
  it("is your HeyTiff replies in the conversations the diary leaves out, and none of those it shows", () => {
    const hid = talk("job-1:u-luke", "2026-09-21 13:42:10", [
      yours("wn-1", "2026-09-21 14:00:00", true),
      yours("n-mine", "2026-09-21 15:00:00", false),
    ]);
    const shown = talk("job-2:u-luke", "2026-09-21 09:00:00", [yours("wn-2", "2026-09-21 10:00:00", true)]);
    expect([...repliesPutAway([hid, shown], [shown])]).toEqual(["wn-1"]);
    expect(repliesPutAway([hid, shown], [hid, shown]).size).toBe(0);
  });
});
