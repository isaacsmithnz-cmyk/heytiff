import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocSearch } from "../doc-search";

/* Find-in-document.

   What these pin: a hit is a DOORWAY — pressing one opens the PDF at that
   passage's own page, which is the whole reason this exists rather than a note
   telling people to press Ctrl+F. And an empty result is a sentence, not a
   blank panel: it names what was searched for and offers the other way to
   look. The windowing and highlighting have their own suite; the action is
   mocked here so the panel's behaviour is the panel's. */

const kbDocUrl = jest.fn();
const searchKbDoc = jest.fn();
jest.mock("@/app/actions/kb", () => ({
  kbDocUrl: (...a: unknown[]) => kbDocUrl(...(a as [])),
  searchKbDoc: (...a: unknown[]) => searchKbDoc(...(a as [])),
}));

const DOC = { id: "d-1", title: "PEA-M100-160HAA Jan2023" };

const hit = (over: Record<string, unknown> = {}) => ({
  chunkId: "c-1",
  pageFrom: 34,
  pageTo: 34,
  heading: null,
  segments: [
    { text: "Turn off compressor and indoor fan. ", hit: false },
    { text: "Drain pump", hit: true },
    { text: " is abnormal if the condition above is detected.", hit: false },
  ],
  ...over,
});

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

const search = async (term: string) => {
  await userEvent.type(screen.getByLabelText("Search inside this document"), term);
  await userEvent.click(screen.getByRole("button", { name: /Search/ }));
};

describe("searching", () => {
  it("asks the document, and shows the passage with the term marked", async () => {
    searchKbDoc.mockResolvedValue({ ok: true, hits: [hit()], capped: false });
    render(<DocSearch doc={DOC} onClose={jest.fn()} />);

    await search("drain pump");

    expect(searchKbDoc).toHaveBeenCalledWith("d-1", "drain pump");
    await screen.findByText("p.34");
    const mark = document.querySelector("mark");
    expect(mark).toHaveTextContent("Drain pump");
    expect(screen.getByText(/1 passage matching/)).toBeInTheDocument();
  });

  /* Two characters is the floor — one would match a prefix of half the manual,
     so the button doesn't pretend to be pressable. */
  it("won't search on a single character", async () => {
    render(<DocSearch doc={DOC} onClose={jest.fn()} />);

    await userEvent.type(screen.getByLabelText("Search inside this document"), "P");
    expect(screen.getByRole("button", { name: /Search/ })).toBeDisabled();
    expect(searchKbDoc).not.toHaveBeenCalled();
  });

  /* Not a dead end: the word may be in another manual, and the assistant is
     the way to look across all of them. */
  it("says what found nothing, and where else to look", async () => {
    searchKbDoc.mockResolvedValue({ ok: true, hits: [], capped: false });
    render(<DocSearch doc={DOC} onClose={jest.fn()} />);

    await search("zzznotathing");

    expect(await screen.findByText(/Nothing in this document matches/)).toBeInTheDocument();
    expect(screen.getByText(/ask Tiff/)).toBeInTheDocument();
  });

  it("admits when the list was cut rather than implying that's all of them", async () => {
    searchKbDoc.mockResolvedValue({ ok: true, hits: [hit()], capped: true });
    render(<DocSearch doc={DOC} onClose={jest.fn()} />);

    await search("valve");
    expect(await screen.findByText(/1\+ passage/)).toBeInTheDocument();
  });

  it("shows the reason when the search itself fails", async () => {
    searchKbDoc.mockResolvedValue({ ok: false, error: "You don't have access to the library." });
    render(<DocSearch doc={DOC} onClose={jest.fn()} />);

    await search("valve");
    expect(await screen.findByText("You don't have access to the library.")).toBeInTheDocument();
  });
});

describe("a hit is a doorway", () => {
  /* THE POINT OF THE WHOLE PANEL. Landing on page 1 of a 220-page manual and
     scrolling is the thing this replaces. */
  it("opens the document at the passage's own page", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.fn(() => tab);
    Object.defineProperty(window, "open", { value: open, writable: true });

    searchKbDoc.mockResolvedValue({ ok: true, hits: [hit({ pageFrom: 34, pageTo: 35 })], capped: false });
    kbDocUrl.mockResolvedValue({ ok: true, url: "https://signed.example/doc.pdf?token=abc" });

    render(<DocSearch doc={DOC} onClose={jest.fn()} />);
    await search("drain pump");

    await userEvent.click(await screen.findByRole("button", { name: /p\.34–35/ }));

    await waitFor(() =>
      expect(tab.location.href).toBe("https://signed.example/doc.pdf?token=abc#page=34")
    );
    // the tab is opened on the gesture, before the signed URL is asked for —
    // a pop-up blocker only trusts a window opened during the click
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
  });

  it("closes the tab it opened and says why when the link can't be minted", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    Object.defineProperty(window, "open", { value: jest.fn(() => tab), writable: true });

    searchKbDoc.mockResolvedValue({ ok: true, hits: [hit()], capped: false });
    kbDocUrl.mockResolvedValue({ ok: false, error: "That file couldn't be opened." });

    render(<DocSearch doc={DOC} onClose={jest.fn()} />);
    await search("drain pump");
    await userEvent.click(await screen.findByRole("button", { name: /p\.34/ }));

    expect(await screen.findByText("That file couldn't be opened.")).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });
});
