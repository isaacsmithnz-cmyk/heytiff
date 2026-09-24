/* The job's paper, with the SWMS leading under Compliance: the same row as
   every document, a sign-on door only for someone with something to sign,
   and Create SWMS only while the job has none. */

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

const face = (props: Partial<Parameters<typeof JobDocumentsFace>[0]> = {}) =>
  render(
    <JobDocumentsFace
      documents={[]}
      elsewhere={[]}
      designs={[]}
      loading={false}
      truncated={false}
      onOpen={() => {}}
      {...props}
    />
  );

it("files the SWMS under Compliance as a document row that opens it, with who it's still waiting on", async () => {
  const onOpenSwms = jest.fn();
  const onReviseSwms = jest.fn();
  face({ swms: [summary()], onOpenSwms, onReviseSwms, onCreateSwms: () => {}, canCreateSwms: true });

  expect(screen.getByText("Compliance — 1")).toBeInTheDocument();
  const open = screen.getByRole("button", { name: /Safe Work Method Statement/ });
  expect(open).toHaveClass("wb2-doc");
  /* revised, without a number someone new to the job never saw the start of */
  expect(within(open).queryByText(/version/)).toBeNull();
  expect(
    within(open).getByText("Revised Wed 16 Sept, Troy Porter in charge. 1 of 3 signed on, waiting on Dane Whitmore and Kai Lindqvist")
  ).toBeInTheDocument();
  await userEvent.click(open);
  expect(onOpenSwms).toHaveBeenCalledWith(expect.objectContaining({ versionId: "v-2" }));

  const row = open.closest(".wb2-docrow") as HTMLElement;
  expect(within(row).getByRole("link", { name: "Sign on" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  await userEvent.click(within(row).getByRole("button", { name: "Revise" }));
  expect(onReviseSwms).toHaveBeenCalledWith("v-2");
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
it("carries an issue raised at sign-on onto the row", () => {
  face({ swms: [summary({ issues: [{ name: "Dane Whitmore", issue: "No anchor on the rear ridge" }] })] });
  expect(screen.getByText("Dane Whitmore raised: No anchor on the rear ridge")).toBeInTheDocument();
});

/* once everyone had signed, the row named an open issue in red and gave the
   person in charge nothing to press */
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

/* a read that failed offered Create SWMS on a job that may already have one,
   and a second press was a second SWMS */
it("says a failed read failed instead of offering to create a second SWMS", () => {
  face({ swms: null, swmsFailed: true, onCreateSwms: () => {}, canCreateSwms: true });
  expect(screen.getByText("Couldn't read this job's SWMS. Close the card and open it again.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create SWMS" })).toBeNull();
});

it("says a first issue was issued", () => {
  face({ swms: [summary({ version: 1 })] });
  expect(screen.getByText(/^Issued Wed 16 Sept, Troy Porter in charge\./)).toBeInTheDocument();
});

it("offers Create SWMS only while the job has none — a second press was a second SWMS", async () => {
  const onCreateSwms = jest.fn();
  const { rerender } = face({ swms: null, onCreateSwms, canCreateSwms: true });
  /* still reading: no button that might turn out to be wrong */
  expect(screen.queryByRole("button", { name: "Create SWMS" })).toBeNull();

  rerender(
    <JobDocumentsFace documents={[]} elsewhere={[]} designs={[]} loading={false} truncated={false} onOpen={() => {}} swms={[]} onCreateSwms={onCreateSwms} canCreateSwms />
  );
  await userEvent.click(screen.getByRole("button", { name: "Create SWMS" }));
  expect(onCreateSwms).toHaveBeenCalled();

  rerender(
    <JobDocumentsFace documents={[]} elsewhere={[]} designs={[]} loading={false} truncated={false} onOpen={() => {}} swms={[summary()]} onCreateSwms={onCreateSwms} canCreateSwms />
  );
  expect(screen.queryByRole("button", { name: "Create SWMS" })).toBeNull();
});

/* ── the ways in ───────────────────────────────────────────────────────── */

/* Create SWMS sat in the title's own line, floating off the count at the far
   edge ("it floats a bit weirdly in the top"). It sits with the upload in the
   row under the title — the row every face keeps for adding to it. */
it("puts Create SWMS in the row under the title, beside the upload", () => {
  face({ swms: [], onCreateSwms: () => {}, canCreateSwms: true, onUpload: async () => null });
  const create = screen.getByRole("button", { name: "Create SWMS" });
  const upload = screen.getByRole("button", { name: "Upload a document" });
  expect(create.closest(".wb2-jcdhead")).toBeNull();
  expect(create.closest(".wb2-jcdadd")).not.toBeNull();
  expect(upload.closest(".wb2-jcdadd")).toBe(create.closest(".wb2-jcdadd"));
});

it("keeps the upload on a finished job, where only the SWMS stands down", () => {
  face({ swms: [], onCreateSwms: () => {}, canCreateSwms: true, swmsClosed: true, onUpload: async () => null });
  expect(screen.queryByRole("button", { name: "Create SWMS" })).toBeNull();
  expect(screen.getByRole("button", { name: "Upload a document" })).toBeEnabled();
});

it("draws no row of ways in when there is nothing to add with", () => {
  const { container } = face({ swms: [{ ...summary() }], onCreateSwms: () => {} });
  expect(container.querySelector(".wb2-jcdadd")).toBeNull();
});

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

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

  expect(await screen.findByRole("button", { name: "Uploading 1 of 2…" })).toBeDisabled();
  await act(async () => release.shift()!());
  expect(await screen.findByRole("button", { name: "Uploading 2 of 2…" })).toBeDisabled();
  await act(async () => release.shift()!());

  expect(await screen.findByRole("button", { name: "Upload a document" })).toBeEnabled();
  expect(onUpload.mock.calls.map(([f]) => f.name)).toEqual(["CoC.pdf", "big.pdf"]);
  expect(screen.getByText("big.pdf: That file is too big — 10 MB is the limit.")).toBeInTheDocument();
  expect(screen.queryByText(/CoC\.pdf:/)).toBeNull();
});

it("takes a file dropped on the face, and says so while it is held over it", async () => {
  const onUpload = jest.fn(async () => null);
  const { container } = face({ onUpload });
  const target = container.querySelector(".wb2-jcdoc") as HTMLElement;
  const files = [pdf("plans.pdf")];

  fireEvent.dragOver(target, { dataTransfer: { types: ["Files"], files, dropEffect: "none" } });
  expect(target).toHaveAttribute("data-over");
  expect(screen.getByRole("button", { name: "Drop to upload" })).toBeInTheDocument();

  fireEvent.drop(target, { dataTransfer: { types: ["Files"], files } });
  expect(target).not.toHaveAttribute("data-over");
  await waitFor(() => expect(onUpload).toHaveBeenCalledWith(files[0]));
});

/* ── ours, beside theirs ───────────────────────────────────────────────── */

const item = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
  name: "Invoice #2412",
  fileType: ".pdf",
  kind: "document",
  origin: "Invoice",
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
  origin: null,
  takenAt: "2026-09-23 10:40",
});

it("says who added one of ours, and offers to take only ours back off", () => {
  face({ documents: [OURS, item({ remoteId: "sm8-1" })], onRemove: async () => null });
  expect(screen.getByText("Added by Isaac Smith, Wed 23 Sept")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  const theirs = screen.getByRole("button", { name: /Invoice #2412/ });
  expect(theirs.closest(".wb2-docrow")).toBeNull();
});

it("asks before the file goes, and names what the second press does", async () => {
  const onRemove = jest.fn(async () => null);
  face({ documents: [OURS], onRemove });
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(onRemove).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete file" }));
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ documentId: "d-9" }));
});

it("keeps a row whose removal was refused, and says why", async () => {
  face({ documents: [OURS], onRemove: async () => "Couldn't remove that file." });
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete file" }));
  expect(await screen.findByText("Couldn't remove that file.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
});

/* a photograph of a certificate is paper somebody filed — the card's viewer
   draws it, the same as a PDF; a HEIC it can't draw keeps the browser door */
it("opens a photo of ours in the card, and hands a HEIC to the browser", async () => {
  const onOpen = jest.fn();
  face({
    documents: [
      { ...OURS, remoteId: "doc:d-7", documentId: "d-7", name: "Switchboard label.jpg", fileType: ".jpg" },
      { ...OURS, remoteId: "doc:d-6", documentId: "d-6", name: "Isolator.heic", fileType: ".heic" },
    ],
    onOpen,
  });
  await userEvent.click(screen.getByRole("button", { name: /Switchboard label\.jpg/ }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ remoteId: "doc:d-7" }));
  expect(screen.getByRole("link", { name: /Isolator\.heic/ })).toHaveAttribute("target", "_blank");
});

/* ── compliance: the business's papers on the job, and sending ─────────── */

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

const doc = (over: Partial<JobMediaItem> = {}): JobMediaItem => ({
  remoteId: "q1",
  name: "Quote #2380",
  fileType: ".pdf",
  kind: "document",
  origin: "Quote",
  takenAt: "2026-09-10 09:00:00",
  url: "https://x/q.pdf",
  width: null,
  height: null,
  fromClaim: null,
  ...over,
});

it("files the business's papers under Compliance beside the SWMS, saying what needs doing", () => {
  face({
    today: TODAY,
    swms: [summary()],
    papers: [
      paperRow(),
      paperRow({ id: "p2", name: "Workers compensation", issuer: "icare", expiresOn: "2026-02-28", state: "bad", renewed: true }),
      paperRow({ id: "p3", kind: "staff", name: "ARC licence", person: "Dane Whitmore", issuer: "ARC", expiresOn: "2026-10-05", state: "warn" }),
    ],
  });
  expect(screen.getByText("Compliance — 4")).toBeInTheDocument();
  expect(screen.getByText("QBE, to 30 Jun 2027, added by Isaac Smith")).toBeInTheDocument();
  /* data as its owner spells it */
  expect(screen.getByText("icare, to 28 Feb 2026, added by Isaac Smith")).toBeInTheDocument();
  expect(screen.getByText("Expired")).toHaveClass("sw-state", "bad");
  expect(screen.getByText("Dane Whitmore, to 5 Oct 2026, added by Isaac Smith")).toBeInTheDocument();
  expect(screen.getByText("Expires in 12 days")).toHaveClass("sw-state", "warn");
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
  await userEvent.click(screen.getByRole("button", { name: /Public liability/ }));
  expect(onOpenPaper).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  expect(screen.getByText("ARC licence")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /ARC licence/ })).toBeNull();
  /* and one they can't manage offers nothing to press */
  const row = screen.getByText("ARC licence").closest(".wb2-docrow") as HTMLElement;
  expect(within(row).queryByRole("button")).toBeNull();
});

it("takes a paper off the job in two presses, and the second says the paper itself stays", async () => {
  const onRemovePaper = jest.fn(async () => null);
  face({ today: TODAY, papers: [paperRow()], onRemovePaper });
  const row = screen.getByText("Public liability").closest(".wb2-docrow") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
  expect(within(row).queryByRole("button", { name: "Delete file" })).toBeNull();
  await userEvent.click(within(row).getByRole("button", { name: "Remove from job" }));
  expect(onRemovePaper).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
});

it("says why a paper didn't come off, and keeps it", async () => {
  face({ today: TODAY, papers: [paperRow()], onRemovePaper: async () => "You can't take that off the job." });
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove from job" }));
  expect(await screen.findByText("You can't take that off the job.")).toBeInTheDocument();
  expect(screen.getByText("Public liability")).toBeInTheDocument();
});

it("moves a renewed paper to its renewal in one press", async () => {
  const onRenewPaper = jest.fn(async () => null);
  face({ today: TODAY, papers: [paperRow({ renewed: true }), paperRow({ id: "p2", name: "Workers compensation" })], onRenewPaper });
  expect(screen.getByText("Renewed since it was added")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Use renewal" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Use renewal" }));
  expect(onRenewPaper).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
});

it("says a failed read failed instead of drawing an empty Compliance group", () => {
  face({ papers: null, papersFailed: true });
  expect(screen.getByText("Couldn't read this job's licences and insurance. Close the card and open it again.")).toBeInTheDocument();
});

describe("Add compliance", () => {
  const offer: PaperChoices = { company: [], staff: null };

  it("sits in the row of ways in, only for someone who may add a side", () => {
    face({ onLoadChoices: async () => offer, onAddPapers: async () => null, mayAdd: { company: false, staff: false } });
    expect(screen.queryByRole("button", { name: "Add compliance" })).toBeNull();
  });

  it("opens IN the face under the ways in — not over the card — and closes the same way", async () => {
    const onLoadChoices = jest.fn(async () => offer);
    face({ onLoadChoices, onAddPapers: async () => null, mayAdd: { company: true, staff: false }, swms: [] , onCreateSwms: () => {}, canCreateSwms: true });
    const add = screen.getByRole("button", { name: "Add compliance" });
    expect(add.closest(".wb2-jcdadd")).toBe(screen.getByRole("button", { name: "Create SWMS" }).closest(".wb2-jcdadd"));
    expect(add).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(add);
    const chooser = await screen.findByRole("group", { name: "Add compliance" });
    expect(chooser.closest(".wb2-jcdoc")).not.toBeNull();
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(onLoadChoices).toHaveBeenCalledTimes(1);

    await userEvent.click(within(chooser).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Add compliance" })).toBeNull();
  });
});

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
      doc(),
      doc({ remoteId: "e1", name: "Builder's plan.pdf", origin: "Emailed in", url: null }),
      doc({ remoteId: "doc:u1", name: "Certificate of compliance.pdf", origin: null, documentId: "u1", addedBy: "Isaac Smith" }),
    ],
  });

  it("gives every file with bytes to send a tick — ours, theirs and the papers — and nothing else one", async () => {
    const onPick = jest.fn();
    face({ ...everything(), picked: new Set(["p:p1"]), onPick });
    expect(screen.getByRole("checkbox", { name: "Select Public liability" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Quote #2380" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Certificate of compliance.pdf" })).toBeInTheDocument();
    /* a SWMS is a page, an expired certificate isn't to be handed out, a
       colleague's licence won't open for this viewer, and a file not brought
       across has no bytes — each keeps the tick's place, empty */
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(document.querySelectorAll(".wb2-docpick")).toHaveLength(7);

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Quote #2380" }));
    expect(onPick).toHaveBeenCalledWith("f:q1", true);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Certificate of compliance.pdf" }));
    expect(onPick).toHaveBeenCalledWith("d:u1", true);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Public liability" }));
    expect(onPick).toHaveBeenCalledWith("p:p1", false);
  });

  it("draws no ticks at all for someone who may not send", () => {
    face(everything());
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(document.querySelector(".wb2-docpick")).toBeNull();
  });
});

/* ── ours, in ServiceM8 ──────────────────────────────────────────────────
   Once somebody has sent one of ours from the footer, the row says where it
   stands: in ServiceM8, on its way, or why it didn't go — in the state's
   colour, under the name. A file never sent says nothing. */
describe("where ours stand with ServiceM8", () => {
  const sent = (documentId: string, status: "sent" | "queued" | "failed" | "trial", over = {}) => ({
    documentId,
    status,
    error: null as string | null,
    attempts: 1,
    remoteUuid: `r-${documentId}`,
    ...over,
  });

  it("says In ServiceM8 under a paper and an upload that went, in the OK colour", () => {
    face({
      today: TODAY,
      papers: [paperRow()],
      documents: [OURS],
      sends: [sent("d1", "sent"), sent("d-9", "sent")],
    });
    const lines = screen.getAllByText("In ServiceM8");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveClass("sw-state", "ok");
  });

  it("says why one didn't go, in the bad colour", () => {
    face({
      documents: [OURS],
      sends: [sent("d-9", "failed", { error: "ServiceM8 said the file is too big." })],
    });
    expect(screen.getByText("Not sent to ServiceM8. ServiceM8 said the file is too big.")).toHaveClass("sw-state", "bad");
  });

  it("says one is on its way, quietly", () => {
    face({ documents: [OURS], sends: [sent("d-9", "queued", { attempts: 0 })] });
    const line = screen.getByText("Sending to ServiceM8…");
    expect(line).not.toHaveClass("sw-state");
  });

  it("says nothing for a file never sent, or sent on a trial run", () => {
    face({ today: TODAY, papers: [paperRow()], documents: [OURS], sends: [sent("d1", "trial")] });
    expect(screen.queryByText(/ServiceM8/)).toBeNull();
  });
});
