/* The job's paper, with the SWMS leading under Compliance and created from
   the face's head. */

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

it("files the SWMS under Compliance, with who it's still waiting on", async () => {
  const onReviseSwms = jest.fn();
  face({ swms: [summary()], onReviseSwms, onCreateSwms: () => {}, canCreateSwms: true });

  expect(screen.getByText("Compliance — 1")).toBeInTheDocument();
  expect(screen.getByText("Safe Work Method Statement, version 2")).toBeInTheDocument();
  expect(
    screen.getByText("Issued Wed 16 Sept, Troy Porter responsible. 1 of 3 signed on, waiting on Dane Whitmore and Kai Lindqvist")
  ).toBeInTheDocument();
  expect(screen.getByText("1 file")).toBeInTheDocument();

  const row = screen.getByText("Safe Work Method Statement, version 2").closest(".sw-docrow") as HTMLElement;
  expect(within(row).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/swms/v-2");
  expect(within(row).getByRole("link", { name: "Sign on" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  await userEvent.click(within(row).getByRole("button", { name: "Revise" }));
  expect(onReviseSwms).toHaveBeenCalledWith("v-2");
});

it("drops the sign-on door once everyone has signed", () => {
  face({ swms: [summary({ signed: 3, waitingOn: [] })] });
  expect(screen.getByText(/3 of 3 signed on$/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sign on" })).toBeNull();
});

it("creates a SWMS from the head, once the card knows its job", async () => {
  const onCreateSwms = jest.fn();
  const { rerender } = face({ onCreateSwms, canCreateSwms: false });
  expect(screen.getByRole("button", { name: "Create SWMS" })).toBeDisabled();
  expect(screen.getByText("No documents on this job.")).toBeInTheDocument();

  rerender(
    <JobDocumentsFace documents={[]} elsewhere={[]} designs={[]} loading={false} truncated={false} onOpen={() => {}} onCreateSwms={onCreateSwms} canCreateSwms />
  );
  await userEvent.click(screen.getByRole("button", { name: "Create SWMS" }));
  expect(onCreateSwms).toHaveBeenCalled();
});
