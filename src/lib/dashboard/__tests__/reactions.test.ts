import {
  asReaction,
  nextReaction,
  REACTIONS,
  tallyReactions,
  type ReactionRow,
} from "../reactions";

const react = (staffId: string, staffName: string, emoji: ReactionRow["emoji"]): ReactionRow => ({
  staffId,
  staffName,
  emoji,
});

describe("asReaction", () => {
  it("passes the palette through", () => {
    for (const emoji of REACTIONS) expect(asReaction(emoji)).toBe(emoji);
  });

  it("has no default — an emoji we don't offer is not a reaction", () => {
    expect(asReaction("🚀")).toBeNull();
    expect(asReaction("")).toBeNull();
    expect(asReaction(null)).toBeNull();
  });
});

describe("tallyReactions", () => {
  it("is empty before anyone reacts", () => {
    expect(tallyReactions([], "s1")).toEqual({ tallies: [], total: 0, mine: null });
  });

  it("only lists reactions somebody actually gave", () => {
    const summary = tallyReactions([react("s1", "Ana", "👍")], null);
    expect(summary.tallies).toHaveLength(1);
    expect(summary.tallies[0]).toEqual({ emoji: "👍", count: 1, mine: false, names: ["Ana"] });
  });

  it("puts the busiest reaction first", () => {
    const summary = tallyReactions(
      [
        react("s1", "Ana", "🙏"),
        react("s2", "Bo", "👍"),
        react("s3", "Cass", "👍"),
        react("s4", "Dee", "👍"),
      ],
      null,
    );
    expect(summary.tallies.map((t) => [t.emoji, t.count])).toEqual([
      ["👍", 3],
      ["🙏", 1],
    ]);
    expect(summary.total).toBe(4);
  });

  it("breaks a tie on the palette's order, so the row doesn't reshuffle", () => {
    const summary = tallyReactions([react("s1", "Ana", "🙏"), react("s2", "Bo", "👍")], null);
    expect(summary.tallies.map((t) => t.emoji)).toEqual(["👍", "🙏"]);
  });

  it("names who reacted, alphabetically", () => {
    const summary = tallyReactions([react("s2", "Zara", "👍"), react("s1", "Ana", "👍")], null);
    expect(summary.tallies[0].names).toEqual(["Ana", "Zara"]);
  });

  it("picks out the viewer's own reaction", () => {
    const summary = tallyReactions([react("s1", "Ana", "❤️"), react("s2", "Bo", "👍")], "s1");
    expect(summary.mine).toBe("❤️");
    expect(summary.tallies.find((t) => t.emoji === "❤️")?.mine).toBe(true);
    expect(summary.tallies.find((t) => t.emoji === "👍")?.mine).toBe(false);
  });

  it("has no reaction of its own for a viewer with no staff record", () => {
    expect(tallyReactions([react("s1", "Ana", "👍")], null).mine).toBeNull();
  });
});

describe("nextReaction", () => {
  it("takes back the one you already gave", () => {
    expect(nextReaction("👍", "👍")).toBeNull();
  });

  it("replaces it with a different one — never two at once", () => {
    expect(nextReaction("👍", "😂")).toBe("😂");
  });

  it("gives one when you had none", () => {
    expect(nextReaction(null, "🙏")).toBe("🙏");
  });
});
