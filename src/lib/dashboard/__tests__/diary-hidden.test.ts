import { isConversationKey, unhidden } from "../diary-hidden";
import type { DiaryConversation } from "../diary-feed";

/* A CONVERSATION YOU HID stays out of your diary until its asker writes
   again (Isaac, 2026-09-26: "the option to hide/archive other peoples"). */

const talk = (key: string, lastTheirs: string): DiaryConversation =>
  ({ key, lastTheirs }) as unknown as DiaryConversation;

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
});
