/* A job's Documents (v2, the mock of 25 October 2026, frame 6): one heading
   and one blue Add, the paper in groups (Drawings, From the client, Files,
   Compliance) with no Money group, and every row a v2 row: a tick where it
   can be sent, the name, a grey line, and one thing on the right. What a row
   used to offer beside its name lives in the viewer's head now
   (job-media-viewer.test.tsx). */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SwmsSummary } from "@/lib/swms/query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { JobPaper, PaperChoices } from "@/lib/compliance/papers";
import { JobDocumentsFace } from "../job-documents-face";

const summary = (over: Partial<SwmsSummary> = {}): SwmsSummary => ({
  swmsId: "s-1",
  versionId: "v-2",
  version: 2,
  issuedAt: "2026-09-16T07:42:00",
  responsible: "Troy Porter",
  signed: 1,
  total: 3,
  waitingOn: ["Dane Whitmore", "Kai Lindqvist"],
  issues: [],
  viewerCanSign: true,
  viewerSigned: false,
  ...over,
});

type Props = Parameters<typeof JobDocumentsFace>[0];
const BASE: Props = { documents: [], elsewhere: [], designs: [], loading: false, onOpen: () => {} };
const face = (props: Partial<Props> = {}) => render(<JobDocumentsFace {...BASE} {...props} />);

/** A row, by its name: the parts' row it sits in. */
const rowOf = (name: string | RegExp) => screen.getByText(name).closest(".pt-row") as HTMLElement;
/** A group, by its heading. */
const group = (name: string) => screen.getByRole("region", { name });

/** Add's white menu, open. */
const addMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  return screen.findByRole("menu", { name: "Add to the job's documents" });
};

/* ── the head ──────────────────────────────────────────────────────────── */

it("is headed Documents with no count under it, and one blue Add", () => {
  face({ swms: [summary()], onUpload: async () => null });
  expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
  expect(screen.queryByText(/\d+ files?$/)).toBeNull();
  const add = screen.getByRole("button", { name: "Add" });
  expect(add).toHaveClass("pt-btn--main");
  expect(add).toHaveAttribute("aria-haspopup", "menu");
  /* the rows' own buttons are never blue: Add is the area's one */
  expect(document.querySelectorAll(".pt-btn--main")).toHaveLength(1);
});

it("offers Upload a file, Licences and insurance, SWMS and Certificate in the white menu, each where it was offered", async () => {
  face({
    onUpload: async () => null,
    onLoadChoices: async () => ({ company: [], staff: null }),
    onAddPapers: async () => null,
    mayAdd: { company: true, staff: false },
    swms: [],
    onCreateSwms: () => {},
    canCreateSwms: true,
    certificates: [],
    onCreateCertificate: () => {},
  });
  const menu = await addMenu();
  expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
    "Upload a file",
    "Licences and insurance",
    "SWMS",
    "Certificate",
  ]);
});

it("draws no Add when there is nothing to add with", () => {
  face({ swms: [summary()], onCreateSwms: () => {} });
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
});

/* a read that failed offered Create SWMS on a job that may already have one,
   and a second press was a second SWMS */
it("offers SWMS only while the job has none, once the read lands — a second press was a second SWMS", async () => {
  const onCreateSwms = jest.fn();
  const props = { onCreateSwms, canCreateSwms: true, onUpload: async () => null };
  const { rerender } = face({ ...props, swms: null });
  /* still reading: nothing that might turn out to be wrong */
  expect(within(await addMenu()).queryByRole("menuitem", { name: "SWMS" })).toBeNull();
  await userEvent.keyboard("{Escape}");

  rerender(<JobDocumentsFace {...BASE} {...props} swms={[]} />);
  await userEvent.click(within(await addMenu()).getByRole("menuitem", { name: "SWMS" }));
  expect(onCreateSwms).toHaveBeenCalled();

  rerender(<JobDocumentsFace {...BASE} {...props} swms={[summary()]} />);
  expect(within(await addMenu()).queryByRole("menuitem", { name: "SWMS" })).toBeNull();
});

it("holds SWMS until the page knows its job, and keeps the upload on a finished job, where only the SWMS stands down", async () => {
  const { unmount } = face({ swms: [], onCreateSwms: () => {}, canCreateSwms: false, onUpload: async () => null });
  expect(within(await addMenu()).getByRole("menuitem", { name: "SWMS" })).toHaveAttribute("aria-disabled", "true");
  unmount();
  face({ swms: [], onCreateSwms: () => {}, canCreateSwms: true, swmsClosed: true, onUpload: async () => null });
  const menu = await addMenu();
  expect(within(menu).queryByRole("menuitem", { name: "SWMS" })).toBeNull();
  expect(within(menu).getByRole("menuitem", { name: "Upload a file" })).not.toHaveAttribute("aria-disabled");
});

it("says a failed read failed instead of offering a second SWMS or certificate", async () => {
  face({
    swms: null,
    swmsFailed: true,
    certificates: null,
    certificatesFailed: true,
    onCreateSwms: () => {},
    canCreateSwms: true,
    onCreateCertificate: () => {},
    onUpload: async () => null,
  });
  expect(screen.getByText("Couldn't read this job's SWMS and certificates")).toBeInTheDocument();
  const menu = await addMenu();
  expect(within(menu).queryByRole("menuitem", { name: "SWMS" })).toBeNull();
  expect(within(menu).queryByRole("menuitem", { name: "Certificate" })).toBeNull();
});

it("offers Certificate on a job with none, finished or not, and only once the read lands", async () => {
  const onCreateCertificate = jest.fn();
  const { rerender } = face({ certificates: null, onCreateCertificate });
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  rerender(<JobDocumentsFace {...BASE} certificates={[]} onCreateCertificate={onCreateCertificate} swmsClosed />);
  await userEvent.click(within(await addMenu()).getByRole("menuitem", { name: "Certificate" }));
  expect(onCreateCertificate).toHaveBeenCalled();
});

/* ── uploading ─────────────────────────────────────────────────────────── */

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

it("opens the file picker from Upload a file", async () => {
  face({ onUpload: async () => null });
  const picker = screen.getByLabelText("Choose documents to upload") as HTMLInputElement;
  const click = jest.spyOn(picker, "click");
  await userEvent.click(within(await addMenu()).getByRole("menuitem", { name: "Upload a file" }));
  expect(click).toHaveBeenCalled();
});

it("uploads each chosen file in turn, says how far it is, and names the ones that didn't land", async () => {
  const release: (() => void)[] = [];
  const onUpload = jest.fn(
    (file: File) =>
      new Promise<string | null>((done) =>
        release.push(() => done(file.name === "big.pdf" ? "That file is too big — 10 MB is the limit." : null))
      )
  );
  face({ onUpload });

  const picker = screen.getByLabelText("Choose documents to upload");
  /* the picker offers only what the bucket will take */
  expect(picker).toHaveAttribute("accept", expect.stringContaining("application/pdf"));
  fireEvent.change(picker, { target: { files: [pdf("CoC.pdf"), pdf("big.pdf")] } });

  expect(await screen.findByRole("status")).toHaveTextContent("Uploading 1 of 2");
  /* a second batch waits for the first */
  expect(within(await addMenu()).getByRole("menuitem", { name: "Upload a file" })).toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{Escape}");
  await act(async () => release.shift()!());
  expect(await screen.findByRole("status")).toHaveTextContent("Uploading 2 of 2");
  await act(async () => release.shift()!());

  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(onUpload.mock.calls.map(([f]) => f.name)).toEqual(["CoC.pdf", "big.pdf"]);
  expect(screen.getByText("big.pdf: That file is too big — 10 MB is the limit.")).toBeInTheDocument();
  expect(screen.queryByText(/CoC\.pdf:/)).toBeNull();
});

it("takes a file dropped anywhere on the section, and says so while it is held over it", async () => {
  const onUpload = jest.fn(async () => null);
  const { container } = face({ onUpload });
  const target = container.querySelector(".jdoc") as HTMLElement;
  const files = [pdf("plans.pdf")];

  fireEvent.dragOver(target, { dataTransfer: { types: ["Files"], files, dropEffect: "none" } });
  expect(target).toHaveAttribute("data-over");
  expect(screen.getByRole("status")).toHaveTextContent("Drop to upload");

  fireEvent.drop(target, { dataTransfer: { types: ["Files"], files } });
  expect(target).not.toHaveAttribute("data-over");
  await waitFor(() => expect(onUpload).toHaveBeenCalledWith(files[0]));
});

/* ── the groups ────────────────────────────────────────────────────────── */

const item = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
  name: "Builder's plan.pdf",
  fileType: ".pdf",
  kind: "document",
  origin: null,
  takenAt: "2026-09-18 09:12:00",
  url: "https://signed/x.pdf",
  width: null,
  height: null,
  fromClaim: null,
  ...over,
});

const OURS = item({
  remoteId: "doc:d-9",
  documentId: "d-9",
  addedBy: "Isaac Smith",
  name: "Certificate of compliance.pdf",
  takenAt: "2026-09-23 10:40",
});

/* "Stays as quotes. We don't need a money section in the documents" */
it("groups by what a paper is, Compliance last, with no Money group and no counts", () => {
  face({
    designs: [{ id: "z", name: "Option A", mode: "plan", floorCount: 1, systemCount: 2, updatedAt: "2026-10-18T03:00:00Z" } as Props["designs"][number]],
    documents: [
      item({ remoteId: "c1", name: "Plans rev C.pdf", origin: "Emailed in" }),
      OURS,
      item({ remoteId: "q1", name: "Quote #2380", origin: "Quote" }),
      item({ remoteId: "i1", name: "Invoice #2412", origin: "Invoice" }),
      item({ remoteId: "w1", name: "Work order #2412", origin: "Work order" }),
    ],
    swms: [summary()],
  });
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Drawings",
    "From the client",
    "Files",
    "Compliance",
  ]);
  expect(screen.queryByText(/Money/)).toBeNull();
  expect(screen.queryByText("Quote #2380")).toBeNull();
  expect(screen.queryByText("Invoice #2412")).toBeNull();
  expect(screen.queryByText("Work order #2412")).toBeNull();
  expect(screen.queryByText(/—/)).toBeNull();
  expect(within(group("Drawings")).getByRole("link", { name: "Option A" })).toHaveAttribute("href", "/dashboard/studio?design=z");
  expect(within(group("Drawings")).getByText("1 floor, 2 systems, edited Sun 18 Oct")).toBeInTheDocument();
});

it("says what is missing when the job has no paper, and nothing explaining it", () => {
  face({ swms: [], certificates: [], papers: [] });
  expect(screen.getByText("No documents on this job")).toBeInTheDocument();
});

it("says how many files stay in ServiceM8 as a plain fact, and drops the old captions", () => {
  face({ elsewhere: [item({ remoteId: "v1" }), item({ remoteId: "v2" })], documents: [OURS] });
  expect(screen.getByText("2 files stay in ServiceM8")).toBeInTheDocument();
  expect(screen.queryByText(/Showing the newest/)).toBeNull();
  expect(screen.queryByText(/can.t show/)).toBeNull();
});

it("says who added one of ours and when, and opens it in the viewer", async () => {
  const onOpen = jest.fn();
  face({ documents: [OURS], onOpen });
  expect(screen.getByText("Added by Isaac Smith, Wed 23 Sept")).toBeInTheDocument();
  /* the row offers nothing beside its name: its acts are the viewer's */
  expect(within(rowOf("Certificate of compliance.pdf")).getAllByRole("button")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Certificate of compliance.pdf" }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ remoteId: "doc:d-9" }));
});

/* a photograph of a certificate is paper somebody filed — the viewer draws
   it, the same as a PDF; a HEIC it can't draw keeps the browser door */
it("opens a photo of ours in the viewer, and hands a HEIC to the browser", async () => {
  const onOpen = jest.fn();
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  face({
    documents: [
      { ...OURS, remoteId: "doc:d-7", documentId: "d-7", name: "Switchboard label.jpg", fileType: ".jpg" },
      { ...OURS, remoteId: "doc:d-6", documentId: "d-6", name: "Isolator.heic", fileType: ".heic", url: "https://signed/i.heic" },
    ],
    onOpen,
  });
  await userEvent.click(screen.getByRole("button", { name: "Switchboard label.jpg" }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ remoteId: "doc:d-7" }));
  await userEvent.click(screen.getByRole("button", { name: "Isolator.heic" }));
  expect(open).toHaveBeenCalledWith("https://signed/i.heic", "_blank", "noopener,noreferrer");
  expect(onOpen).toHaveBeenCalledTimes(1);
  open.mockRestore();
});

it("names a file not brought across yet without a door", () => {
  face({ documents: [item({ remoteId: "e1", url: null, origin: "Emailed in" })] });
  expect(within(rowOf("Builder's plan.pdf")).getByText("Not brought across yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Builder's plan.pdf" })).toBeNull();
});

/* ── the SWMS ──────────────────────────────────────────────────────────── */

it("files the SWMS under Compliance as a row that opens it, with who it's still waiting on", async () => {
  const onOpenSwms = jest.fn();
  face({ swms: [summary()], onOpenSwms });
  const row = within(group("Compliance")).getByText("Safe Work Method Statement").closest(".pt-row") as HTMLElement;
  /* revised, without a number someone new to the job never saw the start of */
  expect(within(row).queryByText(/version/)).toBeNull();
  expect(
    within(row).getByText("Revised Wed 16 Sept, Troy Porter in charge, 1 of 3 signed on, waiting on Dane Whitmore and Kai Lindqvist")
  ).toBeInTheDocument();
  await userEvent.click(within(row).getByRole("button", { name: "Safe Work Method Statement" }));
  expect(onOpenSwms).toHaveBeenCalledWith(expect.objectContaining({ versionId: "v-2" }));
  /* one thing on the right: Sign on; Revise is the viewer's */
  expect(within(row).getByRole("link", { name: "Sign on" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  expect(within(row).queryByRole("button", { name: "Revise" })).toBeNull();
});

it("says a first one was issued", () => {
  face({ swms: [summary({ version: 1 })] });
  expect(screen.getByText(/^Issued Wed 16 Sept, Troy Porter in charge, /)).toBeInTheDocument();
});

it("offers Sign on only to someone with something to sign", () => {
  face({ swms: [summary({ viewerCanSign: false })] });
  expect(screen.queryByRole("link", { name: "Sign on" })).toBeNull();
});

/* the door stays open while anyone is waiting, so it has to say what it now
   does for someone who signed at 7am */
it("says Sign them on once the reader has signed", () => {
  face({ swms: [summary({ viewerSigned: true })] });
  expect(screen.getByRole("link", { name: "Sign them on" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  expect(screen.queryByRole("link", { name: "Sign on" })).toBeNull();
});

/* WHAT A WORKER RAISED AT SIGN-ON lived in the printed register alone */
it("carries an issue raised at sign-on onto the row, in the colour that needs a look", () => {
  face({ swms: [summary({ issues: [{ name: "Dane Whitmore", issue: "No anchor on the rear ridge" }] })] });
  expect(screen.getByText("Dane Whitmore raised: No anchor on the rear ridge")).toHaveClass("jdoc-look");
});

/* once everyone had signed, the row named an open issue and gave the person
   in charge nothing to press */
it("opens the issue when nobody is left to sign", () => {
  face({ swms: [summary({ viewerCanSign: false, issues: [{ name: "Dane Whitmore", issue: "No anchor on the rear ridge" }] })] });
  expect(screen.getByRole("link", { name: "Open the issue" })).toHaveAttribute("href", "/dashboard/swms/v-2");
});

it("lists several people who raised issues the way a person would", () => {
  face({
    swms: [
      summary({
        issues: [
          { name: "Dane Whitmore", issue: "a" },
          { name: "Kai Lindqvist", issue: "b" },
          { name: "Piers Montgomery", issue: "c" },
        ],
      }),
    ],
  });
  expect(screen.getByText("3 issues raised, by Dane Whitmore, Kai Lindqvist and Piers Montgomery")).toBeInTheDocument();
});

/* ── the business's papers ─────────────────────────────────────────────── */

const TODAY = "2026-09-23";

const paperRow = (over: Partial<JobPaper> = {}): JobPaper => ({
  id: "p1",
  kind: "company",
  name: "Public liability",
  person: null,
  issuer: "QBE",
  expiresOn: "2027-06-30",
  state: "ok",
  renewed: false,
  files: [{ id: "d1", fileName: "coc.pdf", mimeType: "application/pdf", sizeBytes: 1000, url: "https://x/coc.pdf" }],
  addedBy: "Isaac Smith",
  addedAt: "2026-09-23T00:00:00Z",
  manage: true,
  ...over,
});

it("files the business's papers under Compliance, each with whose it is, how long it runs and one state word", () => {
  face({
    today: TODAY,
    swms: [summary()],
    papers: [
      paperRow(),
      paperRow({ id: "p2", name: "Workers compensation", issuer: "icare", expiresOn: "2026-02-28", state: "bad", renewed: true }),
      paperRow({ id: "p3", kind: "staff", name: "ARC licence", person: "Dane Whitmore", issuer: "ARC", expiresOn: "2026-10-05", state: "warn" }),
      paperRow({ id: "p4", name: "Contract works", issuer: "Allianz", renewed: true }),
    ],
  });
  const compliance = within(group("Compliance"));
  expect(compliance.getByText("Public liability, QBE")).toBeInTheDocument();
  expect(within(rowOf("Public liability, QBE")).getByText("To 30 Jun 2027, added by Isaac Smith")).toBeInTheDocument();
  /* data as its owner spells it */
  expect(compliance.getByText("Workers compensation, icare")).toBeInTheDocument();
  expect(compliance.getByText("ARC licence, Dane Whitmore")).toBeInTheDocument();
  /* each row says one thing on its right, in its colour */
  expect(within(rowOf("Public liability, QBE")).queryByText(/Expire|Valid|Renewed/)).toBeNull();
  expect(within(rowOf("Workers compensation, icare")).getByText("Expired").closest(".pt-state")).toHaveClass("pt-state--wrong");
  expect(within(rowOf("ARC licence, Dane Whitmore")).getByText("Expires in 12 days").closest(".pt-state")).toHaveClass("pt-state--look");
  expect(within(rowOf("Contract works, Allianz")).getByText("Renewed since it was added").closest(".pt-state")).toHaveClass("pt-state--look");
  /* no Remove, Use renewal or Delete beside a name: those are the viewer's */
  expect(screen.queryByRole("button", { name: /Remove|Use renewal|Delete/ })).toBeNull();
});

it("opens a paper where the viewer may, and names a colleague's licence without a door for anyone else", async () => {
  const onOpenPaper = jest.fn();
  face({
    today: TODAY,
    onOpenPaper,
    papers: [
      paperRow(),
      paperRow({
        id: "p3",
        kind: "staff",
        name: "ARC licence",
        person: "Dane Whitmore",
        files: [{ id: "d3", fileName: "arc.jpg", mimeType: "image/jpeg", sizeBytes: 1000, url: null }],
        manage: false,
      }),
    ],
  });
  await userEvent.click(screen.getByRole("button", { name: "Public liability, QBE" }));
  expect(onOpenPaper).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  expect(screen.getByText("ARC licence, Dane Whitmore")).toBeInTheDocument();
  expect(within(rowOf("ARC licence, Dane Whitmore")).queryByRole("button")).toBeNull();
});

it("says a failed read failed instead of drawing an empty Compliance group", () => {
  face({ papers: null, papersFailed: true });
  expect(screen.getByText("Couldn't read this job's licences and insurance")).toBeInTheDocument();
});

describe("Licences and insurance", () => {
  const offer: PaperChoices = { company: [], staff: null };

  it("is in Add only for someone who may add a side", async () => {
    face({ onUpload: async () => null, onLoadChoices: async () => offer, onAddPapers: async () => null, mayAdd: { company: false, staff: false } });
    expect(within(await addMenu()).queryByRole("menuitem", { name: "Licences and insurance" })).toBeNull();
  });

  it("opens as a dialog over the page, and closes the same way", async () => {
    const onLoadChoices = jest.fn(async () => offer);
    face({ onLoadChoices, onAddPapers: async () => null, mayAdd: { company: true, staff: false } });
    await userEvent.click(within(await addMenu()).getByRole("menuitem", { name: "Licences and insurance" }));
    const dialog = await screen.findByRole("dialog", { name: "Licences and insurance" });
    expect(dialog.closest(".jdoc")).toBeNull();
    expect(onLoadChoices).toHaveBeenCalledTimes(1);

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/* ── ticking to send ───────────────────────────────────────────────────── */

describe("ticking to send", () => {
  const everything = () => ({
    today: TODAY,
    swms: [summary()],
    papers: [
      paperRow(),
      paperRow({ id: "p2", name: "Workers compensation", state: "bad" as const }),
      paperRow({ id: "p3", kind: "staff" as const, name: "ARC licence", person: "Dane Whitmore", files: [{ id: "d3", fileName: "arc.jpg", mimeType: "image/jpeg", sizeBytes: 1, url: null }] }),
    ],
    documents: [
      item({ remoteId: "f1", name: "Plans rev C.pdf", origin: "Emailed in" }),
      item({ remoteId: "e1", name: "Builder's plan.pdf", origin: "Emailed in", url: null }),
      OURS,
    ],
  });

  it("gives every file with bytes to send a tick — ours, theirs and the papers — and nothing else one", async () => {
    const onPick = jest.fn();
    face({ ...everything(), picked: new Set(["p:p1"]), onPick });
    expect(screen.getByRole("checkbox", { name: "Select Public liability, QBE" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Plans rev C.pdf" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Certificate of compliance.pdf" })).toBeInTheDocument();
    /* a SWMS is a page, an expired certificate isn't to be handed out, a
       colleague's licence won't open for this viewer, and a file not brought
       across has no bytes — each keeps the tick's place, empty */
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(document.querySelectorAll(".jdoc-tick")).toHaveLength(7);

    /* ticking never opens the file */
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Plans rev C.pdf" }));
    expect(onPick).toHaveBeenCalledWith("f:f1", true);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Certificate of compliance.pdf" }));
    expect(onPick).toHaveBeenCalledWith("d:d-9", true);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Public liability, QBE" }));
    expect(onPick).toHaveBeenCalledWith("p:p1", false);
  });

  it("draws no ticks at all for someone who may not send", () => {
    face(everything());
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(document.querySelector(".jdoc-tick")).toBeNull();
  });
});

/* ── ours, in ServiceM8 ──────────────────────────────────────────────────
   Once somebody has sent one of ours, the row's one word says where it
   stands: in ServiceM8, on its way, or that it didn't go, and why goes on
   the grey line. A file never sent says nothing. */
describe("where ours stand with ServiceM8", () => {
  const sent = (documentId: string, status: "sent" | "queued" | "failed" | "trial", over = {}) => ({
    documentId,
    status,
    error: null as string | null,
    attempts: 1,
    remoteUuid: `r-${documentId}`,
    ...over,
  });

  it("says In ServiceM8 on a paper and an upload that went, in green", () => {
    face({ today: TODAY, papers: [paperRow()], documents: [OURS], sends: [sent("d1", "sent"), sent("d-9", "sent")] });
    const words = screen.getAllByText("In ServiceM8");
    expect(words).toHaveLength(2);
    for (const w of words) expect(w.closest(".pt-state")).toHaveClass("pt-state--good");
  });

  it("says one didn't go in red, and why on its grey line", () => {
    face({ documents: [OURS], sends: [sent("d-9", "failed", { error: "ServiceM8 said the file is too big." })] });
    const row = rowOf("Certificate of compliance.pdf");
    expect(within(row).getByText("Not sent to ServiceM8").closest(".pt-state")).toHaveClass("pt-state--wrong");
    expect(within(row).getByText("Added by Isaac Smith, Wed 23 Sept. ServiceM8 said the file is too big.")).toBeInTheDocument();
  });

  it("says one is on its way, in grey", () => {
    face({ documents: [OURS], sends: [sent("d-9", "queued", { attempts: 0 })] });
    expect(screen.getByText("Sending to ServiceM8…").closest(".pt-state")).toHaveClass("pt-state--info");
  });

  it("says a waiting one is held by a pause, or a reconnect", () => {
    const { unmount } = face({ documents: [OURS], sends: [sent("d-9", "queued", { attempts: 0 })], sendHold: "paused" });
    expect(screen.getByText("Not in ServiceM8 yet")).toBeInTheDocument();
    expect(screen.getByText(/Sending is paused\.$/)).toBeInTheDocument();
    unmount();
    face({ documents: [OURS], sends: [sent("d-9", "queued", { attempts: 1 })], sendHold: "reconnect" });
    expect(screen.getByText("Not in ServiceM8 yet").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(screen.getByText(/ServiceM8 needs reconnecting\.$/)).toBeInTheDocument();
  });

  it("says nothing for a file never sent, or sent on a trial run", () => {
    face({ today: TODAY, papers: [paperRow()], documents: [OURS], sends: [sent("d1", "trial")] });
    expect(screen.queryByText(/ServiceM8/)).toBeNull();
  });

  it("says the worse of a paper's own state and where it stands with ServiceM8", () => {
    face({
      today: TODAY,
      papers: [paperRow({ state: "warn", expiresOn: "2026-10-05" })],
      sends: [sent("d1", "failed", { error: "Refused." })],
    });
    const row = rowOf("Public liability, QBE");
    expect(within(row).getByText("Not sent to ServiceM8")).toBeInTheDocument();
    expect(within(row).queryByText(/Expires in/)).toBeNull();
  });
});

/* ── certificates ──────────────────────────────────────────────────────── */

const cert = {
  certificateId: "c-1",
  versionId: "cv-1",
  version: 1,
  title: "Mechanical Compliance Certificate",
  issuedAt: "2026-10-01T03:00:00Z",
  issuedBy: "Isaac Smith",
  issuedById: "staff-1",
  documentId: "d-9",
};

it("files a certificate under Compliance with who signed it and its PDF's tick, opening it in the viewer", async () => {
  const onOpenCertificate = jest.fn();
  const onPick = jest.fn();
  face({ certificates: [cert], onCreateCertificate: () => {}, onOpenCertificate, picked: new Set(), onPick });
  /* one per job: a later one is a reissue, from the viewer */
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  const row = within(group("Compliance")).getByText("Mechanical Compliance Certificate").closest(".pt-row") as HTMLElement;
  expect(within(row).getByText("Issued Thu 1 Oct, signed by Isaac Smith")).toBeInTheDocument();
  await userEvent.click(within(row).getByRole("button", { name: "Mechanical Compliance Certificate" }));
  expect(onOpenCertificate).toHaveBeenCalledWith(cert);
  await userEvent.click(within(row).getByRole("checkbox", { name: "Select Mechanical Compliance Certificate" }));
  expect(onPick).toHaveBeenCalledWith("d:d-9", true);
  expect(within(row).queryByRole("button", { name: /Reissue|Delete/ })).toBeNull();
});

it("keeps a certificate with the SWMS and the licences, never in Files", () => {
  face({ certificates: [cert], swms: [summary()], papers: [paperRow()] });
  const compliance = within(group("Compliance"));
  expect(compliance.getByText("Mechanical Compliance Certificate")).toBeInTheDocument();
  expect(compliance.getByText("Safe Work Method Statement")).toBeInTheDocument();
  expect(compliance.getByText("Public liability, QBE")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
});
