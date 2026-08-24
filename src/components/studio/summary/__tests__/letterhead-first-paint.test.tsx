/* THE LETTERHEAD IS THERE ON THE FIRST PAINT, AND THAT IS THE WHOLE FIX.

   The Summary sheet asked for the brand from the browser, at mount — and it
   mounts when you press Summary, so every part of the chain (the actions
   chunk, the round trip, the signed link, the image itself) started while you
   were already looking at the document. Two things followed, and one of them
   is not cosmetic:

   1. The mark faded in a beat late, on a document that was otherwise done.
   2. The sheet RE-LAID ITSELF OUT. A brand colour decides whether there is a
      frame at all, and the frame's geometry travels with the colour
      (`themeVars`), so the arriving brand moved every line on the page inward
      by the width of a frame that had not been there a moment earlier.

   The route reads the brand on the server and hands it in. What this suite
   pins is the shape of that: rendered with a brand, the sheet has its frame
   and its mark BEFORE anything async settles, and it does not ask the server
   for what it was already given. The old ask survives for a caller with
   nothing to hand in, which is what keeps a test harness working.

   No `await` anywhere in the first test on purpose — an await here would let
   exactly the round trip this is about resolve, and the test would pass
   either way. */

import { act, render, renderHook, screen } from "@testing-library/react";
import { createDesign } from "@/lib/studio/document";
import type { OrgBrand } from "@/lib/org/brand";
import { NO_BRAND } from "@/lib/org/brand";
import { SummaryView } from "../summary";
import { useOrgBrand } from "../use-org-brand";

jest.mock("@/app/actions/studio-contributors", () => ({
  listDesignContributors: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/app/actions/studio-share", () => ({
  getShareLink: jest.fn(() => new Promise(() => {})),
  createShareLink: jest.fn(),
  revokeShareLink: jest.fn(),
}));
const getOrgBrand = jest.fn(() => new Promise(() => {}));
jest.mock("@/app/actions/org", () => ({
  getOrgBrand: (...a: unknown[]) => getOrgBrand(...(a as [])),
}));

const BRAND: OrgBrand = {
  name: "Diamond Air Solutions",
  logoUrl: "https://signed.example/logo.png",
  color: "#c0504d",
  abn: "14603285409",
  phone: null,
  email: "service@diamondairsolutions.com",
  website: "www.diamondairsolutions.com",
};

const planImages = {
  url: jest.fn(),
  upload: jest.fn(),
  uploadSource: jest.fn(),
  sourceFile: jest.fn(),
  remove: jest.fn(),
};

function renderSummary(brand: OrgBrand) {
  render(
    <SummaryView
      doc={createDesign({
        name: "Kembla St",
        mode: "blank",
        now: "2026-08-24T00:00:00.000Z",
      })}
      brand={brand}
      pack={null}
      onMutate={jest.fn()}
      onExportJson={jest.fn()}
      simFlag={false}
      simReady={{ ok: false, reason: "", floorName: "" }}
      simApproval={{
        simulatable: [],
        approved: [],
        pending: [],
        lapsed: [],
        offered: false,
      }}
      onSimulate={jest.fn()}
      planImages={planImages}
      loadVariant={jest.fn()}
    />
  );
}

beforeEach(() => getOrgBrand.mockClear());

/* the fallback path reaches the action through a lazy `import()`, so the call
   is a microtask away — asserting either way before that has settled is a
   test that passes on both sides of the change */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i++) await Promise.resolve();
  });
}

describe("the served letterhead", () => {
  it("paints the frame and the mark without waiting for anything", () => {
    renderSummary(BRAND);

    const sheet = document.querySelector(".dsd") as HTMLElement;
    /* the frame's colour AND its geometry — the pair that has to arrive
       together, because the padding is what moved the page when it did not */
    expect(sheet.style.getPropertyValue("--doc-ink")).not.toBe("");
    expect(sheet.style.getPropertyValue("--doc-pad")).not.toBe("");

    const logo = document.querySelector(".dsd-idlogo") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe(BRAND.logoUrl);
    expect(screen.getByText("Diamond Air Solutions")).toBeInTheDocument();
  });

  it("does not ask the server for what the page already handed it", async () => {
    renderHook(() => useOrgBrand(BRAND));
    await settle();
    expect(getOrgBrand).not.toHaveBeenCalled();
  });

  it("still asks when nothing was handed in", async () => {
    renderHook(() => useOrgBrand());
    await settle();
    expect(getOrgBrand).toHaveBeenCalledTimes(1);
  });

  it("an unbranded workspace paints no frame at all", () => {
    renderSummary(NO_BRAND);
    const sheet = document.querySelector(".dsd") as HTMLElement;
    expect(sheet.style.getPropertyValue("--doc-ink")).toBe("");
    expect(document.querySelector(".dsd-idlogo")).toBeNull();
  });
});
