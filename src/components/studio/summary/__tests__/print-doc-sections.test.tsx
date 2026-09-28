/* THE CUSTOMER'S PAPER HAS NO PICKLIST.

   print-doc.tsx printed the material picklist on every copy, unconditionally,
   so a PDF for a customer could not be made without a warehouse list on it.
   The Send dialog's ticks ride the print model as `sections` now; these pin
   that paper obeys them. */

import { render } from "@testing-library/react";
import { createDesign } from "@/lib/studio/document";
import { buildDesignSnapshot, designBasis } from "@/lib/studio/summary";
import { ALL_SECTIONS, type PrintModel, type SheetSections } from "@/lib/studio/export";
import { PrintDoc } from "../print-doc";

function modelWith(sections: SheetSections): PrintModel {
  const doc = createDesign({ name: "85 West St", mode: "blank", now: "2026-08-20T00:00:00.000Z" });
  return {
    options: {
      sections,
      floorIds: [],
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
        sheet: {
          systems: [],
          unserved: [],
          picklist: [{ group: "pipe", name: "Pair coil 1/4 x 1/2", sub: "", qty: "15 m" }],
        },
        snapshot: buildDesignSnapshot(doc),
        floors: [],
        basis: designBasis(doc),
      },
    ],
  };
}

const printed = () => document.getElementById("ds-printdoc")?.textContent ?? "";

it("prints the picklist on the crew's copy", () => {
  render(<PrintDoc model={modelWith(ALL_SECTIONS)} urls={{}} onReady={() => {}} />);
  expect(printed()).toMatch(/Material picklist/);
});

it("leaves the picklist off the customer's copy", () => {
  render(
    <PrintDoc model={modelWith({ ...ALL_SECTIONS, picklist: false })} urls={{}} onReady={() => {}} />
  );
  expect(printed()).not.toMatch(/Material picklist/);
  expect(printed()).toMatch(/Calculated heat load/);
});

it("leaves the heat loads off when they are unticked", () => {
  render(
    <PrintDoc model={modelWith({ ...ALL_SECTIONS, figures: false })} urls={{}} onReady={() => {}} />
  );
  expect(printed()).not.toMatch(/Calculated heat load/);
});

it("prints no cover at all when only plans are ticked", () => {
  render(
    <PrintDoc
      model={modelWith({ figures: false, systems: false, lines: false, picklist: false })}
      urls={{}}
      onReady={() => {}}
    />
  );
  expect(document.querySelector(".ds-print-cover")).toBeNull();
});
