import { canDictate } from "../can-dictate";
import type { Capability } from "@/lib/permissions";

/* WHO IS ALLOWED TO SPEAK TO THE APP.

   This exists because of a bug that was invisible from the workboard: both
   transcribe routes asked for `workboard` alone, and Tiff's ask bar is gated
   `tiff`. Revoke one capability and keep the other and you get a microphone
   that renders, records, and then 403s — the failure looks like a broken
   feature, and nothing on screen can tell you it was a permission.

   The regression these guard is the narrow one. Anyone holding EITHER surface
   can dictate; anyone holding neither cannot, because both routes spend money
   per call and a route handler is reachable directly. */

const granted = new Set<Capability>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: Capability) => granted.has(c),
}));

beforeEach(() => granted.clear());

it("lets the workboard through", async () => {
  granted.add("workboard");
  await expect(canDictate()).resolves.toBe(true);
});

it("lets Tiff through — the case the old `workboard`-only gate got wrong", async () => {
  granted.add("tiff");
  await expect(canDictate()).resolves.toBe(true);
});

it("turns away anyone with neither", async () => {
  granted.add("toolbox");
  granted.add("studio");
  await expect(canDictate()).resolves.toBe(false);
});

it("is a gate, not a formality — no capabilities at all is a no", async () => {
  await expect(canDictate()).resolves.toBe(false);
});
