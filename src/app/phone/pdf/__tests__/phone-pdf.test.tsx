/* The phone's manual page: it says ready to the app, reads only a link into
   HeyTiff's own storage, says how many pages and which is in view, and
   outlines the words searched where the page's own text says them. */

import { act, render } from "@testing-library/react";

const openSigned = jest.fn();
jest.mock("../load-pdf", () => ({ openSigned: (...a: unknown[]) => openSigned(...a) }));

import { boxesOf, isOurs, PhonePdf, seenOf } from "../phone-pdf";

const STORE = "https://store.example.co";
const ours = `${STORE}/storage/v1/object/sign/kb/org/o1/kb/d1.pdf?token=t`;
const said: unknown[] = [];

/* a page as pdf.js gives it at scale 1: 100 wide, 140 tall, y counted up from the foot */
const page = { width: 100, height: 140, transform: [1, 0, 0, -1, 0, 140] };
const fakeDoc = (numPages: number) => ({
  numPages,
  getPage: async () => ({
    getViewport: () => page,
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    getTextContent: async () => ({ items: [] }),
  }),
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = STORE;
  said.length = 0;
  openSigned.mockReset();
  window.ReactNativeWebView = { postMessage: (m) => said.push(JSON.parse(m)) };
  Element.prototype.scrollIntoView = jest.fn();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({})) as never;
});
afterEach(() => {
  delete window.ReactNativeWebView;
});

describe("isOurs", () => {
  it("reads a signed link into HeyTiff's storage and nothing else", () => {
    expect(isOurs(ours)).toBe(true);
    expect(isOurs(`${STORE}/storage/v1/object/public/kb/x.pdf`)).toBe(false);
    expect(isOurs("https://elsewhere.example/storage/v1/object/sign/kb/x.pdf")).toBe(false);
    expect(isOurs(`https://evil.example/?u=${STORE}/storage/v1/object/sign/`)).toBe(false);
  });
});

describe("boxesOf", () => {
  /* "Check code 4220" set 10 high, 75 wide, its baseline 20 from the top */
  const run = { str: "Check code 4220", transform: [10, 0, 0, 10, 10, 120], width: 75 };

  it("outlines the word where it falls in its run, as fractions of the page", () => {
    const [b, ...more] = boxesOf([run], ["4220"], page);
    expect(more).toEqual([]);
    expect(b!.left).toBeCloseTo((10 + (75 * 11) / 15) / 100);
    expect(b!.top).toBeCloseTo(10 / 140);
    expect(b!.width).toBeCloseTo((75 * 4) / 15 / 100);
    expect(b!.height).toBeCloseTo(10 / 140);
  });

  it("matches whatever the case, and leaves out one-letter words", () => {
    expect(boxesOf([run], ["CHECK", "e"], page)).toHaveLength(1);
  });

  it("outlines nothing on text turned on its side, or a page that doesn't say it", () => {
    expect(boxesOf([{ ...run, transform: [0, 10, -10, 0, 10, 120] }], ["4220"], page)).toEqual([]);
    expect(boxesOf([run], ["4230"], page)).toEqual([]);
  });
});

describe("seenOf", () => {
  /* a page 360 wide and 500 tall, 100 down the layout */
  const page = { left: 10, top: 100, width: 360, height: 500 };

  it("is the part of the page the zoomed screen shows, as fractions of it", () => {
    /* zoomed 3×: a screen 130 by 260 of the layout, its corner at (100, 200) */
    const b = seenOf(page, { left: 100, top: 200, width: 130, height: 260 })!;
    expect(b.left).toBeCloseTo(90 / 360);
    expect(b.top).toBeCloseTo(100 / 500);
    expect(b.width).toBeCloseTo(130 / 360);
    expect(b.height).toBeCloseTo(260 / 500);
  });

  it("stops at the page's edges", () => {
    const b = seenOf(page, { left: 300, top: 550, width: 130, height: 260 })!;
    expect(b.left + b.width).toBeCloseTo(1);
    expect(b.top + b.height).toBeCloseTo(1);
  });

  it("is nothing for a page off the screen", () => {
    expect(seenOf(page, { left: 0, top: 700, width: 130, height: 260 })).toBeNull();
  });
});

describe("PhonePdf", () => {
  it("says ready, then opens the link it's handed and says its pages", async () => {
    openSigned.mockResolvedValue(fakeDoc(3));
    const { container } = render(<PhonePdf />);
    expect(said).toEqual([{ pdf: "ready" }]);
    await act(async () => window.heytiffPdf!({ url: ours }));
    expect(openSigned).toHaveBeenCalledWith(ours, expect.any(Function));
    expect(container.querySelectorAll("[data-n]")).toHaveLength(3);
    /* jsdom lays nothing out, so which page is in view is the browser's to say; how many isn't */
    expect(said).toContainEqual(expect.objectContaining({ pdf: "at", pages: 3 }));
  });

  it("reads no link but its own storage's, and says it failed", async () => {
    render(<PhonePdf />);
    await act(async () => window.heytiffPdf!({ url: "https://elsewhere.example/manual.pdf" }));
    expect(openSigned).not.toHaveBeenCalled();
    expect(said).toContainEqual({ pdf: "failed" });
  });

  it("goes to the page it's asked for", async () => {
    openSigned.mockResolvedValue(fakeDoc(80));
    const { container } = render(<PhonePdf />);
    await act(async () => window.heytiffPdf!({ url: ours, page: 72, marks: ["4220"] }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect((jest.mocked(Element.prototype.scrollIntoView).mock.contexts[0] as HTMLElement).dataset.n).toBe("72");
    expect(container.querySelectorAll("[data-n]")).toHaveLength(80);
  });

  it("takes a posted message too, for the app's web build in a frame", async () => {
    openSigned.mockResolvedValue(fakeDoc(2));
    render(<PhonePdf />);
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { heytiffPdf: { url: ours } } })));
    expect(openSigned).toHaveBeenCalledWith(ours, expect.any(Function));
  });
});
