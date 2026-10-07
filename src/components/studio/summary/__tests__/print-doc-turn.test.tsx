/* A PLAN PAGE TURNS WHEN THE PLAN PRINTS BIGGER THE OTHER WAY UP (Isaac,
   2026-10-07: "rotate the design plan landscape if needed"). Proved on real
   paper with headless Chrome — the turned page is A4 landscape inside a
   portrait document, framed the right way round. These pin what that rests
   on: the page's classes, the named page, and the frame it draws itself. */

import { act, render } from "@testing-library/react";
import { createDesign } from "@/lib/studio/document";
import { buildDesignSnapshot, buildSummaryModel, designBasis } from "@/lib/studio/summary";
import { ALL_SECTIONS, type PrintModel, type SheetSections } from "@/lib/studio/export";
import { NO_BRAND } from "@/lib/org/brand";
import { PrintDoc } from "../print-doc";

jest.mock("@/lib/studio/plans", () => ({
  ...jest.requireActual("@/lib/studio/plans"),
  trimOfImageUrl: jest.fn(() => Promise.resolve(null)),
}));

function modelWith(sections: SheetSections): PrintModel {
  const doc = createDesign({ name: "4/3 Reed Street", mode: "plan", now: "2026-10-07T00:00:00.000Z" });
  const sheet = (id: string, width: number, height: number) => ({
    id, imageRef: id, pageNumber: 1, name: id, width, height, x: 0, y: 0,
  });
  doc.floors = [
    { id: "tall", name: "Tall", level: 0, scaleMmPerUnit: 12, northDeg: null, northPos: null, plans: [sheet("t", 1000, 1500)] },
    { id: "wide", name: "Wide", level: 1, scaleMmPerUnit: 12, northDeg: null, northPos: null, plans: [sheet("w", 3600, 1500)] },
  ];
  return {
    options: {
      sections,
      floorIds: ["tall", "wide"],
      variantIds: [doc.id],
      layers: { plan: true, units: true, pipes: true, labels: true },
      grayscale: false,
      legend: false,
      paper: "A4",
      orientation: "portrait",
    },
    variants: [
      {
        doc,
        label: null,
        sheet: buildSummaryModel(doc, null),
        snapshot: buildDesignSnapshot(doc),
        floors: doc.floors,
        basis: designBasis(doc),
      },
    ],
  } as unknown as PrintModel;
}

const page = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("#ds-printdoc .ds-print-page")].find((s) =>
    s.querySelector(".ds-print-cap span")?.textContent?.startsWith(name)
  )!;

const BRAND = { ...NO_BRAND, name: "Diamond Air Solutions", color: "#3E6DB5" };

it("turns the wide plan's page and leaves the tall one portrait", async () => {
  render(<PrintDoc model={modelWith(ALL_SECTIONS)} urls={{}} brand={BRAND} onReady={() => {}} />);
  await act(async () => {});
  expect(page("Tall").className).toBe("ds-print-page portrait");
  expect(page("Wide").className).toBe("ds-print-page landscape turned");
});

it("names the turned page as the same paper the other way round", async () => {
  render(<PrintDoc model={modelWith(ALL_SECTIONS)} urls={{}} brand={BRAND} onReady={() => {}} />);
  await act(async () => {});
  const rule = document.getElementById("ds-print-page-size")!.textContent!;
  expect(rule).toContain("@page { size: A4 portrait; margin: 0; }");
  expect(rule).toContain("@page ds-turned { size: A4 landscape; margin: 0; }");
});

/* the sheet's frame is stamped at the FIRST page's size, the wrong way round
   on a turned page — so that page draws the same band itself, off the same
   theme, and only where the document has a sheet (and so a frame) at all */
it("draws its own frame on the turned page, and only when there is a sheet", async () => {
  const { unmount } = render(<PrintDoc model={modelWith(ALL_SECTIONS)} urls={{}} brand={BRAND} onReady={() => {}} />);
  await act(async () => {});
  const wide = page("Wide");
  expect(wide.querySelector(".ds-print-tband")).not.toBeNull();
  expect(wide.style.getPropertyValue("--doc-ink")).not.toBe("");
  expect(page("Tall").querySelector(".ds-print-tband")).toBeNull();
  unmount();

  render(
    <PrintDoc
      model={modelWith({ figures: false, systems: false, lines: false, picklist: false })}
      urls={{}}
      brand={BRAND}
      onReady={() => {}}
    />
  );
  await act(async () => {});
  expect(page("Wide").style.getPropertyValue("--doc-ink")).toBe("");
});
