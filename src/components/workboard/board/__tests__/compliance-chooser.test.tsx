/* Add compliance — the business's papers and the team's tickets, chosen IN
   the Documents face. What this pins: each side only for someone who may add
   it; a paper that can't be given says why instead of offering a box; the
   team's tickets are asked the way the office asks — which licence, then
   whose, with the people on the job first — and ticks survive switching
   licence; and what Add to job sends is every tick, once. */

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

it("says what it is doing while it reads", () => {
  open({ onLoad: () => new Promise(() => {}) });
  expect(screen.getByText("Reading the licences and insurance…")).toBeInTheDocument();
});

it("says a failed read failed", async () => {
  open({ onLoad: async () => null });
  expect(await screen.findByText("Couldn't read the licences and insurance. Close the card and open it again.")).toBeInTheDocument();
});

it("lists the business's papers, offering no box for one that can't be given and saying why", async () => {
  open();
  await screen.findByText("Company");
  expect(screen.getByRole("checkbox", { name: /Public liability/ })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /Public liability/ })).toBeChecked();
  expect(screen.getByText("On this job")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Contractor licence/ })).toBeDisabled();
  expect(screen.getByText("Expired")).toHaveClass("bad");
  expect(screen.getByRole("checkbox", { name: /Professional indemnity/ })).toBeDisabled();
  expect(screen.getByText("No certificate on file")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Workers compensation/ })).toBeEnabled();
  expect(screen.getByText("icare, to 28 Feb 2027")).toBeInTheDocument();
});

it("asks which licence first — the trade tickets lead — then whose, with the people on the job first", async () => {
  open();
  const types = await screen.findByRole("group", { name: "Which licence" });
  const buttons = within(types).getAllByRole("button");
  expect(buttons.map((b) => b.textContent)).toEqual(["ARC licence", "Driver’s licence"]);
  expect(buttons[0]).toHaveAttribute("aria-pressed", "true");

  const names = screen.getAllByRole("checkbox").map((c) => c.closest("label")?.querySelector("b")?.textContent);
  expect(names.slice(-3)).toEqual(["Dane Whitmore", "Kai Lindqvist", "Troy Porter"]);
  expect(screen.getByText("Booked on this job")).toBeInTheDocument();
  expect(screen.getByText("Expires in 12 days")).toHaveClass("warn");
});

it("keeps ticks across licence types, counts them, and adds every one once", async () => {
  const props = open();
  await screen.findByText("Company");
  const add = screen.getByRole("button", { name: "Add to job" });
  expect(add).toBeDisabled();

  await userEvent.click(screen.getByRole("checkbox", { name: /Workers compensation/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Dane Whitmore/ }));
  await userEvent.click(screen.getByRole("button", { name: "Driver’s licence" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Dane Whitmore/ }));
  /* back to ARC: Dane's tick is still there */
  await userEvent.click(screen.getByRole("button", { name: /^ARC licence/ }));
  expect(screen.getByRole("checkbox", { name: /Dane Whitmore/ })).toBeChecked();
  expect(screen.getByText("3 ticked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^ARC licence/ })).toHaveTextContent("ARC licence1");

  await userEvent.click(add);
  expect(props.onAdd).toHaveBeenCalledWith(["c:wc", "l:3", "l:1"]);
  await waitFor(() => expect(props.onClose).toHaveBeenCalled());
});

it("stays open and says why when they didn't go on", async () => {
  const props = open({ onAdd: jest.fn(async () => "Workers compensation has expired.") });
  await screen.findByText("Company");
  await userEvent.click(screen.getByRole("checkbox", { name: /Workers compensation/ }));
  await userEvent.click(screen.getByRole("button", { name: "Add to job" }));
  expect(await screen.findByText("Workers compensation has expired.")).toBeInTheDocument();
  expect(props.onClose).not.toHaveBeenCalled();
});

it("offers only the side the viewer may add", async () => {
  open({ onLoad: async () => ({ company: null, staff: offer.staff }) });
  await screen.findByText("Staff licences");
  expect(screen.queryByText("Company")).toBeNull();
});

it("says where the papers are added when there are none", async () => {
  open({ onLoad: async () => ({ company: [], staff: [] }) });
  expect(await screen.findByText("No licences or insurance on file. They're added on the Organisation screen.")).toBeInTheDocument();
  expect(screen.getByText("No staff licences on file. They're added on each person's card.")).toBeInTheDocument();
});
