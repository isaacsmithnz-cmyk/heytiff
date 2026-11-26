/**
 * @jest-environment node
 */

/* Your own card's Edit on the phone (bug 101): each group saves only its own
   boxes, through your own profile's save, so a POST can't reach a start date,
   an employment type or a job title, which are the business's. */

const ctx = { userId: "auth0|sam", orgId: "org-demo", role: "staff", caps: new Set(), orgIds: ["org-demo"] };
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async () => ctx,
  actAsPhoneUser: (_c: unknown, fn: () => Promise<unknown>) => fn(),
  ok: (b: unknown) => Response.json(b),
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "card-sam" }));
jest.mock("@/lib/staff/query", () => ({ getStaff: async () => null }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: async () => ({ warnDays: 30 }) }));
jest.mock("@/lib/fleet/query", () => ({ getOwnVehicle: async () => null }));
jest.mock("@/lib/team/birthday-sharing", () => ({ readBirthdaySharing: async () => ({}), setBirthdaySharing: async () => null }));
const save = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock("@/app/actions/profile", () => ({ saveMyProfileSection: (...a: unknown[]) => save(...a) }));

import { POST } from "../card/route";

const post = (body: unknown) => POST(new Request("https://x/api/mobile/card", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => save.mockClear());

test("Details saves the names and birthday, and nothing the business sets", async () => {
  const r = await post({
    group: "details",
    fields: { first_name: "Sam", last_name: "Carter", preferred_name: "Sammy", birthday: "14/03/1996", start_date: "01/01/2020", employment_type: "Casual", job_title: "Boss" },
  });
  expect(r.status).toBe(200);
  expect(save).toHaveBeenCalledWith("personal", { first_name: "Sam", last_name: "Carter", preferred_name: "Sammy", birthday: "14/03/1996" });
});

test("Contact saves the mobile and home address alone", async () => {
  await post({ group: "contact", fields: { phone: "0400 555 018", address: "12 Example St", first_name: "Eve" } });
  expect(save).toHaveBeenCalledWith("personal", { phone: "0400 555 018", address: "12 Example St" });
});

test("Emergency contact saves to its own section", async () => {
  await post({ group: "emergency", fields: { emergency_name: "Riley Carter", emergency_relationship: "Partner", emergency_phone: "0400 555 077" } });
  expect(save).toHaveBeenCalledWith("emergency", { emergency_name: "Riley Carter", emergency_relationship: "Partner", emergency_phone: "0400 555 077" });
});

test("a name can't be emptied, and a group that isn't one saves nothing", async () => {
  expect((await post({ group: "details", fields: { first_name: "", last_name: "Carter" } })).status).toBe(400);
  expect((await post({ group: "payroll", fields: { pay_rate: "99" } })).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
