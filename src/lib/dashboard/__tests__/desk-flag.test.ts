/**
 * @jest-environment node
 */

/* HOME_DESK: the new Home is off until the variable says otherwise, shown to
   the owner alone on `owner`, and to everyone on `on` — read when asked, so
   the flip is a redeploy and nothing is baked in at import. */

import { deskMode, deskOn } from "../desk-flag";

const before = process.env.HOME_DESK;
afterEach(() => {
  if (before === undefined) delete process.env.HOME_DESK;
  else process.env.HOME_DESK = before;
});

describe("deskOn", () => {
  it("is off when the variable is unset, empty, or anything it does not know", () => {
    for (const v of [undefined, "", "yes", "true", "1", "owners"]) {
      if (v === undefined) delete process.env.HOME_DESK;
      else process.env.HOME_DESK = v;
      expect(deskMode()).toBe("off");
      expect(deskOn("owner")).toBe(false);
    }
  });

  it("shows the owner, and only the owner, the new Home on `owner`", () => {
    process.env.HOME_DESK = "owner";
    expect(deskOn("owner")).toBe(true);
    expect(deskOn("admin")).toBe(false);
    expect(deskOn("staff")).toBe(false);
    expect(deskOn(null)).toBe(false);
  });

  it("shows everyone the new Home on `on`", () => {
    process.env.HOME_DESK = "on";
    expect(deskOn("owner")).toBe(true);
    expect(deskOn("admin")).toBe(true);
    expect(deskOn("staff")).toBe(true);
  });

  it("forgives case and stray space in the value Vercel holds", () => {
    process.env.HOME_DESK = " Owner\n";
    expect(deskMode()).toBe("owner");
  });

  it("reads the variable each time it is asked, not once at import", () => {
    process.env.HOME_DESK = "off";
    expect(deskOn("staff")).toBe(false);
    process.env.HOME_DESK = "on";
    expect(deskOn("staff")).toBe(true);
  });
});
