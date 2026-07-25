import {
  asNoticeKind,
  currentUnreadCount,
  expiryLabel,
  isCurrent,
  noticeLifecycle,
  partitionNotices,
} from "../notices";
import type { NoticeWithRead } from "../tasks";

const TODAY = "2026-07-20";

describe("asNoticeKind", () => {
  it("passes the known kinds through", () => {
    expect(asNoticeKind("notice")).toBe("notice");
    expect(asNoticeKind("poll")).toBe("poll");
    expect(asNoticeKind("event")).toBe("event");
  });

  it("falls back to a plain notice for anything else", () => {
    // a kind we haven't shipped yet must render as SOMETHING, never crash
    expect(asNoticeKind("quiz")).toBe("notice");
    expect(asNoticeKind(null)).toBe("notice");
    expect(asNoticeKind(undefined)).toBe("notice");
    expect(asNoticeKind(7)).toBe("notice");
  });
});

describe("noticeLifecycle", () => {
  it("is active with no expiry and no archive", () => {
    expect(noticeLifecycle({ expiresAt: null, archivedAt: null }, TODAY)).toBe("active");
  });

  it("stays active up to and including the expiry day", () => {
    expect(noticeLifecycle({ expiresAt: "2026-07-21", archivedAt: null }, TODAY)).toBe("active");
    expect(noticeLifecycle({ expiresAt: TODAY, archivedAt: null }, TODAY)).toBe("active");
  });

  it("expires the day after", () => {
    expect(noticeLifecycle({ expiresAt: "2026-07-19", archivedAt: null }, TODAY)).toBe("expired");
  });

  it("reports archiving even when the date had also passed", () => {
    expect(
      noticeLifecycle({ expiresAt: "2026-07-01", archivedAt: "2026-07-02T00:00:00Z" }, TODAY),
    ).toBe("archived");
  });

  it("archives a notice that never had an expiry", () => {
    expect(noticeLifecycle({ expiresAt: null, archivedAt: "2026-07-02T00:00:00Z" }, TODAY)).toBe(
      "archived",
    );
  });
});

describe("isCurrent", () => {
  it("is true only for the active lifecycle", () => {
    expect(isCurrent({ expiresAt: null, archivedAt: null }, TODAY)).toBe(true);
    expect(isCurrent({ expiresAt: "2026-07-19", archivedAt: null }, TODAY)).toBe(false);
    expect(isCurrent({ expiresAt: null, archivedAt: "2026-07-19T00:00:00Z" }, TODAY)).toBe(false);
  });
});

describe("expiryLabel", () => {
  it("is null when nothing expires", () => {
    expect(expiryLabel(null, TODAY)).toBeNull();
  });

  it("dates a notice that has already come down", () => {
    // en-AU abbreviates months only where it helps — July stays "July"
    expect(expiryLabel("2026-07-15", TODAY)).toEqual({ label: "Expired 15 July", state: "bad" });
  });

  it("calls the expiry day the last day", () => {
    expect(expiryLabel(TODAY, TODAY)).toEqual({ label: "Last day", state: "warn" });
  });

  it("says tomorrow rather than 1 days left", () => {
    expect(expiryLabel("2026-07-21", TODAY)).toEqual({ label: "Until tomorrow", state: "warn" });
  });

  it("counts down inside the week", () => {
    expect(expiryLabel("2026-07-27", TODAY)).toEqual({ label: "7 days left", state: "warn" });
  });

  it("is calm and dated beyond the week", () => {
    expect(expiryLabel("2026-08-15", TODAY)).toEqual({ label: "Until 15 Aug", state: "ok" });
  });
});

describe("partitionNotices", () => {
  const n = (id: string, expiresAt: string | null, archivedAt: string | null) => ({
    id,
    expiresAt,
    archivedAt,
  });

  it("splits the board from what's behind it", () => {
    const { active, archived } = partitionNotices(
      [
        n("live", null, null),
        n("gone", "2026-07-01", null),
        n("filed", null, "2026-07-10T00:00:00Z"),
        n("today", TODAY, null),
      ],
      TODAY,
    );
    expect(active.map((x) => x.id)).toEqual(["live", "today"]);
    expect(archived.map((x) => x.id)).toEqual(["gone", "filed"]);
  });

  it("keeps whatever order it was given inside each half", () => {
    const { active } = partitionNotices([n("b", null, null), n("a", null, null)], TODAY);
    expect(active.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = [n("a", null, null), n("b", "2026-07-01", null)];
    const copy = [...input];
    partitionNotices(input, TODAY);
    expect(input).toEqual(copy);
  });
});

describe("currentUnreadCount", () => {
  const notice = (id: string, over: Partial<NoticeWithRead> = {}): NoticeWithRead => ({
    id,
    title: id,
    body: null,
    pinned: false,
    postedById: null,
    postedByName: null,
    createdAt: "2026-07-01T00:00:00Z",
    revision: 1,
    editedAt: null,
    kind: "notice",
    expiresAt: null,
    archivedAt: null,
    ackedRevision: null,
    state: "unread",
    mine: false,
    readBy: 0,
    audience: 0,
    ...over,
  });

  it("counts unread notices still on the board", () => {
    expect(currentUnreadCount([notice("a"), notice("b", { state: "read" })], TODAY)).toBe(1);
  });

  it("never asks anyone to catch up on an expired notice", () => {
    expect(currentUnreadCount([notice("a", { expiresAt: "2026-07-01" })], TODAY)).toBe(0);
  });

  it("ignores archived notices", () => {
    expect(currentUnreadCount([notice("a", { archivedAt: "2026-07-02T00:00:00Z" })], TODAY)).toBe(0);
  });

  it("still never counts your own", () => {
    expect(currentUnreadCount([notice("a", { mine: true })], TODAY)).toBe(0);
  });
});
