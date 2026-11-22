/* "Isaac wrapped up 3324 / Pretend Point. Anything to add?": the suburb off ServiceM8's address, as 3324's reads. */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
import { suburbOf } from "../wrapped-others";

test("the suburb off the address's last line", () => {
  expect(suburbOf("8c/13 Labore St\nPretend Point NSW 2027")).toBe("Pretend Point");
  expect(suburbOf("106 Exampleton Avenue\nExampleton,  2061")).toBe("Exampleton");
  expect(suburbOf("Unit 16/198 Whimsy St,\nSampleloo NSW 2017")).toBe("Sampleloo");
  expect(suburbOf("7 Ipsum Rd")).toBeNull();
  expect(suburbOf(null)).toBeNull();
});
