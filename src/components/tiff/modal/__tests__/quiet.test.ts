import { QUIET_FINISHED_MS, QUIET_MIDWAY_MS, QUIET_OPEN_MS, QUIET_UNREAD_MS, quietLimit } from "../quiet";

/* How long a quiet ends your turn, by how finished the words sound. A plain
   timer clips people mid-sentence on a site; these rows are why it isn't one. */

const live = { live: true };

describe("quietLimit", () => {
  it("a finished sentence ends quickly", () => {
    expect(quietLimit("Tell Lyle to order the grilles by Friday.", live)).toBe(QUIET_FINISHED_MS);
    expect(quietLimit("Who's at 3323 tomorrow?", live)).toBe(QUIET_FINISHED_MS);
    expect(quietLimit('He said "done."', live)).toBe(QUIET_FINISHED_MS);
  });

  it("a sentence left on a joiner, an article or a filler waits long", () => {
    for (const w of ["Tell Lyle to order the", "The middle unit tripped and", "Can you um", "Order filters for", "We need the grilles,"]) {
      expect(quietLimit(w, live)).toBe(QUIET_MIDWAY_MS);
    }
  });

  it("words with no full stop yet, ending on a real word, wait a little longer than a sentence", () => {
    expect(quietLimit("Open up Isaac Smith", live)).toBe(QUIET_OPEN_MS);
    expect(QUIET_OPEN_MS).toBeGreaterThan(QUIET_FINISHED_MS);
    expect(QUIET_OPEN_MS).toBeLessThan(QUIET_MIDWAY_MS);
  });

  it("live with no words yet keeps listening: a cough is not a turn", () => {
    expect(quietLimit("", live)).toBeNull();
    expect(quietLimit("   ", live)).toBeNull();
  });

  it("when the words can't be read (the batch transport) it waits a fixed while", () => {
    expect(quietLimit("", { live: false })).toBe(QUIET_UNREAD_MS);
    expect(quietLimit("anything", { live: false })).toBe(QUIET_UNREAD_MS);
  });
});
