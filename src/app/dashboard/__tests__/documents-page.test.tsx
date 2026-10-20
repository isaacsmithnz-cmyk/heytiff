import { isValidElement, type ReactElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DocumentsList } from "@/components/documents/documents-list";
import { makeOnJobHref } from "@/components/documents/make-document";
import type { DocumentsData } from "@/lib/documents/made-query";
import { DEFAULT_DOCS_STATE, certRow, handoverRow, letterRow, swmsRow, type DocsState } from "@/lib/documents/made";
import type { OrgSwmsSummary } from "@/lib/swms/query";

/* /dashboard/documents: the gate, the address, and the screen — its kinds
   and their counts, All's groups with Show all, the rows opening where
   today's screens open them, the search, the empty view, no Templates
   rail, and Make a document. */

let allowed = true;
const can = jest.fn(async (_c: string) => allowed);
const loadDocuments = jest.fn();
const push = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));
jest.mock("@/lib/documents/made-query", () => ({ loadDocuments: () => loadDocuments() }));
jest.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));

const TODAY = "2026-10-13";
const day = (iso: string) => iso.slice(0, 10);

const swms = (n: number, over: Partial<OrgSwmsSummary> = {}): OrgSwmsSummary => ({
  swmsId: `s-${n}`,
  versionId: `v-${n}`,
  version: 1,
  issuedAt: `2026-10-${String(13 - n).padStart(2, "0")}T01:00:00.000Z`,
  responsible: "Lyle Irving",
  signed: 3,
  total: 3,
  waitingOn: [],
  issues: [],
  viewerCanSign: false,
  viewerSigned: false,
  jobUuid: `j-${n}`,
  kind: "install",
  ...over,
});

function dataFor(over: Partial<DocumentsData> = {}): DocumentsData {
  return {
    rows: [
      swmsRow(swms(0, { signed: 2, waitingOn: ["Sam Ikpeba"] }), { label: "3342 Rifkin, Bellevue Hill", hue: "blue" }, day),
      swmsRow(swms(1), { label: "3302 Heuvel, Chatswood", hue: "purple" }, day),
      swmsRow(swms(2), null, day),
      swmsRow(swms(3, { kind: "service" }), null, day),
      certRow(
        { certificateId: "c-1", versionId: "cv-1", version: 1, title: "Mechanical Compliance Certificate", issuedAt: "2026-10-02T01:00:00.000Z", issuedBy: "Isaac Smith", issuedById: "isaac", documentId: null, jobUuid: "j-9" },
        { label: "3318 Hartley, Lane Cove", hue: "blue" },
        day,
      ),
      letterRow({ id: "l-1", title: "Employment confirmation", preview: "", date: "", signer: "Isaac Smith", writer: "Isaac Smith", updatedAt: "2026-10-09T01:00:00.000Z" }, day),
      handoverRow({ id: "p-1", name: "Hale Street apartments", updatedAt: "2026-09-28T01:00:00.000Z" }, { done: 3, total: 4 }, { label: "3240 Hale, Ultimo", hue: null }, day),
    ],
    kinds: ["swms", "certificate", "letter", "handover"],
    today: TODAY,
    canWriteLetters: true,
    ...over,
  };
}

const show = (data: DocumentsData, initial: Partial<DocsState> = {}) => render(<DocumentsList data={data} initial={{ ...DEFAULT_DOCS_STATE, ...initial }} />);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");

beforeEach(() => {
  allowed = true;
  can.mockClear();
  push.mockClear();
  loadDocuments.mockReset();
  window.history.replaceState(null, "", "/dashboard/documents");
});

describe("the route", () => {
  it("sends a reader without the Workboard back to Home, and reads nothing", async () => {
    allowed = false;
    const { default: DocumentsPage } = await import("@/app/dashboard/documents/page");
    await expect(DocumentsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("workboard");
    expect(loadDocuments).not.toHaveBeenCalled();
  });

  it("reads the view from the address, and a kind the reader hasn't is All", async () => {
    const { default: DocumentsPage } = await import("@/app/dashboard/documents/page");
    const page = (await DocumentsPage({ searchParams: Promise.resolve({ view: "letter" }) })) as ReactElement<{ children: ReactElement<{ searchParams: Promise<Record<string, string>> }> }>;
    const body = page.props.children;
    expect(isValidElement(body)).toBe(true);
    const run = body.type as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement<{ initial: DocsState }>>;
    loadDocuments.mockResolvedValue(dataFor());
    expect((await run({ searchParams: Promise.resolve({ view: "letter" }) })).props.initial.view).toBe("letter");
    loadDocuments.mockResolvedValue(dataFor({ kinds: ["swms", "certificate", "handover"] }));
    expect((await run({ searchParams: Promise.resolve({ view: "letter" }) })).props.initial.view).toBe("all");
  });
});

describe("the screen", () => {
  it("is the title alone, with a view for each kind, no numbers on either (Isaac, 20 October)", () => {
    show(dataFor());
    expect(screen.getByRole("heading", { level: 1, name: "Documents" })).toBeTruthy();
    expect(screen.queryByText(/ made/)).toBeNull();
    expect(tab(/^All/).textContent).toBe("All");
    expect(tab(/^SWMS/).textContent).toBe("SWMS");
    expect(tab(/^Letters/).textContent).toBe("Letters");
    expect(tab(/^Handover sheets/).textContent).toBe("Handover sheets");
  });

  it("groups All by kind, the newest three of each, and Show all goes to the kind", () => {
    show(dataFor());
    const swmsGroup = screen.getByRole("region", { name: /^SWMS/ });
    expect(within(swmsGroup).getAllByRole("link")).toHaveLength(3);
    fireEvent.click(within(swmsGroup).getByRole("button", { name: "Show all 4" }));
    expect(tab(/^SWMS/).getAttribute("aria-selected")).toBe("true");
    expect(within(panel()).getAllByRole("link")).toHaveLength(4);
    expect(window.location.search).toBe("?view=swms");
    // a group with three or fewer has no Show all
    fireEvent.click(tab(/^All/));
    expect(within(screen.getByRole("region", { name: /^Certificates/ })).queryByRole("button")).toBeNull();
  });

  it("opens each row where today's screens open it", () => {
    show(dataFor());
    const link = (name: RegExp) => within(panel()).getByRole("link", { name });
    expect(link(/2 of 3 signed on, waiting on Sam Ikpeba/).getAttribute("href")).toBe("/dashboard/swms/v-0");
    const cert = link(/Mechanical Compliance Certificate/);
    expect(cert.getAttribute("href")).toBe("/certificates/cv-1");
    expect(cert.getAttribute("target")).toBe("_blank");
    expect(link(/Employment confirmation/).getAttribute("href")).toBe("/dashboard/admin/letters/l-1");
    const sheet = link(/Handover, Hale Street apartments/);
    expect(sheet.getAttribute("href")).toBe("/handover/p-1");
    expect(sheet.getAttribute("target")).toBe("_blank");
    expect(within(sheet).getByText("3 of 4 checks done")).toBeTruthy();
    expect(within(link(/Employment confirmation/)).getByText("No job")).toBeTruthy();
  });

  it("searches across kinds, says when nothing matches, and clears", () => {
    show(dataFor());
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents" }), { target: { value: "lane cove" } });
    expect(within(panel()).getAllByRole("link")).toHaveLength(1);
    expect(tab(/^All/).textContent).toBe("All");
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents" }), { target: { value: "nothing like it" } });
    expect(screen.getByText('No documents here match "nothing like it"')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(within(panel()).getAllByRole("link").length).toBeGreaterThan(1);
  });

  it("leads an empty kind with how one is made", () => {
    show(dataFor({ rows: [] }), { view: "swms" });
    expect(screen.getByText("No SWMS yet")).toBeTruthy();
  });

  it("has no Templates rail: templates live in Settings (Isaac, 20 October)", () => {
    show(dataFor());
    expect(screen.queryByRole("complementary", { name: /Templates/ })).toBeNull();
  });

  it("leaves Letters out for a reader below admin", () => {
    show(dataFor({ rows: dataFor().rows.filter((r) => r.kind !== "letter"), kinds: ["swms", "certificate", "handover"], canWriteLetters: false }));
    expect(screen.queryByRole("tab", { name: /^Letters/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Make a document/ }));
    expect(screen.queryByRole("menuitem", { name: "Letter" })).toBeNull();
  });
});

describe("Make a document", () => {
  it("offers SWMS, Certificate, Letter and Handover sheet", () => {
    show(dataFor());
    fireEvent.click(screen.getByRole("button", { name: /Make a document/ }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["SWMS", "Certificate", "Letter", "Handover sheet"]);
  });

  it("asks for the job before a SWMS, and opens that job's Documents doing what Add does", () => {
    show(dataFor());
    fireEvent.click(screen.getByRole("button", { name: /Make a document/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "SWMS" }));
    const dialog = screen.getByRole("dialog", { name: "Make a SWMS" });
    expect(within(dialog).getByRole("button", { name: "Make the SWMS" }).hasAttribute("disabled")).toBe(true);
    expect(makeOnJobHref("j-3209", "swms")).toBe("/dashboard/jobs/j-3209?tab=documents&add=swms");
    expect(makeOnJobHref("j-3209", "certificate")).toBe("/dashboard/jobs/j-3209?tab=documents&add=certificate");
  });

  it("opens today's letter editor, and the projects for a handover sheet", () => {
    show(dataFor());
    fireEvent.click(screen.getByRole("button", { name: /Make a document/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Letter" }));
    expect(push).toHaveBeenCalledWith("/dashboard/admin/letters/new");
    fireEvent.click(screen.getByRole("button", { name: /Make a document/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Handover sheet" }));
    expect(push).toHaveBeenCalledWith("/dashboard/workboard/projects");
  });
});
