import { act, render } from "@testing-library/react";
import type { PrintModel } from "@/lib/studio/export";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { PrintDoc } from "../print-doc";

/* THE PACK MUST NOT PRINT BEFORE THE LOGO EXISTS.

   `onReady` is wired straight to window.print(). The document already waited
   on every plan raster for exactly this reason — an <img> that has not decoded
   prints as nothing — and the letterhead is another image, arriving from a
   signed URL over the network at the same moment. Left out of that wait, the
   pack came out with a hole where the business name should be: intermittently,
   and only for whoever's logo was slow, which is the worst way to find a bug
   like this.

   The image is stubbed because jsdom never loads one — nothing fires on its
   own, so the test decides when each src completes and can therefore prove
   onReady is still waiting. */

const LOGO = "https://signed.example/logo.png";

/** Every Image constructed, so a test can complete them one at a time. */
let pending: { src: string; load: () => void; fail: () => void }[] = [];

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = "";
  set src(v: string) {
    this.#src = v;
    pending.push({
      src: v,
      load: () => this.onload?.(),
      fail: () => this.onerror?.(),
    });
  }
  get src() {
    return this.#src;
  }
}

const EMPTY_MODEL: PrintModel = {
  options: {
    content: "sheet",
    paper: "A4",
    orientation: "portrait",
    floorIds: [],
    variantIds: [],
  },
  variants: [],
} as unknown as PrintModel;

/* Let the effect's `Promise.all(...).then(...)` and its timeout fallback run.

   Several rounds, not one: Promise.all over N jobs needs more than a single
   microtask tick to settle, and the timeout it schedules is only armed once
   it has. One flush leaves the timer unscheduled and nothing fires. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    }
  });
}

beforeEach(() => {
  pending = [];
  jest.useFakeTimers();
  // rAF would otherwise never fire under fake timers; the component's own
  // timeout fallback is what we let win.
  jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  jest.spyOn(global, "Image").mockImplementation(() => new StubImage() as unknown as HTMLImageElement);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const brandWithLogo: OrgBrand = { ...NO_BRAND, name: "Smith Air", logoUrl: LOGO };

it("waits for the logo before it says it is ready to print", async () => {
  const onReady = jest.fn();
  render(<PrintDoc model={EMPTY_MODEL} urls={{}} brand={brandWithLogo} onReady={onReady} />);

  // the logo is the only image in flight, and it has not arrived
  expect(pending.map((p) => p.src)).toEqual([LOGO]);
  await settle();
  expect(onReady).not.toHaveBeenCalled();

  act(() => pending[0]!.load());
  await settle();
  expect(onReady).toHaveBeenCalledTimes(1);
});

/* The control. Without it the test above would pass just as well against a
   component that never fires onReady at all. */
it("is ready immediately when there is no logo to wait for", async () => {
  const onReady = jest.fn();
  render(<PrintDoc model={EMPTY_MODEL} urls={{}} brand={NO_BRAND} onReady={onReady} />);

  expect(pending).toHaveLength(0);
  await settle();
  expect(onReady).toHaveBeenCalledTimes(1);
});

/* A logo whose signed link died is not a reason to refuse to print — the
   is the deliverable, the letterhead is the nicety. */
it("prints anyway when the logo fails to load", async () => {
  const onReady = jest.fn();
  render(<PrintDoc model={EMPTY_MODEL} urls={{}} brand={brandWithLogo} onReady={onReady} />);

  act(() => pending[0]!.fail());
  await settle();
  expect(onReady).toHaveBeenCalledTimes(1);
});

it("waits for the plan rasters and the logo together", async () => {
  const onReady = jest.fn();
  render(
    <PrintDoc
      model={EMPTY_MODEL}
      urls={{ a: "https://signed.example/a.png" }}
      brand={brandWithLogo}
      onReady={onReady}
    />
  );

  expect(pending).toHaveLength(2);
  act(() => pending[0]!.load());
  await settle();
  // one of two home — still not ready
  expect(onReady).not.toHaveBeenCalled();

  act(() => pending[1]!.load());
  await settle();
  expect(onReady).toHaveBeenCalledTimes(1);
});
