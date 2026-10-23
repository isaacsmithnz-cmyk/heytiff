import { checkEnglish } from "../english";

/* The net in front of the review card.

   The asymmetry these pin: a false yes costs one cheap translation pass over
   text that was already English, and a false no leaves a record nobody on the
   board can read. So the misses matter more — EXCEPT where a name is
   involved, which is the one place a false yes does damage. */

describe("records that must be repaired", () => {

  it("says what it found, so a wrong call can be read rather than re-derived", () => {
    const c = checkEnglish("Cambiar el filtro antes del lunes");
    expect(c.foreign).toBe(true);
    expect(c.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

