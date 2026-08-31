/* orgBrand — the read behind every customer-facing letterhead.

   Three things worth pinning, all of them about what happens when something is
   missing: the surfaces this feeds are a printed handover sheet and a public
   link, and neither may fail because a business has not filled a field in. */

const maybeSingle = jest.fn();
const signOne = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  },
}));
jest.mock("@/lib/documents/query", () => ({
  signOne: (...a: unknown[]) => signOne(...a),
}));

import { orgBrand } from "../query";

const ROW = {
  trading_name: "Smith Air Conditioning",
  legal_name: "Smith Air Pty Ltd",
  abn: "51824753556",
  phone: "(03) 9000 0000",
  email: "office@smithair.com.au",
  website: "smithair.com.au",
  logo_url: "org/org-1/org_logo/doc-1.png",
  brand_color: "#004885",
};

beforeEach(() => {
  maybeSingle.mockReset().mockResolvedValue({ data: ROW });
  signOne.mockReset().mockResolvedValue("https://signed.example/logo.png");
});

it("signs the stored ref rather than handing out the column", async () => {
  const brand = await orgBrand("org-1");
  expect(signOne).toHaveBeenCalledWith("org/org-1/org_logo/doc-1.png", undefined);
  expect(brand.logoUrl).toBe("https://signed.example/logo.png");
  // the storage ref itself never leaves
  expect(JSON.stringify(brand)).not.toContain("org/org-1/org_logo");
});

/* The live link holds a page open for hours and signs its plan rasters for
   six. A letterhead that expires while the drawings beside it are still there
   reads as a broken page. */
it("passes a caller's own clock through to the signature", async () => {
  await orgBrand("org-1", { seconds: 21600 });
  expect(signOne).toHaveBeenCalledWith(expect.any(String), 21600);
});

it("falls back to the legal name when there is no trading name", async () => {
  maybeSingle.mockResolvedValue({ data: { ...ROW, trading_name: null } });
  expect((await orgBrand("org-1")).name).toBe("Smith Air Pty Ltd");

  maybeSingle.mockResolvedValue({ data: { ...ROW, trading_name: "  " } });
  expect((await orgBrand("org-1")).name).toBe("Smith Air Pty Ltd");
});

/* Blank is not a value. A phone column holding "" would otherwise print an
   empty segment in the middle of the contact line. */
it("reads blank columns as absent", async () => {
  maybeSingle.mockResolvedValue({
    data: { ...ROW, phone: "   ", email: "", website: null, abn: null },
  });
  const brand = await orgBrand("org-1");
  expect(brand.phone).toBeNull();
  expect(brand.email).toBeNull();
  expect(brand.website).toBeNull();
});

/* FAILS SOFT. A handover sheet that 500s because the org row could not be read
   is worse than one that prints without a letterhead — every caller falls back
   to its own wording when the brand is empty. */
it("returns an empty brand for a missing row instead of throwing", async () => {
  maybeSingle.mockResolvedValue({ data: null });
  const brand = await orgBrand("org-1");
  expect(brand).toEqual({
    name: "",
    logoUrl: null,
    abn: null,
    phone: null,
    email: null,
    website: null,
    color: null,
  });
  expect(signOne).not.toHaveBeenCalled();
});

it("survives an org with no logo", async () => {
  maybeSingle.mockResolvedValue({ data: { ...ROW, logo_url: null } });
  signOne.mockResolvedValue(null);
  expect((await orgBrand("org-1")).logoUrl).toBeNull();
});

/* THE SEED TRAVELS RAW. `orgBrand` hands the surfaces the colour the owner
   chose, not a derived one — deriving is `documentTheme`'s job and it happens
   at render, against the ground the surface actually has. A query that
   pre-derived would freeze the answer against whatever the grounds were the
   day it ran. */
it("carries the brand colour through untouched", async () => {
  maybeSingle.mockResolvedValue({ data: ROW });
  expect((await orgBrand("org-1")).color).toBe("#004885");
});

it("reads an unset brand colour as no theme, not as a colour", async () => {
  maybeSingle.mockResolvedValue({ data: { ...ROW, brand_color: null } });
  expect((await orgBrand("org-1")).color).toBeNull();
});
