import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Library, type KbLibraryDoc, type KbQuotaView } from "../library";
import type { KbTagRef } from "@/lib/tiff/tags";

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

/* The tag picker and the manage sheet import the tag actions, and a
   "use server" module drags next/cache into jsdom — where `Request` doesn't
   exist and the suite dies before a single test runs. */
const createKbTag = jest.fn();
const updateKbTag = jest.fn();
const deleteKbTag = jest.fn();
jest.mock("@/app/actions/kb-tags", () => ({
  createKbTag: (...a: unknown[]) => createKbTag(...(a as [])),
  updateKbTag: (...a: unknown[]) => updateKbTag(...(a as [])),
  deleteKbTag: (...a: unknown[]) => deleteKbTag(...(a as [])),
}));

const start = jest.fn();
jest.mock("@/lib/tiff/use-kb-ingest", () => ({
  useKbIngest: () => ({ progress: {}, busy: false, start }),
}));

const tag = (id: string, label: string, kind: KbTagRef["kind"] = "brand"): KbTagRef => ({
  id,
  label,
  slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  color: "#2563eb",
  kind,
});

const TAGS: KbTagRef[] = [
  tag("t-daikin", "Daikin"),
  tag("t-mitsi", "Mitsubishi Electric"),
  tag("t-vrv", "VRV", "system"),
  tag("t-ducted", "Ducted", "system"),
];

const doc = (over: Partial<KbLibraryDoc> = {}): KbLibraryDoc => ({
  id: "d-1",
  category: "faults",
  title: "City Multi fault codes",
  source: "Mitsubishi Electric",
  edition: "2026 revision B",
  fileName: "city-multi-fault-codes.pdf",
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
    render(<Library docs={[]} quota={quota()} canManage />);

    expect(screen.getByText(/Tiff can only answer from what/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add documents/ })).toBeInTheDocument();
    // nothing to search or filter yet — the controls would be furniture
    expect(screen.queryByLabelText("Search documents")).not.toBeInTheDocument();
  });

  /* Uploading starts here and nowhere else — the assistant deliberately has no
     way to open this drawer from a link, so it opens on a press or not at
     all. */
  it("opens the upload drawer on the press, not on arrival", async () => {
    render(<Library docs={[]} quota={quota()} canManage />);

    expect(screen.queryByRole("dialog", { name: "Add documents" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Add documents/ }));
    expect(screen.getByRole("dialog", { name: "Add documents" })).toBeInTheDocument();
  });

  it("tells staff who to ask, and offers them nothing to press", () => {
    render(<Library docs={[]} quota={quota()} />);

    expect(screen.getByText(/Tiff can only answer from what/)).toBeInTheDocument();
    expect(screen.getByText(/Ask a manager to add/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add documents/ })).not.toBeInTheDocument();
  });

  it("names all four categories so the reason is concrete", () => {
    render(<Library docs={[]} quota={quota()} canManage />);
    for (const label of [
      "Installation documents",
      "Service documents",
      "Manufacturer specs",
      "Company SOPs",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("what a row says about itself", () => {
  it("a document being read shows how far through it is", () => {
    render(<Library docs={[doc({ status: "processing", nextPage: 41, pageCount: 220 })]} canManage />);
    expect(screen.getByText("Reading… 40 of 220 pages")).toBeInTheDocument();
  });

  it("a document not yet opened reads honestly rather than as 0 of 0", () => {
    render(<Library docs={[doc({ status: "processing", nextPage: 1, pageCount: null })]} canManage />);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("a document out of pages says when it comes back, and offers Resume", () => {
    render(<Library docs={[doc({ status: "paused", nextPage: 81 })]} quota={quota()} canManage />);

    expect(screen.getByText("Out of pages — resumes 1 Sept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("a failed document carries its reason and a Retry", () => {
    render(<Library docs={[doc({ status: "failed", error: "That PDF couldn't be opened." })]} canManage />);

    expect(screen.getByText("That PDF couldn't be opened.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a ready document with scanned pages admits what it couldn't read", () => {
    render(<Library docs={[doc({ scannedPages: 12 })]} canManage />);
    expect(screen.getByText("12 pages unreadable — scanned images")).toBeInTheDocument();
  });

  /* A pill means "this one needs you". Ready is what almost every row is, so
     labelling it spends the reader's attention on the rows that don't need
     any — and leaves the stuck one competing with a page of green. */
  it("a clean ready document wears no pill at all", () => {
    const { container } = render(<Library docs={[doc()]} canManage />);
    expect(container.querySelector(".tk-pill")).toBeNull();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    // and the row is still plainly usable
    expect(screen.getByRole("button", { name: /Ask Tiff about/ })).toBeInTheDocument();
  });

  it("says nothing about a document's kind — they are all PDFs", () => {
    const { container } = render(<Library docs={[doc()]} canManage />);
    expect(container.querySelector(".tk-kind")).toBeNull();
  });

  it("shows source, edition, when it changed and who added it", () => {
    render(<Library docs={[doc()]} />);
    expect(
      screen.getByText("Mitsubishi Electric · 2026 revision B · Updated 1 Aug · Added by Dane Poulos")
    ).toBeInTheDocument();
  });

  it("staff never see Retry or Resume — the loop is not theirs to drive", () => {
    render(<Library docs={[doc({ status: "failed", error: "That file couldn't be read." })]} />);

    expect(screen.getByText("That file couldn't be read.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("opening the document", () => {
  it("signs a URL on the click and hands it to a new tab", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    kbDocUrl.mockResolvedValue({ ok: true, url: "https://signed.example/manual.pdf" });

    render(<Library docs={[doc()]} />);
    await userEvent.click(screen.getByRole("button", { name: "City Multi fault codes" }));

    await waitFor(() => expect(tab.location.href).toBe("https://signed.example/manual.pdf"));
    expect(kbDocUrl).toHaveBeenCalledWith("d-1");
    open.mockRestore();
  });

  it("puts a refusal on the row rather than leaving a blank tab open", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    kbDocUrl.mockResolvedValue({ ok: false, error: "That document is no longer here." });

    render(<Library docs={[doc()]} />);
    await userEvent.click(screen.getByRole("button", { name: "City Multi fault codes" }));

    expect(await screen.findByText("That document is no longer here.")).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it("a document still being read is not a link to press", () => {
    render(<Library docs={[doc({ status: "processing", nextPage: 21 })]} />);
    expect(screen.queryByRole("button", { name: /City Multi fault codes/ })).not.toBeInTheDocument();
  });
});

/* ── the passages stored without a vector ────────────────────────────────── */

describe("the embedding gap", () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const batch = (body: unknown) => ({ ok: true, json: async () => body });

  it("says how many passages aren't searchable by meaning yet", () => {
    render(<Library docs={[doc()]} quota={quota()} canManage unembedded={106} />);
    expect(screen.getByText(/106 passages aren't searchable by meaning yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill these in" })).toBeInTheDocument();
  });

  it("reads as one passage when there is one", () => {
    render(<Library docs={[doc()]} quota={quota()} canManage unembedded={1} />);
    expect(screen.getByText(/1 passage isn't searchable by meaning yet/)).toBeInTheDocument();
  });

  /* Nothing to say when there is nothing missing — and a deployment with no
     VOYAGE_API_KEY sends 0, because there every chunk is null by design and
     the line would read as a broken library rather than a keyword-only one. */
  it("is absent when nothing is missing", () => {
    render(<Library docs={[doc()]} quota={quota()} canManage unembedded={0} />);
    expect(screen.queryByText(/searchable by meaning/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fill these in" })).not.toBeInTheDocument();
  });

  /* Staff can't upload, can't retry, and can't spend the org's Voyage
     requests — so they are not told about a backlog they cannot clear. */
  it("is a manager's line, like the quota above it", () => {
    render(<Library docs={[doc()]} quota={quota()} unembedded={106} />);
    expect(screen.queryByText(/searchable by meaning/)).not.toBeInTheDocument();
  });

  it("calls the route batch after batch until nothing is left", async () => {
    fetchMock
      .mockResolvedValueOnce(batch({ done: 64, remaining: 42 }))
      .mockResolvedValueOnce(batch({ done: 42, remaining: 0 }));

    render(<Library docs={[doc()]} quota={quota()} canManage unembedded={106} />);
    await userEvent.click(screen.getByRole("button", { name: "Fill these in" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tiff/embed-backfill");
    // the server's count on the page is now wrong
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("counts up while it runs", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock
      .mockResolvedValueOnce(batch({ done: 64, remaining: 42 }))
      .mockReturnValueOnce(new Promise((r) => (release = r)));

    render(<Library docs={[doc()]} quota={quota()} canManage unembedded={106} />);
    await userEvent.click(screen.getByRole("button", { name: "Fill these in" }));

    expect(await screen.findByText("Filling in… 64 of 106")).toBeInTheDocument();

    release(batch({ done: 42, remaining: 0 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /* The truth, in the words a person can act on: this account is capped until
     somebody adds a payment method. "Try again later" on its own would buy a
     second afternoon of diagnosis. */
  it("names the rate limit when Voyage stops the run", async () => {
    fetchMock.mockResolvedValue(batch({ done: 0, remaining: 106, stopped: "rate-limited" }));

    render(<Library docs={[doc()]} quota={quota()} canManage unembedded={106} />);
    await userEvent.click(screen.getByRole("button", { name: "Fill these in" }));

    expect(await screen.findByText(/capped at 3 requests a minute/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    // it stopped rather than asking sixty more times inside the same minute
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the month's page allowance", () => {
  it("shows the count and the reset date to a manager", () => {
    render(<Library docs={[doc()]} quota={quota()} canManage />);
    expect(screen.getByText("1,240 of 2,000 pages this month · resets 1 Sept")).toBeInTheDocument();
  });

  it("says Unlimited pages rather than a number on the unlimited tier", () => {
    render(<Library docs={[doc()]} quota={quota({ plan: "unlimited", pagesAllowed: null })} canManage />);
    expect(screen.getByText("Unlimited pages")).toBeInTheDocument();
  });

  it("is a manager's line — staff are not billed and are not told", () => {
    render(<Library docs={[doc()]} quota={quota()} />);
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
    render(<Library docs={[doc()]} />);
    expect(
      screen.getByRole("button", { name: "Ask Tiff about City Multi fault codes" })
    ).toBeInTheDocument();
  });

  it("leaves the document as the opening of a sentence and goes to Tiff", async () => {
    render(<Library docs={[doc()]} canManage />);

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
      <Library
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
    render(<Library docs={[doc()]} canManage />);

    expect(screen.getByRole("button", { name: "Edit City Multi fault codes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove City Multi fault codes" })).not.toBeInTheDocument();
  });

  it("only the owner gets remove, and the confirm names the document", async () => {
    render(<Library docs={[doc()]} canManage isOwner />);

    await userEvent.click(screen.getByRole("button", { name: "Remove City Multi fault codes" }));

    const dialog = screen.getByRole("dialog", { name: "Remove document" });
    expect(within(dialog).getByText(/Remove “City Multi fault codes”\?/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Remove “City Multi fault codes”/ })).toBeInTheDocument();
  });

  it("confirming the removal is what calls the action, not opening the dialog", async () => {
    deleteKbDoc.mockResolvedValue({ ok: true });
    render(<Library docs={[doc()]} canManage isOwner />);

    await userEvent.click(screen.getByRole("button", { name: "Remove City Multi fault codes" }));
    expect(deleteKbDoc).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Remove document" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove “City Multi fault codes”/ }));

    await waitFor(() => expect(deleteKbDoc).toHaveBeenCalledWith("d-1"));
  });

  it("staff get no row actions at all — absent, not disabled", () => {
    const { container } = render(<Library docs={[doc()]} />);
    expect(container.querySelector(".tk-acts")).toBeNull();
  });

  it("edits go through updateKbDocMeta and refresh the page", async () => {
    updateKbDocMeta.mockResolvedValue({ ok: true });
    render(<Library docs={[doc()]} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Edit City Multi fault codes" }));
    await userEvent.click(screen.getByRole("button", { name: /Save details/ }));

    await waitFor(() =>
      expect(updateKbDocMeta).toHaveBeenCalledWith("d-1", {
        title: "City Multi fault codes",
        category: "faults",
        source: "Mitsubishi Electric",
        edition: "2026 revision B",
        // always sent, so unticking a tag takes it off — an action that only
        // ever added would make a wrong tag permanent
        tagIds: [],
      })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a Retry restarts the server row and rejoins the reading queue", async () => {
    retryKbDoc.mockResolvedValue({ ok: true });
    render(<Library docs={[doc({ status: "failed", error: "Those pages couldn't be read." })]} canManage />);

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
    render(<Library docs={library} />);

    await userEvent.type(screen.getByLabelText("Search documents"), "PUZ");
    expect(screen.getByText("PUZ-ZM250 installation manual")).toBeInTheDocument();
    expect(screen.queryByText("Warranty claim process")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, and offers the way back", async () => {
    render(<Library docs={library} />);

    await userEvent.type(screen.getByLabelText("Search documents"), "zzzz");

    expect(screen.getByText("No documents match “zzzz”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Clear the search/ }));
    expect(screen.getByText("City Multi fault codes")).toBeInTheDocument();
  });

  it("opens on the tags the URL asked for", () => {
    render(
      <Library
        docs={[
          doc({ id: "d-1", title: "City Multi fault codes", tags: [TAGS[1]] }),
          doc({ id: "d-2", title: "VRV service manual", tags: [TAGS[0], TAGS[2]] }),
        ]}
        tags={TAGS}
        initialTagIds={["t-daikin"]}
      />
    );

    expect(screen.getByText("VRV service manual")).toBeInTheDocument();
    expect(screen.queryByText("City Multi fault codes")).not.toBeInTheDocument();
  });

  it("opens on the category the URL asked for", () => {
    render(<Library docs={library} initialCategory="install" />);

    expect(screen.getByText("PUZ-ZM250 installation manual")).toBeInTheDocument();
    expect(screen.queryByText("City Multi fault codes")).not.toBeInTheDocument();
  });

  it("an empty category beside full ones says what belongs in it", async () => {
    render(<Library docs={library} />);

    await userEvent.click(screen.getByRole("button", { name: /Manufacturer specs/ }));

    expect(screen.getByText("Nothing in this category yet.")).toBeInTheDocument();
    expect(screen.getByText(/Ask a manager to add/)).toBeInTheDocument();
  });

  it("counts every category on its chip, zeros included", () => {
    render(<Library docs={library} />);

    const chips = screen.getByRole("button", { name: /Manufacturer specs/ });
    expect(chips.textContent).toContain("0");
    expect(screen.getByRole("button", { name: /Service documents/ }).textContent).toContain("1");
  });

  /* The count map was a hand-written literal of four keys while the category
     list had five, so a field note tallied `undefined + 1` and its chip read
     "NaN" — a number nobody could explain, on the newest category. */
  it("filters on a tag nobody wrote in the title", async () => {
    render(
      <Library
        docs={[
          doc({ id: "d-1", title: "City Multi fault codes", tags: [TAGS[1]] }),
          doc({ id: "d-2", title: "Service manual", category: "faults", source: null, tags: [TAGS[0]] }),
        ]}
        tags={TAGS}
      />
    );

    await userEvent.type(screen.getByLabelText("Search documents"), "daikin");

    expect(screen.getByText("Service manual")).toBeInTheDocument();
    expect(screen.queryByText("City Multi fault codes")).not.toBeInTheDocument();
  });

  it("counts the field-note category rather than showing NaN", () => {
    render(
      <Library
        docs={[
          doc({ id: "f-1", title: "Roof access at Westfield", category: "field" }),
          doc({ id: "f-2", title: "Pump start-up quirk", category: "field" }),
        ]}
      />
    );

    const chip = screen.getByRole("button", { name: /Field notes/ });
    expect(chip.textContent).toContain("2");
    expect(chip.textContent).not.toContain("NaN");
  });
});

/* ── tags: the second axis ───────────────────────────────────────────────── */

describe("narrowing by tag", () => {
  const library = [
    doc({ id: "d-1", title: "VRV service manual", category: "faults", tags: [TAGS[0], TAGS[2]] }),
    doc({ id: "d-2", title: "Ducted install guide", category: "install", tags: [TAGS[0], TAGS[3]] }),
    doc({ id: "d-3", title: "City Multi fault codes", category: "faults", tags: [TAGS[1], TAGS[2]] }),
  ];

  /* Scoped to the rail on purpose: the same tag name is also a pill on every
     row that wears it, and an unscoped getByRole would find several buttons
     called "VRV" — which is the point of the pills, not a bug in them. */
  const railChip = (name: RegExp) =>
    within(document.querySelector(".tk-trail") as HTMLElement).getByRole("button", { name });

  it("puts every tag anything wears on the rail, with its count", () => {
    render(<Library docs={library} tags={TAGS} />);

    expect(railChip(/^Daikin/).textContent).toContain("2");
    expect(railChip(/^VRV/).textContent).toContain("2");
  });

  /* An org starts with fifty seeded tags and a library with three documents.
     Showing all fifty as filters would bury the four that would do anything —
     an unused tag belongs in the PICKER, not the rail. */
  it("keeps a tag nothing wears off the rail", () => {
    const unused = tag("t-hitachi", "Hitachi");
    render(<Library docs={library} tags={[...TAGS, unused]} />);

    expect(within(document.querySelector(".tk-trail") as HTMLElement).queryByRole("button", { name: /^Hitachi/ })).not.toBeInTheDocument();
  });

  it("shows only what wears the tag", async () => {
    render(<Library docs={library} tags={TAGS} />);

    await userEvent.click(railChip(/^VRV/));

    expect(screen.getByText("VRV service manual")).toBeInTheDocument();
    expect(screen.getByText("City Multi fault codes")).toBeInTheDocument();
    expect(screen.queryByText("Ducted install guide")).not.toBeInTheDocument();
  });

  /* AND, not OR: a second chip is "…and VRV", and it has to compose with the
     category chip above it, which also narrows. An OR would grow the list
     every time another filter went on. */
  it("narrows further with a second tag rather than widening", async () => {
    render(<Library docs={library} tags={TAGS} />);

    await userEvent.click(railChip(/^Daikin/));
    await userEvent.click(railChip(/^VRV/));

    expect(screen.getByText("VRV service manual")).toBeInTheDocument();
    expect(screen.queryByText("Ducted install guide")).not.toBeInTheDocument();
    expect(screen.queryByText("City Multi fault codes")).not.toBeInTheDocument();
  });

  it("composes with the category filter", async () => {
    render(<Library docs={library} tags={TAGS} />);

    await userEvent.click(railChip(/^Daikin/));
    await userEvent.click(screen.getByRole("button", { name: /Installation documents/ }));

    expect(screen.getByText("Ducted install guide")).toBeInTheDocument();
    expect(screen.queryByText("VRV service manual")).not.toBeInTheDocument();
  });

  it("says which combination found nothing, and offers the way back", async () => {
    render(<Library docs={library} tags={TAGS} />);

    await userEvent.click(railChip(/^VRV/));
    await userEvent.click(railChip(/^Ducted/));

    expect(screen.getByText("No documents wear all of those tags")).toBeInTheDocument();
    expect(screen.getByText(/a document has to wear every one/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear the tags" }));
    expect(screen.getByText("VRV service manual")).toBeInTheDocument();
  });

  /* A tag that removed itself from the rail the moment it emptied the list
     could never be pressed again to undo — the filter would be stuck on with
     no control for it. */
  it("keeps a selected tag pressable even when it leaves nothing on screen", async () => {
    render(<Library docs={library} tags={TAGS} />);

    await userEvent.click(railChip(/^VRV/));
    await userEvent.click(railChip(/^Ducted/));
    await userEvent.click(railChip(/^Ducted/));

    expect(screen.getByText("VRV service manual")).toBeInTheDocument();
  });

  it("wears its tags on the row, and a pill is a filter", async () => {
    render(<Library docs={library} tags={TAGS} />);

    const row = screen.getByText("Ducted install guide").closest(".tk-row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Daikin" }));

    expect(screen.getByText("VRV service manual")).toBeInTheDocument();
    expect(screen.queryByText("City Multi fault codes")).not.toBeInTheDocument();
  });

  it("collapses a fourth tag into +N rather than turning the row into a cloud", () => {
    render(
      <Library
        docs={[doc({ id: "d-9", title: "Everything manual", tags: [...TAGS] })]}
        tags={TAGS}
      />
    );

    const row = screen.getByText("Everything manual").closest(".tk-row") as HTMLElement;
    expect(within(row).getByText("+1")).toBeInTheDocument();
  });
});

describe("tagging a document after the fact", () => {
  it("sends the tags the picker is showing, not the ones it arrived with", async () => {
    updateKbDocMeta.mockResolvedValue({ ok: true });
    render(<Library docs={[doc({ tags: [TAGS[0]] })]} tags={TAGS} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Edit City Multi fault codes" }));

    const dialog = screen.getByRole("dialog", { name: "Edit document" });
    // one off, one on
    await userEvent.click(within(dialog).getByRole("button", { name: /Daikin/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /VRV/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Save details/ }));

    await waitFor(() =>
      expect(updateKbDocMeta).toHaveBeenCalledWith("d-1", expect.objectContaining({ tagIds: ["t-vrv"] }))
    );
  });

  /* The slug is the identity and the server dedupes on it, so offering
     "Create Daikin" beside the Daikin chip would be an offer that quietly does
     nothing. */
  it("offers to create only a name no tag already answers to", async () => {
    render(<Library docs={[doc()]} tags={TAGS} canManage />);
    await userEvent.click(screen.getByRole("button", { name: "Edit City Multi fault codes" }));

    const dialog = screen.getByRole("dialog", { name: "Edit document" });
    const box = within(dialog).getByLabelText("Find or create a tag");

    await userEvent.type(box, "daikin");
    expect(within(dialog).queryByText(/^Create/)).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "chiller");
    expect(within(dialog).getByText(/^Create/)).toBeInTheDocument();
  });

  it("ticks a tag it just made onto the document", async () => {
    createKbTag.mockResolvedValue({
      ok: true,
      tag: tag("t-new", "Hydronic", "system"),
    });
    updateKbDocMeta.mockResolvedValue({ ok: true });

    render(<Library docs={[doc({ tags: [] })]} tags={TAGS} canManage />);
    await userEvent.click(screen.getByRole("button", { name: "Edit City Multi fault codes" }));

    const dialog = screen.getByRole("dialog", { name: "Edit document" });
    await userEvent.type(within(dialog).getByLabelText("Find or create a tag"), "hydronic");
    await userEvent.click(within(dialog).getByRole("button", { name: /System types/ }));

    await waitFor(() => expect(createKbTag).toHaveBeenCalledWith({ label: "Hydronic", kind: "system" }));

    await userEvent.click(within(dialog).getByRole("button", { name: /Save details/ }));
    await waitFor(() =>
      expect(updateKbDocMeta).toHaveBeenCalledWith("d-1", expect.objectContaining({ tagIds: ["t-new"] }))
    );
  });
});

describe("managing the tags themselves", () => {
  it("is a manager's sheet — staff never see the way in", () => {
    render(<Library docs={[doc()]} tags={TAGS} />);
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
  });

  it("names how many documents a tag is on before it will remove it", async () => {
    render(<Library docs={[doc()]} tags={TAGS} tagUsage={{ "t-daikin": 14 }} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    const sheet = screen.getByRole("dialog", { name: "Manage tags" });
    expect(within(sheet).getByText("14 documents")).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole("button", { name: "Remove Daikin" }));

    expect(within(sheet).getByText("Remove “Daikin”?")).toBeInTheDocument();
    // the manuals are not what's being deleted, and the confirm says so
    expect(within(sheet).getByText(/the documents stay/)).toBeInTheDocument();
    expect(deleteKbTag).not.toHaveBeenCalled();
  });

  it("confirming is what removes it", async () => {
    deleteKbTag.mockResolvedValue({ ok: true });
    render(<Library docs={[doc()]} tags={TAGS} tagUsage={{ "t-daikin": 2 }} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    const sheet = screen.getByRole("dialog", { name: "Manage tags" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove Daikin" }));
    await userEvent.click(within(sheet).getByRole("button", { name: /Remove “Daikin”$/ }));

    await waitFor(() => expect(deleteKbTag).toHaveBeenCalledWith("t-daikin"));
  });

  it("renames and recolours through one save", async () => {
    updateKbTag.mockResolvedValue({ ok: true, tag: tag("t-vrv", "VRV Systems", "system") });
    render(<Library docs={[doc()]} tags={TAGS} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    const sheet = screen.getByRole("dialog", { name: "Manage tags" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Edit VRV" }));

    const box = within(sheet).getByLabelText("Rename VRV");
    await userEvent.clear(box);
    await userEvent.type(box, "VRV systems");
    await userEvent.click(within(sheet).getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(updateKbTag).toHaveBeenCalledWith("t-vrv", expect.objectContaining({ label: "VRV systems" }))
    );
  });
});
