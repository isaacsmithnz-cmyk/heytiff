/* How a plan sheet ARRIVES on the canvas (field feedback 2026-07-26: "can it
   fade in when it's loaded" instead of appearing top-first and slowly
   revealing more).

   Handing the URL straight to <image> let the browser paint the raster as it
   streamed — a plan that wiped down the page over a second or two. The URL is
   now published only once the bytes decode, so the element mounts with the
   whole picture and fades in; until then the sheet's footprint is held. */

import { render, act } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import type { PlanImages } from "@/lib/studio/plans";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [
    {
      id: "s1",
      imageRef: "org1/plan.png",
      pageNumber: 1,
      name: "GF",
      width: 600,
      height: 420,
      x: -300,
      y: -210,
    },
  ],
};

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "plan", now: "2026-07-26T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [];
  return d;
}

const images: PlanImages = {
  upload: async () => "",
  uploadSource: async () => "",
  sourceFile: async () => new File([], "x"),
  remove: async () => {},
  url: async () => "https://store/plan.png?token=1",
};

/* a controllable Image: the test decides when the raster finishes decoding */
let releaseDecode: (() => void) | null = null;
let origImage: typeof Image;

beforeEach(() => {
  origImage = global.Image;
  global.Image = class {
    src = "";
    naturalWidth = 600;
    naturalHeight = 420;
    decode() {
      return new Promise<void>((res) => {
        releaseDecode = () => res();
      });
    }
  } as unknown as typeof Image;
});

afterEach(() => {
  global.Image = origImage;
  releaseDecode = null;
});

function renderCanvas() {
  const utils = render(
    <StudioCanvas
      doc={mkDoc()}
      floor={floor}
      tool="select"
      selectedId={null}
      onSelect={() => {}}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      planImages={images}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe("a plan sheet arrives whole, not in pieces", () => {
  it("holds the sheet's frame while the raster is still decoding", async () => {
    const { svg } = renderCanvas();
    await flush();

    // nothing is drawn from a half-arrived raster…
    expect(svg.querySelector("image")).toBeNull();
    // …but the frame it will land in is held, at the sheet's real footprint
    const frame = svg.querySelector(".ds-sheet-loading")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("width")).toBe("600");
    expect(frame.getAttribute("height")).toBe("420");
  });

  it("draws it the moment it has decoded, and drops the held frame", async () => {
    const { svg } = renderCanvas();
    await flush();
    await act(async () => {
      releaseDecode!();
    });

    const img = svg.querySelector("image")!;
    expect(img.getAttribute("href")).toBe("https://store/plan.png?token=1");
    expect(img.getAttribute("class")).toContain("ds-plan"); // carries the fade
    expect(svg.querySelector(".ds-sheet-loading")).toBeNull();
  });
});
