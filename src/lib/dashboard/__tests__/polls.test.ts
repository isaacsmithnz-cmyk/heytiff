import {
  cleanPollOptions,
  emptyPoll,
  MAX_POLL_OPTIONS,
  nextSelection,
  tallyPoll,
  type PollOptionRow,
  type PollVoteRow,
} from "../polls";

const OPTIONS: PollOptionRow[] = [
  { id: "mon", label: "Monday", position: 0 },
  { id: "tue", label: "Tuesday", position: 1 },
  { id: "wed", label: "Wednesday", position: 2 },
];

const vote = (optionId: string, staffId: string, staffName: string): PollVoteRow => ({
  optionId,
  staffId,
  staffName,
});

describe("tallyPoll", () => {
  it("is all zeroes before anyone answers", () => {
    const poll = tallyPoll({ options: OPTIONS, votes: [], multi: false, viewerStaffId: "s1" });
    expect(poll.voters).toBe(0);
    expect(poll.voted).toBe(false);
    expect(poll.options.map((o) => [o.votes, o.share, o.leading])).toEqual([
      [0, 0, false],
      [0, 0, false],
      [0, 0, false],
    ]);
  });

  it("counts votes and shares them across the people who answered", () => {
    const poll = tallyPoll({
      options: OPTIONS,
      votes: [vote("mon", "s1", "Ana"), vote("mon", "s2", "Bo"), vote("tue", "s3", "Cass")],
      multi: false,
      viewerStaffId: null,
    });
    expect(poll.voters).toBe(3);
    expect(poll.options.map((o) => o.votes)).toEqual([2, 1, 0]);
    expect(poll.options.map((o) => o.share)).toEqual([67, 33, 0]);
  });

  it("shares of PEOPLE, so a multi-select poll sums past 100", () => {
    // two people, both picking two answers — four votes, not four voters
    const poll = tallyPoll({
      options: OPTIONS,
      votes: [
        vote("mon", "s1", "Ana"),
        vote("tue", "s1", "Ana"),
        vote("mon", "s2", "Bo"),
        vote("wed", "s2", "Bo"),
      ],
      multi: true,
      viewerStaffId: null,
    });
    expect(poll.voters).toBe(2);
    expect(poll.options.map((o) => o.share)).toEqual([100, 50, 50]);
  });

  it("marks every joint-highest answer as leading", () => {
    const poll = tallyPoll({
      options: OPTIONS,
      votes: [vote("mon", "s1", "Ana"), vote("tue", "s2", "Bo")],
      multi: false,
      viewerStaffId: null,
    });
    expect(poll.options.map((o) => o.leading)).toEqual([true, true, false]);
  });

  it("never calls an unanswered poll's first option the leader", () => {
    const poll = tallyPoll({ options: OPTIONS, votes: [], multi: false, viewerStaffId: null });
    expect(poll.options.some((o) => o.leading)).toBe(false);
  });

  it("tells the viewer which answers are theirs", () => {
    const poll = tallyPoll({
      options: OPTIONS,
      votes: [vote("mon", "s1", "Ana"), vote("wed", "s1", "Ana"), vote("tue", "s2", "Bo")],
      multi: true,
      viewerStaffId: "s1",
    });
    expect(poll.options.map((o) => o.mine)).toEqual([true, false, true]);
    expect(poll.voted).toBe(true);
    expect(poll.myOptionIds.sort()).toEqual(["mon", "wed"]);
  });

  it("has no picks for a viewer with no staff record", () => {
    const poll = tallyPoll({
      options: OPTIONS,
      votes: [vote("mon", "s1", "Ana")],
      multi: false,
      viewerStaffId: null,
    });
    expect(poll.voted).toBe(false);
    expect(poll.myOptionIds).toEqual([]);
  });

  it("names the voters under each answer, alphabetically", () => {
    const poll = tallyPoll({
      options: OPTIONS,
      votes: [vote("mon", "s2", "Zara"), vote("mon", "s1", "Ana")],
      multi: false,
      viewerStaffId: null,
    });
    expect(poll.options[0].voters.map((v) => v.name)).toEqual(["Ana", "Zara"]);
  });

  it("keeps the author's order, not the vote order", () => {
    const poll = tallyPoll({
      options: [
        { id: "wed", label: "Wednesday", position: 2 },
        { id: "mon", label: "Monday", position: 0 },
        { id: "tue", label: "Tuesday", position: 1 },
      ],
      votes: [vote("wed", "s1", "Ana"), vote("wed", "s2", "Bo"), vote("mon", "s3", "Cass")],
      multi: false,
      viewerStaffId: null,
    });
    expect(poll.options.map((o) => o.label)).toEqual(["Monday", "Tuesday", "Wednesday"]);
  });
});

describe("emptyPoll", () => {
  it("is a well-formed poll with nothing in it", () => {
    expect(emptyPoll(true)).toEqual({
      multi: true,
      options: [],
      voters: 0,
      voted: false,
      myOptionIds: [],
    });
  });
});

describe("cleanPollOptions", () => {
  it("trims and drops the blanks a composer leaves behind", () => {
    expect(cleanPollOptions([" Monday ", "", "Tuesday", "   "])).toEqual({
      ok: true,
      options: ["Monday", "Tuesday"],
    });
  });

  it("refuses a poll with fewer than two answers", () => {
    expect(cleanPollOptions(["Monday", ""])).toEqual({ ok: false, error: "too-few" });
    expect(cleanPollOptions([])).toEqual({ ok: false, error: "too-few" });
  });

  it("refuses more answers than anyone will read", () => {
    const many = Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, i) => `Answer ${i}`);
    expect(cleanPollOptions(many)).toEqual({ ok: false, error: "too-many" });
  });

  it("catches two answers that say the same thing, whatever the case", () => {
    expect(cleanPollOptions(["Monday", "monday"])).toEqual({ ok: false, error: "duplicate" });
  });
});

describe("nextSelection", () => {
  it("replaces the pick on a single-answer poll", () => {
    expect(nextSelection(["mon"], "tue", false)).toEqual(["tue"]);
    expect(nextSelection([], "tue", false)).toEqual(["tue"]);
  });

  it("lets you take back your answer by tapping it again", () => {
    expect(nextSelection(["mon"], "mon", false)).toEqual([]);
    expect(nextSelection(["mon", "tue"], "mon", true)).toEqual(["tue"]);
  });

  it("adds to the set on a multi-answer poll", () => {
    expect(nextSelection(["mon"], "tue", true)).toEqual(["mon", "tue"]);
  });

  it("does not mutate the current selection", () => {
    const current = ["mon"];
    nextSelection(current, "tue", true);
    expect(current).toEqual(["mon"]);
  });
});
