import {
  asRsvpAnswer,
  eventWhen,
  fmtTime,
  isEventTime,
  rsvpSummary,
  tallyRsvp,
  type RsvpRow,
} from "../events";

const TODAY = "2026-07-20"; // a Monday

const rsvp = (staffId: string, staffName: string, answer: RsvpRow["answer"]): RsvpRow => ({
  staffId,
  staffName,
  answer,
});

describe("asRsvpAnswer", () => {
  it("passes the three answers through", () => {
    expect(asRsvpAnswer("yes")).toBe("yes");
    expect(asRsvpAnswer("maybe")).toBe("maybe");
    expect(asRsvpAnswer("no")).toBe("no");
  });

  it("has no default — an unreadable answer is no answer", () => {
    expect(asRsvpAnswer("probably")).toBeNull();
    expect(asRsvpAnswer(null)).toBeNull();
    expect(asRsvpAnswer(1)).toBeNull();
  });
});

describe("tallyRsvp", () => {
  it("always offers the three answers, in the poster's order", () => {
    const poll = tallyRsvp([], null);
    expect(poll.options.map((o) => o.label)).toEqual(["Going", "Maybe", "Can't make it"]);
    expect(poll.multi).toBe(false);
  });

  it("counts replies and names who said what", () => {
    const poll = tallyRsvp(
      [rsvp("s1", "Ana", "yes"), rsvp("s2", "Bo", "yes"), rsvp("s3", "Cass", "no")],
      null,
    );
    expect(poll.options.map((o) => o.votes)).toEqual([2, 0, 1]);
    expect(poll.options[0].voters.map((v) => v.name)).toEqual(["Ana", "Bo"]);
    expect(poll.voters).toBe(3);
  });

  it("tells the viewer which answer is theirs", () => {
    const poll = tallyRsvp([rsvp("s1", "Ana", "maybe")], "s1");
    expect(poll.options.map((o) => o.mine)).toEqual([false, true, false]);
    expect(poll.myOptionIds).toEqual(["maybe"]);
    expect(poll.voted).toBe(true);
  });
});

describe("rsvpSummary", () => {
  it("is silent until somebody replies", () => {
    expect(rsvpSummary(tallyRsvp([], null))).toBeNull();
  });

  it("leaves out the answers nobody gave", () => {
    expect(rsvpSummary(tallyRsvp([rsvp("s1", "Ana", "yes")], null))).toBe("1 going");
  });

  it("reads going, maybe, then can't", () => {
    const poll = tallyRsvp(
      [
        rsvp("s1", "Ana", "yes"),
        rsvp("s2", "Bo", "yes"),
        rsvp("s3", "Cass", "maybe"),
        rsvp("s4", "Dee", "no"),
      ],
      null,
    );
    expect(rsvpSummary(poll)).toBe("2 going · 1 maybe · 1 can't");
  });
});

describe("fmtTime", () => {
  it("reads a 24h time back in the way people say it", () => {
    expect(fmtTime("07:00")).toBe("7:00am");
    expect(fmtTime("13:30")).toBe("1:30pm");
  });

  it("gets both ends of the day right", () => {
    expect(fmtTime("00:15")).toBe("12:15am");
    expect(fmtTime("12:00")).toBe("12:00pm");
    expect(fmtTime("23:59")).toBe("11:59pm");
  });

  it("is null for no time, and for a time it can't trust", () => {
    expect(fmtTime(null)).toBeNull();
    expect(fmtTime("7am")).toBeNull();
    expect(fmtTime("24:00")).toBeNull();
  });
});

describe("isEventTime", () => {
  it("accepts what the database will accept, and nothing else", () => {
    expect(isEventTime("00:00")).toBe(true);
    expect(isEventTime("23:59")).toBe(true);
    expect(isEventTime("7:00")).toBe(false);
    expect(isEventTime("23:60")).toBe(false);
    expect(isEventTime("")).toBe(false);
  });
});

describe("eventWhen", () => {
  it("spells the day out in full", () => {
    expect(eventWhen("2026-07-24", "07:00", TODAY).day).toBe("Friday 24 July");
  });

  it("says today and tomorrow rather than counting", () => {
    expect(eventWhen(TODAY, null, TODAY).soon).toBe("Today");
    expect(eventWhen("2026-07-21", null, TODAY).soon).toBe("Tomorrow");
  });

  it("counts the days inside the week and stays quiet beyond it", () => {
    expect(eventWhen("2026-07-23", null, TODAY).soon).toBe("In 3 days");
    expect(eventWhen("2026-08-30", null, TODAY).soon).toBeNull();
  });

  it("knows when it's been and gone", () => {
    expect(eventWhen("2026-07-19", null, TODAY).past).toBe(true);
    expect(eventWhen(TODAY, null, TODAY).past).toBe(false);
    // still today's event, so no "3 days ago" nudge
    expect(eventWhen("2026-07-19", null, TODAY).soon).toBeNull();
  });

  it("carries the time through, or null when there isn't one", () => {
    expect(eventWhen(TODAY, "17:30", TODAY).time).toBe("5:30pm");
    expect(eventWhen(TODAY, null, TODAY).time).toBeNull();
  });
});
