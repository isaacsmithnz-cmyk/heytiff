import {
  commentCount,
  findMentions,
  mentionedIds,
  mentionsOf,
  segmentBody,
  threadComments,
  type CommentRow,
  type MentionTarget,
} from "../comments";

const STAFF: MentionTarget[] = [
  { id: "s1", name: "Ana" },
  { id: "s2", name: "Ana Smith" },
  { id: "s3", name: "Bo" },
  { id: "s4", name: "Anna" },
];

const comment = (over: Partial<CommentRow> & { id: string }): CommentRow => ({
  parentId: null,
  authorId: "s1",
  authorName: "Ana",
  body: "hello",
  createdAt: "2026-07-01T00:00:00Z",
  mentions: [],
  ...over,
});

describe("findMentions", () => {
  it("finds nothing in a body with no @", () => {
    expect(findMentions("all good thanks", STAFF)).toEqual([]);
  });

  it("finds a mention and where it sits", () => {
    const [hit] = findMentions("cheers @Bo", STAFF);
    expect(hit.target.id).toBe("s3");
    expect(hit.start).toBe(7);
    expect(hit.end).toBe(10);
    expect(hit.text).toBe("Bo");
  });

  it("prefers the longest name, so @Ana Smith is one person not two", () => {
    const hits = findMentions("@Ana Smith can you look", STAFF);
    expect(hits).toHaveLength(1);
    expect(hits[0].target.id).toBe("s2");
  });

  it("stops at a word boundary, so @Ana never swallows Anna", () => {
    const hits = findMentions("@Anna is on it", STAFF);
    expect(hits).toHaveLength(1);
    expect(hits[0].target.id).toBe("s4");
  });

  it("ignores an @ in the middle of a word — an email is not a mention", () => {
    expect(findMentions("mail ana@Bo.com", STAFF)).toEqual([]);
  });

  it("ignores an @ that names nobody", () => {
    expect(findMentions("@Nobody around?", STAFF)).toEqual([]);
  });

  it("is case-insensitive but keeps what was typed", () => {
    const [hit] = findMentions("oi @bo", STAFF);
    expect(hit.target.id).toBe("s3");
    expect(hit.text).toBe("bo");
  });

  it("finds several, left to right", () => {
    const hits = findMentions("@Bo and @Anna please", STAFF);
    expect(hits.map((h) => h.target.id)).toEqual(["s3", "s4"]);
  });
});

describe("mentionedIds", () => {
  it("is the distinct people named", () => {
    expect(mentionedIds("@Bo @Anna @Bo", STAFF).sort()).toEqual(["s3", "s4"]);
  });

  it("is empty when nobody is named", () => {
    expect(mentionedIds("nothing to see", STAFF)).toEqual([]);
  });
});

describe("segmentBody", () => {
  it("splits the text around each mention", () => {
    expect(segmentBody("hi @Bo ok", STAFF, null)).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@Bo", staffId: "s3", me: false },
      { kind: "text", text: " ok" },
    ]);
  });

  it("marks the mention that is the viewer", () => {
    const parts = segmentBody("@Bo and @Anna", STAFF, "s4");
    expect(parts.filter((p) => p.kind === "mention").map((p) => p.kind === "mention" && p.me)).toEqual([
      false,
      true,
    ]);
  });

  it("is one plain run when there's nothing to paint", () => {
    expect(segmentBody("plain words", STAFF, null)).toEqual([
      { kind: "text", text: "plain words" },
    ]);
  });

  it("handles a body that is nothing but a mention", () => {
    expect(segmentBody("@Bo", STAFF, null)).toEqual([
      { kind: "mention", text: "@Bo", staffId: "s3", me: false },
    ]);
  });
});

describe("threadComments", () => {
  it("puts top-level comments oldest first", () => {
    const nodes = threadComments([
      comment({ id: "b", createdAt: "2026-07-02T00:00:00Z" }),
      comment({ id: "a", createdAt: "2026-07-01T00:00:00Z" }),
    ]);
    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("hangs replies off their parent, oldest first", () => {
    const nodes = threadComments([
      comment({ id: "a", createdAt: "2026-07-01T00:00:00Z" }),
      comment({ id: "r2", parentId: "a", createdAt: "2026-07-03T00:00:00Z" }),
      comment({ id: "r1", parentId: "a", createdAt: "2026-07-02T00:00:00Z" }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("keeps a reply to a reply in the same thread — never a third level", () => {
    const nodes = threadComments([
      comment({ id: "a", createdAt: "2026-07-01T00:00:00Z" }),
      comment({ id: "r1", parentId: "a", createdAt: "2026-07-02T00:00:00Z" }),
      comment({ id: "r2", parentId: "r1", createdAt: "2026-07-03T00:00:00Z" }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("promotes an orphan rather than losing somebody's words", () => {
    const nodes = threadComments([comment({ id: "r", parentId: "gone" })]);
    expect(nodes.map((n) => n.id)).toEqual(["r"]);
    expect(nodes[0].parentId).toBeNull();
  });

  it("does not mutate its input", () => {
    const input = [comment({ id: "a" }), comment({ id: "r", parentId: "a" })];
    const copy = JSON.parse(JSON.stringify(input));
    threadComments(input);
    expect(input).toEqual(copy);
  });
});

describe("commentCount", () => {
  it("counts replies as comments", () => {
    const nodes = threadComments([
      comment({ id: "a", createdAt: "2026-07-01T00:00:00Z" }),
      comment({ id: "r", parentId: "a", createdAt: "2026-07-02T00:00:00Z" }),
      comment({ id: "b", createdAt: "2026-07-03T00:00:00Z" }),
    ]);
    expect(commentCount(nodes)).toBe(3);
    expect(commentCount([])).toBe(0);
  });
});

describe("mentionsOf", () => {
  const nodes = threadComments([
    comment({ id: "a", createdAt: "2026-07-01T00:00:00Z", mentions: ["s3"] }),
    comment({ id: "r", parentId: "a", createdAt: "2026-07-02T00:00:00Z", mentions: ["s3", "s4"] }),
    comment({ id: "b", createdAt: "2026-07-03T00:00:00Z" }),
  ]);

  it("counts every comment naming the viewer, replies included", () => {
    expect(mentionsOf(nodes, "s3")).toBe(2);
    expect(mentionsOf(nodes, "s4")).toBe(1);
    expect(mentionsOf(nodes, "s1")).toBe(0);
  });

  it("is zero for a viewer with no staff record — they can't be named", () => {
    expect(mentionsOf(nodes, null)).toBe(0);
  });
});
