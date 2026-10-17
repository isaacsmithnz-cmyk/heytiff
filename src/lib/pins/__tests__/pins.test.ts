import { PIN_MAX, pinKey, pinOf, refOf } from "../pins";

describe("a pin from untrusted input", () => {
  it("takes a record, its title and its second line", () => {
    expect(pinOf({ ref: { kind: "job", id: " abc " }, title: " Job 3209 ", sub: "Richards" })).toEqual({
      ref: { kind: "job", id: "abc" },
      title: "Job 3209",
      sub: "Richards",
    });
  });

  it("keeps no empty second line", () => {
    expect(pinOf({ ref: { kind: "visit", id: "v" }, title: "Service", sub: "  " })?.sub).toBeNull();
  });

  it("refuses a kind it doesn't know, a missing id or title, and an id the table can't hold", () => {
    expect(pinOf({ ref: { kind: "project", id: "p" }, title: "x" })).toBeNull();
    expect(pinOf({ ref: { kind: "job", id: "" }, title: "x" })).toBeNull();
    expect(pinOf({ ref: { kind: "job", id: "a" }, title: "" })).toBeNull();
    expect(pinOf({ ref: { kind: "job", id: "a".repeat(81) }, title: "x" })).toBeNull();
    expect(pinOf(null)).toBeNull();
  });

  it("trims a title to what the table holds", () => {
    expect(pinOf({ ref: { kind: "job", id: "a" }, title: "t".repeat(200) })?.title).toHaveLength(120);
  });

  it("reads a bare reference for an unpin", () => {
    expect(refOf({ kind: "agreement", id: "x" })).toEqual({ kind: "agreement", id: "x" });
    expect(refOf({ kind: "nope", id: "x" })).toBeNull();
  });

  it("keys a pin by its kind and id, and keeps a dozen", () => {
    expect(pinKey({ kind: "job", id: "1" })).not.toBe(pinKey({ kind: "visit", id: "1" }));
    expect(PIN_MAX).toBe(12);
  });
});
