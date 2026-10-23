import { syncedAgo } from "../sm8-chip";

describe("syncedAgo", () => {
  const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

  it("reads under a minute as just now", () => {
    expect(syncedAgo(ago(0))).toBe("just now");
  });

  it("counts minutes, then hours, then gives up", () => {
    expect(syncedAgo(ago(5))).toBe("5 min ago");
    expect(syncedAgo(ago(90))).toBe("1 hour ago");
    expect(syncedAgo(ago(200))).toBe("3 hours ago");
    expect(syncedAgo(ago(60 * 25))).toBe("over a day ago");
  });

  it("survives a missing or unparseable timestamp", () => {
    expect(syncedAgo(null)).toBe("not yet");
    expect(syncedAgo("not a date")).toBe("just now");
  });
});
