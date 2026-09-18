/* The job's paper, with the SWMS leading under Compliance: the same row as
   every document, a sign-on door only for someone with something to sign,
   and Create SWMS only while the job has none. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SwmsSummary } from "@/lib/swms/query";
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
  viewerCanSign: true,
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

  const row = open.closest(".sw-docrow") as HTMLElement;
  expect(within(row).getByRole("link", { name: "Sign on" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  await userEvent.click(within(row).getByRole("button", { name: "Revise" }));
  expect(onReviseSwms).toHaveBeenCalledWith("v-2");
});

it("offers Sign on only to someone with something to sign", () => {
  face({ swms: [summary({ viewerCanSign: false })] });
  expect(screen.queryByRole("link", { name: "Sign on" })).toBeNull();
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
