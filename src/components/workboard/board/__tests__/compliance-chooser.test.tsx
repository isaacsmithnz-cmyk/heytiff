/* Licences and insurance — the business's papers and the team's tickets,
   chosen in the v2 dialog that Documents' Add opens (the mock of 25 October
   2026, frame 7). What this pins: each side only for someone who may add it,
   as soft tabs when there are both; every row a tick with its state word on
   the right; a paper that can't be given says why instead of offering a
   box; the team's tickets grouped by licence, the trade tickets first, the
   people on the job first under each; ticks survive switching sides; and
   what Add to job sends is every tick, once. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaperChoice, PaperChoices } from "@/lib/compliance/papers";
import { ComplianceChooser } from "../compliance-chooser";

const TODAY = "2026-09-23";

const choice = (over: Partial<PaperChoice>): PaperChoice => ({
  key: "c:x",
  kind: "company",
  name: "",
  person: null,
  issuer: null,
  expiresOn: "2027-06-30",
  state: "ok",
  files: 1,
  booked: false,
  onJob: false,
  ...over,
});

const offer: PaperChoices = {
  company: [
    choice({ key: "c:pl", name: "Public liability", issuer: "QBE", onJob: true }),
    choice({ key: "c:wc", name: "Workers compensation", issuer: "icare", expiresOn: "2027-02-28" }),
    choice({ key: "c:cl", name: "Contractor licence", expiresOn: "2026-08-01", state: "bad" }),
    choice({ key: "c:pi", name: "Professional indemnity", files: 0 }),
  ],
  staff: [
    choice({ key: "l:1", kind: "staff", name: "Driver’s licence", person: "Dane Whitmore", booked: true }),
    choice({ key: "l:2", kind: "staff", name: "ARC licence", person: "Kai Lindqvist" }),
    choice({ key: "l:3", kind: "staff", name: "ARC licence", person: "Dane Whitmore", booked: true }),
    choice({ key: "l:4", kind: "staff", name: "ARC licence", person: "Troy Porter", expiresOn: "2026-10-05", state: "warn" }),
  ],
};

const open = (over: Partial<Parameters<typeof ComplianceChooser>[0]> = {}) => {
  const props = {
    today: TODAY,
    onLoad: jest.fn(async () => offer),
    onAdd: jest.fn(async () => null as string | null),
    onClose: jest.fn(),
    ...over,
  };
  render(<ComplianceChooser {...props} />);
  return props;
};

/** The state word on a row's right, and the tone it is drawn in. */
const stateOf = (name: RegExp) => {
  const row = screen.getByRole("checkbox", { name }).closest(".pt-row") as HTMLElement;
  return row.querySelector(".pt-row-end .pt-state") as HTMLElement;
};

it("is the v2 dialog, saying what it is doing while it reads", async () => {
  open({ onLoad: () => new Promise(() => {}) });
  expect(screen.getByRole("dialog", { name: "Licences and insurance" })).toBeInTheDocument();
  expect(await screen.findByRole("status")).toHaveTextContent("Reading the licences and insurance");
});

it("says a failed read failed", async () => {
  open({ onLoad: async () => null });
  expect(await screen.findByText("Couldn't read the licences and insurance")).toBeInTheDocument();
});

it("lists the business's papers, each with its state word, offering no box for one that can't be given and saying why", async () => {
  open();
  await screen.findByRole("tab", { name: "Company" });
  expect(screen.getByRole("checkbox", { name: /Public liability/ })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /Public liability/ })).toBeChecked();
  expect(stateOf(/Public liability/)).toHaveTextContent("On this job");
  expect(screen.getByRole("checkbox", { name: /Contractor licence/ })).toBeDisabled();
  expect(stateOf(/Contractor licence/)).toHaveTextContent("Expired");
  expect(stateOf(/Contractor licence/)).toHaveClass("pt-state--wrong");
  expect(screen.getByRole("checkbox", { name: /Professional indemnity/ })).toBeDisabled();
  expect(stateOf(/Professional indemnity/)).toHaveTextContent("No certificate on file");
  expect(screen.getByRole("checkbox", { name: /Workers compensation/ })).toBeEnabled();
  expect(stateOf(/Workers compensation/)).toHaveTextContent("Valid");
  expect(stateOf(/Workers compensation/)).toHaveClass("pt-state--good");
  expect(screen.getByText("icare, to 28 Feb 2027")).toBeInTheDocument();
});

it("groups the team's tickets by licence — the trade tickets lead — with the people on the job first under each", async () => {
  open();
  await userEvent.click(await screen.findByRole("tab", { name: "Staff licences" }));
  const groups = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(groups).toEqual(["ARC licence", "Driver’s licence"]);
  const arc = within(screen.getByRole("region", { name: "ARC licence" }));
  const names = arc.getAllByRole("checkbox").map((c) => c.closest("label")?.querySelector("b")?.textContent);
  expect(names).toEqual(["Dane Whitmore", "Kai Lindqvist", "Troy Porter"]);
  expect(arc.getByText(/^Booked on this job, /)).toBeInTheDocument();
  expect(stateOf(/Troy Porter/)).toHaveTextContent("Expires in 12 days");
  expect(stateOf(/Troy Porter/)).toHaveClass("pt-state--look");
});

it("keeps ticks across the two sides, counts them at the foot, and adds every one once", async () => {
  const props = open();
  await screen.findByRole("tab", { name: "Company" });
  const add = screen.getByRole("button", { name: "Add to job" });
  expect(add).toBeDisabled();
  expect(add).toHaveClass("pt-btn--main");

  await userEvent.click(screen.getByRole("checkbox", { name: /Workers compensation/ }));
  await userEvent.click(screen.getByRole("tab", { name: "Staff licences" }));
  const arc = within(screen.getByRole("region", { name: "ARC licence" }));
  await userEvent.click(arc.getByRole("checkbox", { name: /Dane Whitmore/ }));
  const driver = within(screen.getByRole("region", { name: "Driver’s licence" }));
  await userEvent.click(driver.getByRole("checkbox", { name: /Dane Whitmore/ }));
  /* back to the company's: its tick is still there */
  await userEvent.click(screen.getByRole("tab", { name: "Company" }));
  expect(screen.getByRole("checkbox", { name: /Workers compensation/ })).toBeChecked();
  expect(screen.getByText("3 ticked")).toBeInTheDocument();

  await userEvent.click(add);
  expect(props.onAdd).toHaveBeenCalledWith(["c:wc", "l:3", "l:1"]);
  await waitFor(() => expect(props.onClose).toHaveBeenCalled());
});

it("stays open and says why when they didn't go on", async () => {
  const props = open({ onAdd: jest.fn(async () => "Workers compensation has expired.") });
  await screen.findByRole("tab", { name: "Company" });
  await userEvent.click(screen.getByRole("checkbox", { name: /Workers compensation/ }));
  await userEvent.click(screen.getByRole("button", { name: "Add to job" }));
  expect(await screen.findByText("Workers compensation has expired.")).toBeInTheDocument();
  expect(props.onClose).not.toHaveBeenCalled();
});

it("offers only the side the viewer may add, with no tabs for one", async () => {
  open({ onLoad: async () => ({ company: null, staff: offer.staff }) });
  await screen.findByRole("region", { name: "ARC licence" });
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByText("Public liability")).toBeNull();
});

it("says what is missing when there are none, and nothing explaining it", async () => {
  open({ onLoad: async () => ({ company: [], staff: [] }) });
  expect(await screen.findByText("No licences or insurance on file")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Staff licences" }));
  expect(screen.getByText("No staff licences on file")).toBeInTheDocument();
  expect(screen.queryByText(/added on/)).toBeNull();
});

it("closes on Cancel", async () => {
  const props = open();
  await screen.findByRole("tab", { name: "Company" });
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(props.onClose).toHaveBeenCalled();
});
