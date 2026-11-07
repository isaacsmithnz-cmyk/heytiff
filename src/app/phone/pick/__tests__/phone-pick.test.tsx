/* The phone's PDF picker: it says ready and what was chosen, and puts that
   file only in a Library slot it was handed. */

import { act, fireEvent, render } from "@testing-library/react";

const uploadToSignedUrl = jest.fn();
const transports: (typeof fetch)[] = [];
jest.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: (transport: typeof fetch) => {
    transports.push(transport);
    return { storage: { from: (bucket: string) => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(bucket, ...a) }) } };
  },
}));

import { fetchSaying, isOurFrame, isSlot, PhonePick, typeOf } from "../phone-pick";

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

type FakeXhr = {
  open: jest.Mock;
  setRequestHeader: jest.Mock;
  send: jest.Mock;
  getResponseHeader: () => string;
  status: number;
  responseText: string;
  upload: { onprogress?: (e: ProgressEvent) => void };
  onload?: () => void;
  onerror?: () => void;
};
const fakes: FakeXhr[] = [];
beforeEach(() => {
  /* a plain function: the suite's config resets a jest.fn's body before each test */
  global.XMLHttpRequest = function () {
    const x: FakeXhr = {
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      send: jest.fn(),
      getResponseHeader: () => "application/json",
      status: 200,
      responseText: '{"Key":"k"}',
      upload: {},
    };
    fakes.push(x);
    return x;
  } as unknown as typeof XMLHttpRequest;
  /* jsdom has no Response */
  global.Response = class {
    ok: boolean;
    constructor(
      private text: string,
      init: { status: number },
    ) {
      this.ok = init.status >= 200 && init.status < 300;
    }
    json = async () => JSON.parse(this.text);
  } as unknown as typeof Response;
});

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

  it("sends a file whose type the phone didn't say as a PDF, under its own name", async () => {
    const { container } = render(<PhonePick />);
    choose(container, new File(["%PDF"], "a.pdf", { type: "" }));
    await act(async () => {
      window.heytiffPick!(slot);
      await new Promise((r) => setTimeout(r));
    });
    const sent = uploadToSignedUrl.mock.calls[0][3] as File;
    expect([sent.name, sent.type, sent.size]).toEqual(["a.pdf", "application/pdf", 4]);
  });

  it("says how much of the file has gone, however much the form it goes in adds", async () => {
    uploadToSignedUrl.mockImplementation(async () => {
      fakes.length = 0;
      void transports.at(-1)!("https://s/up", { method: "PUT" });
      fakes[0].upload.onprogress!({ lengthComputable: true, loaded: 300, total: 300 } as ProgressEvent);
      return { error: null };
    });
    const { container } = render(<PhonePick />);
    choose(container, pdf);
    await act(async () => {
      window.heytiffPick!(slot);
      await new Promise((r) => setTimeout(r));
    });
    expect(said.at(-2)).toEqual({ pick: "progress", sent: pdf.size, total: pdf.size });
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

describe("fetchSaying", () => {
  beforeEach(() => void (fakes.length = 0));

  it("sends what it's given and answers as fetch would", async () => {
    const gone = jest.fn();
    const body = new FormData();
    const asked = fetchSaying(gone)("https://s/up?token=t", { method: "PUT", headers: new Headers({ "x-upsert": "false" }), body });
    const x = fakes[0];
    expect(x.open).toHaveBeenCalledWith("PUT", "https://s/up?token=t");
    expect(x.setRequestHeader).toHaveBeenCalledWith("x-upsert", "false");
    expect(x.send).toHaveBeenCalledWith(body);
    x.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    expect(gone).toHaveBeenCalledWith(5, 10);
    x.onload!();
    const res = await asked;
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ Key: "k" });
  });

  it("answers a refusal as a refusal, and fails when the connection does", async () => {
    const refused = fetchSaying(jest.fn())("https://s/up", { method: "PUT" });
    fakes[0].status = 400;
    fakes[0].onload!();
    expect((await refused).ok).toBe(false);
    const lost = fetchSaying(jest.fn())("https://s/up", { method: "PUT" });
    fakes[1].onerror!();
    await expect(lost).rejects.toThrow(TypeError);
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
