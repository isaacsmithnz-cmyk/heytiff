const upsert = jest.fn(async (..._a: unknown[]) => ({ error: null }));
const del = jest.fn();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      delete: () => ({ eq: (_c: string, org: string) => ({ eq: async (_k: string, key: string) => (del(org, key), { error: null }) }) }),
    }),
  },
}));
let role = "owner";
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "u-1" }),
  getDbRole: async () => role,
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "staff-1" }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { resetTemplate, saveTemplate } from "../templates";
import { standardTemplates } from "@/lib/templates/settings";

/* Changing the business's own templates: the owner's alone, stored as the
   normaliser reads it, refused in words when it couldn't be used. */

beforeEach(() => {
  jest.clearAllMocks();
  role = "owner";
});

it("stores the owner's change for this business, as every reader will read it", async () => {
  const res = await saveTemplate("documents_email", { subject: "  Paperwork   for [job number] ", message: "Hi,\r\n\r\n\r\n\r\nAttached." });
  expect(res).toEqual({ ok: true });
  expect(upsert.mock.calls[0][0]).toMatchObject({
    org_id: "org-1",
    key: "documents_email",
    value: { subject: "Paperwork for [job number]", message: "Hi,\n\nAttached." },
    updated_by_staff_id: "staff-1",
  });
});

it("refuses anyone but the owner", async () => {
  role = "admin";
  expect(await saveTemplate("project_checklist", standardTemplates().projectChecklist)).toEqual({
    ok: false,
    error: "Only the owner can change the business's templates.",
  });
  expect(upsert).not.toHaveBeenCalled();
});

it("refuses payment terms that don't add up, and says why", async () => {
  const terms = standardTemplates().paymentTerms;
  terms.domestic_construction.stages[0].percent = 15;
  const res = await saveTemplate("payment_terms", terms);
  expect(res).toEqual({ ok: false, error: "Home, construction: the stages add up to 105%, not 100%." });
  expect(upsert).not.toHaveBeenCalled();
});

it("goes back to the standard wording by taking the business's copy away", async () => {
  expect(await resetTemplate("quote_notes")).toEqual({ ok: true });
  expect(del).toHaveBeenCalledWith("org-1", "quote_notes");
});
