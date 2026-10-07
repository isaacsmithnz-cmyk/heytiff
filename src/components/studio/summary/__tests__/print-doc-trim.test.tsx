/* A SHEET NOBODY CROPPED PRINTS FRAMED ON ITS DRAWING (job 3375, 2026-10-07).

   Its plan was a 3,680-wide screenshot of a listing's lightbox, the drawing a
   third of it: the PDF printed a small plan in a wide dark band, and every
   word sized to the sheet came out three times too big for the plan. Pages
   are trimmed at import now; the print document trims the sheets placed
   before that, off their rasters, while it waits for them anyway. */

import { act, render } from "@testing-library/react";
import { createDesign } from "@/lib/studio/document";
import { buildDesignSnapshot, designBasis } from "@/lib/studio/summary";
import { ALL_SECTIONS, type PrintModel } from "@/lib/studio/export";
import { trimOfImageUrl, withPrintTrims } from "@/lib/studio/plans";
import { PrintDoc } from "../print-doc";

jest.mock("@/lib/studio/plans", () => ({
  ...jest.requireActual("@/lib/studio/plans"),
  trimOfImageUrl: jest.fn(),
}));
const trimMock = trimOfImageUrl as jest.MockedFunction<typeof trimOfImageUrl>;

/** an Image that decodes the moment it is given a source */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function modelWith(crop?: { x: number; y: number; w: number; h: number }): PrintModel {
  const doc = createDesign({ name: "4/3 Reed Street", mode: "plan", now: "2026-10-07T00:00:00.000Z" });
  const floor = {
    id: "f1",
    name: "First Floor Plan",
    level: 0,
    scaleMmPerUnit: 12,
    northDeg: null,
    northPos: null,
    plans: [
      { id: "s1", imageRef: "r1", pageNumber: 1, name: "plan", width: 1000, height: 500, x: 0, y: 0, ...(crop ? { crop } : {}) },
    ],
  };
  doc.floors = [floor];
  return {
    options: {
      sections: { ...ALL_SECTIONS, figures: false, systems: false, lines: false, picklist: false },
      floorIds: ["f1"],
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
        sheet: { systems: [], unserved: [], picklist: [] },
        snapshot: buildDesignSnapshot(doc),
        floors: [floor],
        basis: designBasis(doc),
      },
    ],
  } as unknown as PrintModel;
}

/* the raster is twice the sheet's world size, so the trim has to be SCALED:
   pixels 500–1500 of 2000 across → world 250–750 of 1000 */
const TRIM = { x: 500, y: 0, w: 1000, h: 1000, naturalW: 2000, naturalH: 1000 };

const viewBox = () =>
  document.querySelector("#ds-printdoc svg.ds-pf")!.getAttribute("viewBox")!.split(" ").map(Number);

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    }
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  jest.spyOn(global, "Image").mockImplementation(() => new LoadingImage() as unknown as HTMLImageElement);
  trimMock.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("frames an uncropped sheet on its drawing, and only then says it is ready", async () => {
  trimMock.mockResolvedValue(TRIM);
  const onReady = jest.fn();
  render(<PrintDoc model={modelWith()} urls={{ r1: "https://signed.example/r1.png" }} onReady={onReady} />);
  await settle();

  expect(trimMock).toHaveBeenCalledWith("https://signed.example/r1.png");
  // the drawing is world 250–750 × 0–500, padded 5% of its longer side
  const [x, y, w, h] = viewBox();
  expect([x, y, w, h]).toEqual([225, -25, 550, 550]);
  expect(onReady).toHaveBeenCalledTimes(1);
});

it("prints a sheet whose raster could not be read exactly as it is", async () => {
  trimMock.mockResolvedValue(null);
  const onReady = jest.fn();
  render(<PrintDoc model={modelWith()} urls={{ r1: "https://signed.example/r1.png" }} onReady={onReady} />);
  await settle();

  expect(viewBox()).toEqual([-50, -50, 1100, 600]);
  expect(onReady).toHaveBeenCalledTimes(1);
});

it("never overrides a crop somebody made", async () => {
  trimMock.mockResolvedValue(TRIM);
  render(
    <PrintDoc
      model={modelWith({ x: 0, y: 0, w: 400, h: 500 })}
      urls={{ r1: "https://signed.example/r1.png" }}
      onReady={() => {}}
    />
  );
  await settle();
  expect(viewBox()).toEqual([-25, -25, 450, 550]);
});

describe("a floor as it prints", () => {
  const floor = modelWith().variants[0].floors[0];

  it("hands back the same floor when there is no trim to apply", () => {
    expect(withPrintTrims(floor, {})).toBe(floor);
  });

  it("leaves a hand-drawn shape alone", () => {
    const shaped = {
      ...floor,
      plans: [{ ...floor.plans[0], shape: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }],
    };
    expect(withPrintTrims(shaped, { r1: TRIM })).toBe(shaped);
  });
});
