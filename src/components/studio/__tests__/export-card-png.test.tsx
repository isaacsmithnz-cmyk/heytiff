/* PNG-per-floor, and the button getting un-stuck afterwards.

   Written because export-card.tsx had no test of any kind and was about to
   have three things rewritten in it to let React Compiler compile it: the
   `finally` that cleared the busy flag became a catch plus a trailing call,
   the per-floor loop moved out of the try into an inner function, and the
   error is now logged where it used to propagate. The first two are meant to
   be exactly equivalent, and "meant to be" is what tests are for.

   The failure case is the one worth having. A `finally` clears the flag on
   every path by construction; hand-written cleanup on two paths can miss one,
   and the symptom is a button that says "Drawing…" forever with no way back
   short of a reload. */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ExportCard } from "../summary/export-card";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";
import type { PlanImages } from "@/lib/studio/plans";

const svgToPngBlob = jest.fn(async () => new Blob(["png"]));
const inlineImageUrls = jest.fn(async (r: Record<string, string>) => r);
jest.mock("@/lib/studio/export-png", () => ({
  svgToPngBlob: (...a: unknown[]) => svgToPngBlob(...(a as [])),
  inlineImageUrls: (...a: unknown[]) => inlineImageUrls(...(a as [never])),
  pngFileName: (_d: unknown, f: { id: string }) => `${f.id}.png`,
}));

/* the figure only has to produce SOME markup — an empty one is skipped by
   design ("an empty floor draws nothing"), which would hide the loop */
jest.mock("../summary/plan-figure", () => ({
  PlanFigure: () => <svg data-figure="1" />,
}));

const mkFloor = (id: string, level: number): Floor => ({
  id,
  name: `L${level}`,
  level,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [{ id: `${id}-s`, imageRef: `${id}-ref`, width: 100, height: 100 }] as Floor["plans"],
});

function mkDoc(floors: Floor[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-25T00:00:00.000Z" });
  d.floors = floors;
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  return d;
}

const planImages = { url: async (r: string) => `blob:${r}` } as unknown as PlanImages;

function renderCard(doc: DesignDocument) {
  return render(
    <ExportCard
      doc={doc}
      pack={null}
      planImages={planImages}
      empty={false}
      onExportJson={() => {}}
      loadVariant={async () => null}
    />
  );
}

const pngButton = () => screen.getByRole("button", { name: /PNG per floor|Drawing/ });

let createObjectURL: jest.Mock;
let clicks: number;

beforeEach(() => {
  svgToPngBlob.mockClear().mockResolvedValue(new Blob(["png"]));
  inlineImageUrls.mockClear();
  createObjectURL = jest.fn(() => "blob:out");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
  clicks = 0;
  // the download is an <a>.click(); count them without navigating jsdom
  jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicks += 1;
    });
});

afterEach(() => jest.restoreAllMocks());

describe("PNG per floor", () => {
  it("draws one image per selected floor, not just the first", async () => {
    renderCard(mkDoc([mkFloor("f1", 0), mkFloor("f2", 1), mkFloor("f3", 2)]));

    fireEvent.click(pngButton());

    await waitFor(() => expect(pngButton()).toHaveTextContent("PNG per floor"));
    expect(svgToPngBlob).toHaveBeenCalledTimes(3);
    expect(clicks).toBe(3);
  });

  it("says so while it works, then gives the button back", async () => {
    renderCard(mkDoc([mkFloor("f1", 0)]));

    fireEvent.click(pngButton());
    expect(pngButton()).toHaveTextContent("Drawing…");

    await waitFor(() => expect(pngButton()).toHaveTextContent("PNG per floor"));
    expect(pngButton()).not.toBeDisabled();
  });

  /* THE STUCK-BUTTON CASE. Cleanup on the failure path is hand-written now,
     so this is the assertion that it exists at all. */
  it("gives the button back when the raster fails, rather than sticking on Drawing…", async () => {
    svgToPngBlob.mockRejectedValue(new Error("canvas gave up"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    renderCard(mkDoc([mkFloor("f1", 0)]));
    fireEvent.click(pngButton());

    await waitFor(() => expect(pngButton()).toHaveTextContent("PNG per floor"));
    expect(pngButton()).not.toBeDisabled();
    expect(clicks).toBe(0);
    // the failure is reported, not swallowed
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("PNG export failed"));
  });

  it("can be run again after a failure", async () => {
    svgToPngBlob.mockRejectedValueOnce(new Error("once"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    renderCard(mkDoc([mkFloor("f1", 0)]));
    fireEvent.click(pngButton());
    await waitFor(() => expect(pngButton()).toHaveTextContent("PNG per floor"));

    fireEvent.click(pngButton());
    await waitFor(() => expect(clicks).toBe(1));
  });
});
