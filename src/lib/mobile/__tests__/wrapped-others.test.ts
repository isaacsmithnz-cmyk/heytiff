/* "Isaac wrapped up 3324 / Darling Point. Anything to add?": the suburb off ServiceM8's address, as 3324's reads. */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
import { suburbOf } from "../wrapped-others";

test("the suburb off the address's last line", () => {
  expect(suburbOf("8c/13 Thornton St\nDarling Point NSW 2027")).toBe("Darling Point");
  expect(suburbOf("106 Kirribilli Avenue\nKirribilli,  2061")).toBe("Kirribilli");
  expect(suburbOf("Unit 16/198 Young St,\nWaterloo NSW 2017")).toBe("Waterloo");
  expect(suburbOf("7 Cutler Rd")).toBeNull();
  expect(suburbOf(null)).toBeNull();
});
