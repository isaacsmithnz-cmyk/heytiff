import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { namePage } from "../page-names";
import { BugButton, bugUnder, pictureIn, screenshotKeys } from "../report-bug";
import { Dialog } from "@/components/parts/dialog";

/* Report bug on the website (components/shell/report-bug): the bug in the
   top bar, pressable over a pop-up too; the page draws its own picture and the dialog shows it; Add a
   screenshot puts the dialog away and says the keys, and a pasted picture
   brings it back in place of the page's; Report bug saves it, and the toast
   says its number, with Undo. */

const drawn = new Blob(["the page"], { type: "image/png" });
const domToBlob = jest.fn(async () => drawn);
jest.mock("modern-screenshot", () => ({ domToBlob: (...a: unknown[]) => domToBlob(...(a as [])) }));

const upload = jest.fn(async (..._a: unknown[]) => ({ error: null }));
jest.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: () => ({ storage: { from: (bucket: string) => ({ uploadToSignedUrl: (...a: unknown[]) => upload(bucket, ...a) }) } }),
}));

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const body = method === "POST" ? { number: 13, uploadUrl: "https://store/x", path: "bugs/org1/0013.png", token: "t" } : { number: 13 };
  return { ok: true, json: async () => body } as Response;
});

let urls = 0;
beforeAll(() => {
  Object.assign(URL, { createObjectURL: () => `blob:${++urls}`, revokeObjectURL: () => {} });
  global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
  global.fetch = fetchMock as unknown as typeof fetch;
  /* a Mac, whatever computer runs the tests */
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});

beforeEach(() => {
  calls = [];
  domToBlob.mockClear();
  upload.mockClear();
  window.history.replaceState(null, "", "/dashboard/jobs/abc?tab=scope");
  namePage("/dashboard/jobs/abc", { label: "Job 3521" });
});
afterEach(cleanup);

async function openReportBug() {
  render(<BugButton />);
  fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
  return screen.findByRole("dialog", { name: "Report bug" });
}

/** A page with a pop-up open over it, the PDF that wouldn't show. */
function PopUpPage() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <header>
        <BugButton />
      </header>
      <Dialog open={open} heading="Quote 3054.pdf" onClose={() => setOpen(false)}>
        <p>Couldn&apos;t show this file</p>
      </Dialog>
    </>
  );
}

function paste(file: File) {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: { files: [file] } });
  act(() => {
    window.dispatchEvent(e);
  });
}

describe("Report bug", () => {
  it("draws the page, holds the next number for the page you're on, and shows the picture that goes with it", async () => {
    const dialog = await openReportBug();
    expect(domToBlob).toHaveBeenCalledWith(document.body, expect.objectContaining({ type: "image/png" }));
    expect(calls[0]).toEqual({ url: "/api/bugs", method: "POST", body: { page: "Job 3521, /dashboard/jobs/abc?tab=scope" } });
    expect(dialog).toHaveTextContent("Bug 13, on Job 3521");
    expect(screen.getByRole("img", { name: "The page, as it was" })).toBeInTheDocument();
  });

  it("puts the dialog away for your screenshot, says the keys, and brings it back with what you paste", async () => {
    await openReportBug();
    fireEvent.click(screen.getByRole("button", { name: "Add a screenshot" }));
    expect(screen.queryByRole("dialog", { name: "Report bug" })).toBeNull();
    expect(screen.getByText("Press ⌘ Control Shift 4 and drag over the problem. Then press ⌘ V.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();

    paste(new File(["mine"], "Screenshot.png", { type: "image/png" }));
    await screen.findByRole("dialog", { name: "Report bug" });
    expect(screen.getByRole("img", { name: "Your screenshot" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the page's picture" }));
    expect(screen.getByRole("img", { name: "The page, as it was" })).toBeInTheDocument();
  });

  it("Back brings the dialog back as it was", async () => {
    await openReportBug();
    fireEvent.change(screen.getByLabelText("What's wrong?"), { target: { value: "Twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a screenshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("What's wrong?")).toHaveValue("Twice");
  });

  it("saves the picture you chose and what's wrong, then says its number, and Undo takes it back", async () => {
    await openReportBug();
    fireEvent.click(screen.getByRole("button", { name: "Add a screenshot" }));
    const mine = new File(["mine"], "Screenshot.png", { type: "image/png" });
    paste(mine);
    await screen.findByRole("dialog", { name: "Report bug" });
    fireEvent.change(screen.getByLabelText("What's wrong?"), { target: { value: "The supplied scope shows twice" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Report bug" })).getByRole("button", { name: "Report bug" }));

    expect(await screen.findByText("Bug 13 saved")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Report bug" })).toBeNull();
    expect(upload).toHaveBeenCalledWith("documents", "bugs/org1/0013.png", "t", mine, { contentType: "image/png" });
    expect(calls).toContainEqual({ url: "/api/bugs/13", method: "PUT", body: { note: "The supplied scope shows twice" } });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls).toContainEqual({ url: "/api/bugs/13", method: "DELETE", body: undefined }));
  });

  it("Cancel gives the number back and saves nothing", async () => {
    await openReportBug();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Report bug" })).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(calls).toContainEqual({ url: "/api/bugs/13", method: "DELETE", body: undefined });
  });
});

describe("over a pop-up", () => {
  it("rises over the scrim, opens Report bug on top, and leaves the pop-up open", async () => {
    render(<PopUpPage />);
    const raised = document.body.querySelector<HTMLButtonElement>(":scope > .fr-bugover");
    expect(raised).not.toBeNull();
    fireEvent.mouseDown(raised!);
    fireEvent.click(raised!);
    const dialog = await screen.findByRole("dialog", { name: "Report bug" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Quote 3054.pdf" })).toBeInTheDocument();
    // not raised twice while Report bug is open
    expect(document.body.querySelector(".fr-bugover")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Quote 3054.pdf" })).toBeInTheDocument();
    expect(document.body.querySelector(":scope > .fr-bugover")).not.toBeNull();
  });

  it("isn't raised while nothing is open", () => {
    render(<BugButton />);
    expect(document.body.querySelector(".fr-bugover")).toBeNull();
  });
});

describe("its words", () => {
  it("says the keys that put a screenshot on the clipboard, for the computer you're on", () => {
    expect(screenshotKeys("macOS")).toBe("Press ⌘ Control Shift 4 and drag over the problem. Then press ⌘ V.");
    expect(screenshotKeys("MacIntel")).toMatch(/^Press ⌘ Control Shift 4/);
    expect(screenshotKeys("Win32")).toBe("Press Windows Shift S and drag over the problem. Then press Ctrl V.");
    expect(screenshotKeys("Windows")).toMatch(/^Press Windows Shift S/);
    expect(screenshotKeys("darwin")).toMatch(/^Take a screenshot/);
    expect(screenshotKeys("Linux x86_64")).toBe("Take a screenshot of the problem. Then press Ctrl V.");
  });

  it("takes the first picture among the files, and nothing else", () => {
    const text = new File(["x"], "a.txt", { type: "text/plain" });
    const png = new File(["x"], "b.png", { type: "image/png" });
    expect(pictureIn([text, png])).toBe(png);
    expect(pictureIn([text])).toBeNull();
    expect(pictureIn(null)).toBeNull();
  });

  it("names the bug, and the page where it has a name", () => {
    expect(bugUnder(13, "Job 3521")).toBe("Bug 13, on Job 3521");
    expect(bugUnder(13, null)).toBe("Bug 13");
  });
});
