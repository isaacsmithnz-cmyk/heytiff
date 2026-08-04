import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeBase, type KbLibraryDoc, type KbQuotaView } from "../knowledge";

/* The library screen.

   What these pin: a document that isn't ready SAYS SO, in words that name the
   reason and the way out; the manager's affordances are ABSENT for staff
   rather than disabled; and the day-1 empty state sells the reason to upload
   before it offers the button. The ingest loop has its own suite — it is
   mocked here so a row's pill is the row's, not a network race's. */

const refresh = jest.fn();
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const kbDocUrl = jest.fn();
const retryKbDoc = jest.fn();
const updateKbDocMeta = jest.fn();
const deleteKbDoc = jest.fn();
jest.mock("@/app/actions/kb", () => ({
  kbDocUrl: (...a: unknown[]) => kbDocUrl(...(a as [])),
  retryKbDoc: (...a: unknown[]) => retryKbDoc(...(a as [])),
  updateKbDocMeta: (...a: unknown[]) => updateKbDocMeta(...(a as [])),
  deleteKbDoc: (...a: unknown[]) => deleteKbDoc(...(a as [])),
  beginKbUpload: jest.fn(),
  confirmKbUpload: jest.fn(),
}));

const start = jest.fn();
jest.mock("@/lib/tiff/use-kb-ingest", () => ({
  useKbIngest: () => ({ progress: {}, busy: false, start }),
}));

const doc = (over: Partial<KbLibraryDoc> = {}): KbLibraryDoc => ({
  id: "d-1",
  category: "faults",
  title: "City Multi fault codes",
  source: "Mitsubishi Electric",
  edition: "2026 revision B",
  kind: "PDF",
  storageRef: "org/org-1/kb/d-1.pdf",
  sizeBytes: 4_200_000,
  pageCount: 220,
  scannedPages: 0,
  status: "ready",
  error: null,
  nextPage: 221,
  chunkCount: 310,
  uploadedById: "s-1",
  uploadedAt: "2026-08-01T02:00:00Z",
  updatedAt: "2026-08-01T02:00:00Z",
  uploaderName: "Dane Poulos",
  ...over,
});

const quota = (over: Partial<KbQuotaView> = {}): KbQuotaView => ({
  plan: "standard",
  month: "2026-08-01",
  pagesUsed: 1240,
  questionsAsked: 12,
  pagesAllowed: 2000,
  resetsOn: "2026-09-01",
  ...over,
});

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

describe("the day-1 state sells the reason before the button", () => {
  it("tells a manager what the library is for, and offers the upload", () => {
    render(<KnowledgeBase docs={[]} quota={quota()} canManage />);

    expect(screen.getByText(/Tiff can only answer from what/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add documents/ })).toBeInTheDocument();
    // nothing to search or filter yet — the controls would be furniture
    expect(screen.queryByLabelText("Search documents")).not.toBeInTheDocument();
  });

  it("tells staff who to ask, and offers them nothing to press", () => {
    render(<KnowledgeBase docs={[]} quota={quota()} />);

    expect(screen.getByText(/Tiff can only answer from what/)).toBeInTheDocument();
    expect(screen.getByText(/Ask a manager to add/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add documents/ })).not.toBeInTheDocument();
  });

  it("names all four shelves so the reason is concrete", () => {
    render(<KnowledgeBase docs={[]} quota={quota()} canManage />);
    for (const label of ["Install procedures", "Fault code library", "Manufacturer specs", "Company SOPs"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("what a row says about itself", () => {
  it("a document being read shows how far through it is", () => {
    render(<KnowledgeBase docs={[doc({ status: "processing", nextPage: 41, pageCount: 220 })]} canManage />);
    expect(screen.getByText("Reading… 40 of 220 pages")).toBeInTheDocument();
  });

  it("a document not yet opened reads honestly rather than as 0 of 0", () => {
    render(<KnowledgeBase docs={[doc({ status: "processing", nextPage: 1, pageCount: null })]} canManage />);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("a document out of pages says when it comes back, and offers Resume", () => {
    render(<KnowledgeBase docs={[doc({ status: "paused", nextPage: 81 })]} quota={quota()} canManage />);

    expect(screen.getByText("Out of pages — resumes 1 Sept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("a failed document carries its reason and a Retry", () => {
    render(<KnowledgeBase docs={[doc({ status: "failed", error: "That PDF couldn't be opened." })]} canManage />);

    expect(screen.getByText("That PDF couldn't be opened.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a ready document with scanned pages admits what it couldn't read", () => {
    render(<KnowledgeBase docs={[doc({ scannedPages: 12 })]} canManage />);
    expect(screen.getByText("Ready · 12 pages unreadable — scanned images")).toBeInTheDocument();
  });

  it("a clean ready document just says Ready", () => {
    render(<KnowledgeBase docs={[doc()]} canManage />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows source, edition, when it changed and who added it", () => {
    render(<KnowledgeBase docs={[doc()]} />);
    expect(
      screen.getByText("Mitsubishi Electric · 2026 revision B · Updated 1 Aug · Added by Dane Poulos")
    ).toBeInTheDocument();
  });

  it("staff never see Retry or Resume — the loop is not theirs to drive", () => {
    render(<KnowledgeBase docs={[doc({ status: "failed", error: "That file couldn't be read." })]} />);

    expect(screen.getByText("That file couldn't be read.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("opening the document", () => {
  it("signs a URL on the click and hands it to a new tab", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    kbDocUrl.mockResolvedValue({ ok: true, url: "https://signed.example/manual.pdf" });

    render(<KnowledgeBase docs={[doc()]} />);
    await userEvent.click(screen.getByRole("button", { name: "City Multi fault codes" }));

    await waitFor(() => expect(tab.location.href).toBe("https://signed.example/manual.pdf"));
    expect(kbDocUrl).toHaveBeenCalledWith("d-1");
    open.mockRestore();
  });

  it("puts a refusal on the row rather than leaving a blank tab open", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    kbDocUrl.mockResolvedValue({ ok: false, error: "That document is no longer here." });

    render(<KnowledgeBase docs={[doc()]} />);
    await userEvent.click(screen.getByRole("button", { name: "City Multi fault codes" }));

    expect(await screen.findByText("That document is no longer here.")).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it("a document still being read is not a link to press", () => {
    render(<KnowledgeBase docs={[doc({ status: "processing", nextPage: 21 })]} />);
    expect(screen.queryByRole("button", { name: /City Multi fault codes/ })).not.toBeInTheDocument();
  });
});

describe("the month's page allowance", () => {
  it("shows the count and the reset date to a manager", () => {
    render(<KnowledgeBase docs={[doc()]} quota={quota()} canManage />);
    expect(screen.getByText("1,240 of 2,000 pages this month · resets 1 Sept")).toBeInTheDocument();
  });

  it("says Unlimited pages rather than a number on the unlimited tier", () => {
    render(<KnowledgeBase docs={[doc()]} quota={quota({ plan: "unlimited", pagesAllowed: null })} canManage />);
    expect(screen.getByText("Unlimited pages")).toBeInTheDocument();
  });

  it("is a manager's line — staff are not billed and are not told", () => {
    render(<KnowledgeBase docs={[doc()]} quota={quota()} />);
    expect(screen.queryByText(/pages this month/)).not.toBeInTheDocument();
  });
});

/* ── "Ask Tiff about this document" (brief §4D) ──────────────────────────── */

describe("asking Tiff about a row", () => {
  const ASK_KEY = "heytiff.tiff.ask.v1";

  beforeEach(() => sessionStorage.clear());

  /* Reading the library and asking about it are the same permission —
     `tiff_manage` is about CHANGING the library, not using it. */
  it("is offered to staff, not only to the people who can upload", () => {
    render(<KnowledgeBase docs={[doc()]} />);
    expect(
      screen.getByRole("button", { name: "Ask Tiff about City Multi fault codes" })
    ).toBeInTheDocument();
  });

  it("leaves the document as the opening of a sentence and goes to Tiff", async () => {
    render(<KnowledgeBase docs={[doc()]} canManage />);

    await userEvent.click(
      screen.getByRole("button", { name: "Ask Tiff about City Multi fault codes" })
    );

    expect(sessionStorage.getItem(ASK_KEY)).toBe("In “City Multi fault codes”, ");
    expect(push).toHaveBeenCalledWith("/dashboard/tiff");
  });

  /* Tiff can't be asked about pages it hasn't read. An affordance that leads
     to a shrug is worse than no affordance. */
  it("stays off a document Tiff hasn't finished reading", () => {
    render(
      <KnowledgeBase
        docs={[
          doc({ status: "processing", nextPage: 40 }),
          doc({ id: "d-2", title: "PUZ install manual", status: "failed", error: "Couldn't be read" }),
          doc({ id: "d-3", title: "Warranty SOP", status: "paused" }),
        ]}
        canManage
      />
    );

    expect(screen.queryByRole("button", { name: /^Ask Tiff about/ })).not.toBeInTheDocument();
  });
});

describe("who may do what", () => {
  it("a manager gets edit but not remove", () => {
    render(<KnowledgeBase docs={[doc()]} canManage />);

    expect(screen.getByRole("button", { name: "Edit City Multi fault codes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove City Multi fault codes" })).not.toBeInTheDocument();
  });

  it("only the owner gets remove, and the confirm names the document", async () => {
    render(<KnowledgeBase docs={[doc()]} canManage isOwner />);

    await userEvent.click(screen.getByRole("button", { name: "Remove City Multi fault codes" }));

    const dialog = screen.getByRole("dialog", { name: "Remove document" });
    expect(within(dialog).getByText(/Remove “City Multi fault codes”\?/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Remove “City Multi fault codes”/ })).toBeInTheDocument();
  });

  it("confirming the removal is what calls the action, not opening the dialog", async () => {
    deleteKbDoc.mockResolvedValue({ ok: true });
    render(<KnowledgeBase docs={[doc()]} canManage isOwner />);

    await userEvent.click(screen.getByRole("button", { name: "Remove City Multi fault codes" }));
    expect(deleteKbDoc).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Remove document" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove “City Multi fault codes”/ }));

    await waitFor(() => expect(deleteKbDoc).toHaveBeenCalledWith("d-1"));
  });

  it("staff get no row actions at all — absent, not disabled", () => {
    const { container } = render(<KnowledgeBase docs={[doc()]} />);
    expect(container.querySelector(".tk-acts")).toBeNull();
  });

  it("edits go through updateKbDocMeta and refresh the page", async () => {
    updateKbDocMeta.mockResolvedValue({ ok: true });
    render(<KnowledgeBase docs={[doc()]} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Edit City Multi fault codes" }));
    await userEvent.click(screen.getByRole("button", { name: /Save details/ }));

    await waitFor(() =>
      expect(updateKbDocMeta).toHaveBeenCalledWith("d-1", {
        title: "City Multi fault codes",
        category: "faults",
        source: "Mitsubishi Electric",
        edition: "2026 revision B",
      })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a Retry restarts the server row and rejoins the reading queue", async () => {
    retryKbDoc.mockResolvedValue({ ok: true });
    render(<KnowledgeBase docs={[doc({ status: "failed", error: "Those pages couldn't be read." })]} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(retryKbDoc).toHaveBeenCalledWith("d-1"));
    await waitFor(() => expect(start).toHaveBeenCalledWith(["d-1"]));
  });
});

describe("finding a document", () => {
  const library = [
    doc({ id: "d-1", title: "City Multi fault codes", category: "faults" }),
    doc({ id: "d-2", title: "PUZ-ZM250 installation manual", category: "install", source: "Mitsubishi Electric" }),
    doc({ id: "d-3", title: "Warranty claim process", category: "sops", source: "HeyTiff" }),
  ];

  it("filters on the title and the source", async () => {
    render(<KnowledgeBase docs={library} />);

    await userEvent.type(screen.getByLabelText("Search documents"), "PUZ");
    expect(screen.getByText("PUZ-ZM250 installation manual")).toBeInTheDocument();
    expect(screen.queryByText("Warranty claim process")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, and offers the way back", async () => {
    render(<KnowledgeBase docs={library} />);

    await userEvent.type(screen.getByLabelText("Search documents"), "zzzz");

    expect(screen.getByText("No documents match “zzzz”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Clear the search/ }));
    expect(screen.getByText("City Multi fault codes")).toBeInTheDocument();
  });

  it("opens on the category the URL asked for", () => {
    render(<KnowledgeBase docs={library} initialCategory="install" />);

    expect(screen.getByText("PUZ-ZM250 installation manual")).toBeInTheDocument();
    expect(screen.queryByText("City Multi fault codes")).not.toBeInTheDocument();
  });

  it("an empty shelf beside full ones says what belongs on it", async () => {
    render(<KnowledgeBase docs={library} />);

    await userEvent.click(screen.getByRole("button", { name: /Manufacturer specs/ }));

    expect(screen.getByText("Nothing on this shelf yet.")).toBeInTheDocument();
    expect(screen.getByText(/Ask a manager to add/)).toBeInTheDocument();
  });

  it("counts every category on its chip, zeros included", () => {
    render(<KnowledgeBase docs={library} />);

    const chips = screen.getByRole("button", { name: /Manufacturer specs/ });
    expect(chips.textContent).toContain("0");
    expect(screen.getByRole("button", { name: /Fault code library/ }).textContent).toContain("1");
  });
});
