/* The SWMS wizard on the job card: simple entry, and nothing issued until
   the library's own rules are met and the site has been walked. */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SwmsPrevious, SwmsWizardContext } from "@/app/actions/swms";
import { DEFAULT_ANSWERS } from "@/lib/swms/library";

const swmsWizardContext = jest.fn(async (): Promise<SwmsWizardContext | null> => null);
const swmsPrevious = jest.fn(async (): Promise<SwmsPrevious | null> => null);
const approveSwmsLibrary = jest.fn(async () => ({ ok: true as const }));
const issueSwms = jest.fn(async (..._: unknown[]) => ({ ok: true as const, swmsId: "s-1", versionId: "v-1", version: 1 }));
jest.mock("@/app/actions/swms", () => ({
  swmsWizardContext: (...a: unknown[]) => swmsWizardContext(...(a as [])),
  swmsPrevious: (...a: unknown[]) => swmsPrevious(...(a as [])),
  approveSwmsLibrary: () => approveSwmsLibrary(),
  issueSwms: (...a: unknown[]) => issueSwms(...a),
}));

import { SwmsWizard } from "../swms-wizard";

const context = (over: Partial<SwmsWizardContext> = {}): SwmsWizardContext => ({
  job: {
    uuid: "job-1",
    number: "2601",
    clientName: "M. and J. Rowe",
    address: "14 Attunga Road, Miranda NSW 2228",
    description: "Supply and install a 5.0 kW split system",
    jurisdiction: "NSW",
  },
  team: [
    { id: "troy", name: "Troy Porter", role: "Crew lead", booked: true, tickets: [{ name: "White Card", expires: null, current: true }] },
    { id: "dane", name: "Dane Whitmore", role: "", booked: true, tickets: [] },
    { id: "sam", name: "Sam Ikpeba", role: "Electrician", booked: false, tickets: [] },
  ],
  libraryVersion: "hvac-2026.09",
  libraryApproved: true,
  canApprove: false,
  viewerStaffId: "troy",
  ...over,
});

const onClose = jest.fn();
const onIssued = jest.fn();
const open = (revise: string | null = null) =>
  render(<SwmsWizard jobUuid="job-1" reviseVersionId={revise} onClose={onClose} onIssued={onIssued} />);
const tab = (name: string) => userEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  jest.clearAllMocks();
  swmsWizardContext.mockImplementation(async () => context());
  swmsPrevious.mockImplementation(async () => null);
});

it("opens on the job, with what the answers switch on", async () => {
  open();
  expect(await screen.findByText("Job #2601, 14 Attunga Road, Miranda NSW 2228")).toBeInTheDocument();
  expect(screen.getByText("Supply and install a 5.0 kW split system")).toBeInTheDocument();
  expect(screen.getByText("4 of 18 apply")).toBeInTheDocument();
  expect(screen.getByText("Work on the roof, where a fall would be more than 2 m")).toBeInTheDocument();
  expect(swmsWizardContext).toHaveBeenCalledWith("job-1");
});

it("ticks who's booked, and issues only once every rule is met and the site is walked", async () => {
  open();
  await screen.findByText("4 of 18 apply");

  await tab("How it's done");
  await userEvent.type(screen.getByRole("textbox", { name: "Isolation point" }), "Main switchboard, garage wall");

  await tab("Who it covers");
  expect(screen.getByRole("checkbox", { name: /Troy Porter/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Dane Whitmore/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Sam Ikpeba/ })).not.toBeChecked();
  expect(screen.getByText("No tickets on file")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /Sam Ikpeba/ }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Electrician connecting power" }), "staff:sam");
  await userEvent.type(screen.getByRole("textbox", { name: "Nearest hospital" }), "Sutherland Hospital");
  await userEvent.type(screen.getByRole("textbox", { name: "Their name" }), "Kai Lindqvist");
  await userEvent.click(screen.getByRole("button", { name: "Add them" }));
  expect(screen.getByText("Kai Lindqvist", { selector: "b" })).toBeInTheDocument();

  await tab("Review");
  const issue = screen.getByRole("button", { name: "Issue version 1" });
  expect(issue).toBeDisabled();
  expect(screen.queryByRole("list")).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: /walked this site/ }));
  expect(issue).toBeEnabled();

  await userEvent.click(issue);
  expect(issueSwms).toHaveBeenCalledWith(
    expect.objectContaining({
      jobUuid: "job-1",
      swmsId: null,
      staffIds: ["troy", "dane", "sam"],
      outsiders: [{ name: "Kai Lindqvist", company: null }],
      responsibleStaffId: "troy",
      electrician: "staff:sam",
      siteChecked: true,
      answers: expect.objectContaining({ isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital", jurisdiction: "NSW" }),
    })
  );
  expect(await screen.findByText("The SWMS is on the job")).toBeInTheDocument();
  // the issuer signs from their own bell; the others are asked in theirs
  expect(screen.getByText("Sign on from your bell")).toBeInTheDocument();
  expect(screen.getAllByText("Asked in their bell")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "Open the SWMS" })).toHaveAttribute("href", "/swms/v-1");
  expect(onIssued).toHaveBeenCalled();
});

it("says in words what still stands in the way", async () => {
  open();
  await screen.findByText("4 of 18 apply");
  await tab("Review");
  await userEvent.click(screen.getByRole("checkbox", { name: /walked this site/ }));
  const problems = within(screen.getByRole("list"));
  expect(problems.getByText("Name the isolation point.")).toBeInTheDocument();
  expect(problems.getByText("Choose the electrician doing the connection.")).toBeInTheDocument();
  expect(problems.getByText("Name the nearest hospital.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Issue version 1" })).toBeDisabled();
});

it("adds the risk score appendix when it's ticked", async () => {
  open();
  await screen.findByText("4 of 18 apply");
  await tab("Review");
  await userEvent.click(screen.getByRole("checkbox", { name: /risk score appendix/ }));
  await tab("How it's done");
  await tab("Review");
  expect(screen.getByRole("checkbox", { name: /risk score appendix/ })).toBeChecked();
});

it("asks an owner to adopt the library before the first one", async () => {
  swmsWizardContext.mockImplementation(async () => context({ libraryApproved: false, canApprove: true }));
  open();
  expect(await screen.findByText("Adopt the SWMS library")).toBeInTheDocument();
  expect(screen.getByText("Get onto the roof and set fall protection")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Adopt the library" }));
  expect(approveSwmsLibrary).toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "The work" })).toBeInTheDocument();
});

it("tells anyone else the owner adopts it, and offers nothing to press", async () => {
  swmsWizardContext.mockImplementation(async () => context({ libraryApproved: false, canApprove: false }));
  open();
  expect(await screen.findByText("The owner adopts the library before the first SWMS can be issued from it.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adopt the library" })).toBeNull();
});

it("starts a revision from the latest version, and needs a reason", async () => {
  swmsPrevious.mockImplementation(async () => ({
    swmsId: "s-1",
    version: 1,
    answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard", hospital: "Sutherland Hospital" },
    staffIds: ["troy", "sam"],
    outsiders: [{ name: "Kai Lindqvist", company: "Lindqvist Plumbing" }],
    responsibleStaffId: "troy",
  }));
  open("v-1");
  expect(await screen.findByRole("heading", { name: "Revise the Safe Work Method Statement" })).toBeInTheDocument();
  await tab("Who it covers");
  expect(screen.getByRole("checkbox", { name: /Dane Whitmore/ })).not.toBeChecked();
  expect(screen.getByText("Lindqvist Plumbing")).toBeInTheDocument();
  await tab("Review");
  expect(screen.getByText("Say what changed and why.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Issue version 2" })).toBeDisabled();
});

it("asks before a stray Escape throws the choices away", async () => {
  open();
  await screen.findByText("4 of 18 apply");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);

  onClose.mockClear();
  await userEvent.click(within(screen.getByRole("group", { name: "Traffic" })).getByRole("button", { name: "Yes" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText("Discard this SWMS?")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByText("Discard this SWMS?")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Close the SWMS" }));
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
