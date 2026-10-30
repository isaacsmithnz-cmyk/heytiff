/* The phone's PDF picker: it says ready and what was chosen, and puts that
   file only in a Library slot it was handed. */

import { act, fireEvent, render } from "@testing-library/react";

const uploadToSignedUrl = jest.fn();
jest.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: () => ({ storage: { from: (bucket: string) => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(bucket, ...a) }) } }),
}));

import { isOurFrame, isSlot, PhonePick, typeOf } from "../phone-pick";

const said: unknown[] = [];
const slot = { bucket: "kb", ref: "org/o1/kb/d1.pdf", token: "t" };
const pdf = new File(["%PDF"], "Main-Zone-Controller_IM.pdf", { type: "application/pdf" });

beforeEach(() => {
  said.length = 0;
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
  window.ReactNativeWebView = { postMessage: (m) => void said.push(JSON.parse(m)) };
});
afterEach(() => {
  delete window.ReactNativeWebView;
});

const choose = (c: HTMLElement, f: File) => fireEvent.change(c.querySelector("input")!, { target: { files: [f] } });

describe("the picker", () => {
  it("says ready, then the file chosen", () => {
    const { container } = render(<PhonePick />);
    expect(said).toEqual([{ pick: "ready" }]);
    choose(container, pdf);
    expect(said[1]).toEqual({ pick: "chosen", name: pdf.name, size: pdf.size, type: "application/pdf" });
  });

  it("puts the chosen file in the slot it's handed, pinned as a PDF", async () => {
    const { container } = render(<PhonePick />);
    choose(container, pdf);
    await act(async () => {
      window.heytiffPick!(slot);
      await new Promise((r) => setTimeout(r));
    });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("kb", slot.ref, "t", pdf, { contentType: "application/pdf" });
    expect(said.at(-1)).toEqual({ pick: "sent" });
  });

  it("says so when the upload fails", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: new Error("nope") });
    const { container } = render(<PhonePick />);
    choose(container, pdf);
    await act(async () => {
      window.heytiffPick!(slot);
      await new Promise((r) => setTimeout(r));
    });
    expect(said.at(-1)).toEqual({ pick: "failed", error: "That upload didn't finish." });
  });

  it("sends nothing to a slot outside the Library, or with no file chosen", async () => {
    const { container } = render(<PhonePick />);
    await act(async () => window.heytiffPick!(slot));
    choose(container, pdf);
    await act(async () => window.heytiffPick!({ ...slot, bucket: "documents" }));
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(said.filter((m) => (m as { pick: string }).pick === "failed")).toHaveLength(2);
  });
});

describe("its rules", () => {
  it("takes a PDF's name where the phone doesn't say its type", () => {
    expect(typeOf({ name: "a.PDF", type: "" })).toBe("application/pdf");
    expect(typeOf({ name: "a.jpg", type: "" })).toBe("");
    expect(typeOf({ name: "a.jpg", type: "image/jpeg" })).toBe("image/jpeg");
  });

  it("knows a Library slot", () => {
    expect(isSlot(slot)).toBe(true);
    expect(isSlot({ ...slot, ref: "org/o1/other/d1.pdf" })).toBe(false);
    expect(isSlot({ ...slot, token: "" })).toBe(false);
    expect(isSlot(null)).toBe(false);
  });

  it("hears a frame only from this machine", () => {
    expect(isOurFrame("http://localhost:8081")).toBe(true);
    expect(isOurFrame("https://evil.example")).toBe(false);
    expect(isOurFrame("null")).toBe(false);
  });
});
