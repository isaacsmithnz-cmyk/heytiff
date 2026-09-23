/* The job's paper, with the SWMS leading under Compliance: the same row as
   every document, a sign-on door only for someone with something to sign,
   and Create SWMS only while the job has none. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SwmsSummary } from "@/lib/swms/query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
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
