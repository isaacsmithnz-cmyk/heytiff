import { KNOCK_FROM_MIN, MIDDAY_FROM_MIN, debriefVoice, phaseOf } from "../debrief-voice";

/* One tab, one habit, three voices. The same control gets pressed at both
   ends of a day, and "How did today go?" at six in the morning is the wrong
   question — that is the whole reason this module exists. */

describe("phaseOf", () => {
  it("is a brief first thing, a check-in midday, a debrief at knock-off", () => {
    expect(phaseOf(6 * 60)).toBe("morning");
    expect(phaseOf(MIDDAY_FROM_MIN)).toBe("midday");
    expect(phaseOf(KNOCK_FROM_MIN)).toBe("knock");
    expect(phaseOf(19 * 60)).toBe("knock");
  });

  it("turns exactly on its boundaries, never a minute early", () => {
    expect(phaseOf(MIDDAY_FROM_MIN - 1)).toBe("morning");
    expect(phaseOf(KNOCK_FROM_MIN - 1)).toBe("midday");
  });

  it("opens rather than closes when there is no clock to read", () => {
    /* An unreadable zone, or a rail day that is not today. "What's on today?"
       invites and is never wrong; "How did today go?" at dawn is. */
    expect(phaseOf(null)).toBe("morning");
  });
});

describe("debriefVoice", () => {
  it("asks the hour's question and names the button after it", () => {
    expect(debriefVoice("morning")).toEqual({
      title: "What’s on today?",
      cta: "Start the brief",
    });
    expect(debriefVoice("midday").cta).toBe("Start the check-in");
    expect(debriefVoice("knock").title).toBe("How did today go?");
  });

  it("says something different at each end of the day", () => {
    const titles = (["morning", "midday", "knock"] as const).map((p) => debriefVoice(p).title);
    expect(new Set(titles).size).toBe(3);
  });
});
