import { render, screen } from "@testing-library/react";
import { VariationPaper } from "../variation-paper";
import { VersionPaper } from "../version-paper";

/* A version's approval and a variation's start are timestamps: the papers
   say the day they were in Australia. 21:30 UTC on the 12th is 8:30 on
   Tuesday the 13th in Sydney; sliced, the paper said Monday the 12th. */

const morning = "2026-10-12T21:30:00Z";

it("dates a version by the day it was approved in Australia", () => {
  render(<VersionPaper version={{ n: 1, what: "", approvedAt: morning, madeAt: morning, options: [] }} jobNumber="3384" client={null} />);
  expect(screen.getByText("Approved Tue 13 Oct 2026")).toBeInTheDocument();
});

it("dates a variation by the day it was started in Australia", () => {
  render(
    <VariationPaper
      n={1}
      what="A zone added"
      startedAt={morning}
      jobNumber="3384"
      client={null}
      acceptedExCents={100000}
      newExCents={120000}
      newIncCents={132000}
      changes={{ added: [], changed: [], removed: [] }}
    />
  );
  expect(screen.getByText("Tue 13 Oct 2026")).toBeInTheDocument();
});
