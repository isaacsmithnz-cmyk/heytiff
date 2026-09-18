/* The SWMS wizard on the job card, walked as the person on site uses it:
   what the job already says is filled in, a typed helper is on it, each
   problem takes you to its answer, and nothing issues until the site has
   been walked. */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SwmsPrevious, SwmsWizardContext } from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
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
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));

import { SwmsWizard } from "../swms-wizard";

const context = (over: Partial<SwmsWizardContext> = {}): SwmsWizardContext => ({
  job: {
    uuid: "job-1",
    number: "2601",
    clientName: "M. and J. Rowe",
    address: "14 Attunga Road, Miranda NSW 2228",
    description: "Supply and install a 5.0 kW split system",
    state: "NSW",
    jurisdiction: "NSW",
    postcode: "2228",
    categoryName: "Install",
  },
  team: [
    { id: "troy", name: "Troy Porter", role: "Crew lead", booked: true, tickets: [{ name: "White Card", expires: null, current: true }] },
    { id: "dane", name: "Dane Whitmore", role: "", booked: true, tickets: [] },
    { id: "sam", name: "Sam Ikpeba", role: "Electrician", booked: false, tickets: [] },
  ],
  libraryVersion: "hvac-2026.09",
  libraryApproved: true,
  canApprove: false,
  ownerName: "Isaac Smith",
  viewerStaffId: "troy",
  hospital: null,
  ...over,
});

const onClose = jest.fn();
const onIssued = jest.fn();
const onSignOn = jest.fn();
const onOpen = jest.fn();
const open = (revise: string | null = null) =>
  render(<SwmsWizard jobUuid="job-1" reviseVersionId={revise} onClose={onClose} onIssued={onIssued} onSignOn={onSignOn} onOpen={onOpen} />);
const tab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));
const panel = (key: string) => within(document.getElementById(`swzsec-${key}`) as HTMLElement);
const ready = () => screen.findByRole("tab", { name: "The work" });

/** Fill in what a plain install with power needs, on the screens that ask it. */
async function fillInstall() {
  await tab("How it's done");
  await userEvent.type(screen.getByLabelText("Isolation point"), "Main switchboard, garage wall");
  await userEvent.selectOptions(screen.getByLabelText("Electrician connecting it"), "staff:sam");
  await tab("Who it covers");
  await userEvent.type(screen.getByLabelText("Nearest hospital"), "Sutherland Hospital");
}

beforeEach(() => {
  jest.clearAllMocks();
  swmsWizardContext.mockImplementation(async () => context());
  swmsPrevious.mockImplementation(async () => null);
});

describe("what the job already says", () => {
  it("fills in install from the job's category and the state from the address, and claims no work", async () => {
    open();
    await ready();
    expect(screen.getByRole("heading", { name: "Safe Work Method Statement" })).toBeInTheDocument();
    expect(screen.getByText("14 Attunga Road, Miranda NSW 2228")).toBeInTheDocument();
    expect(screen.getByText("From the job's category, Install")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install or replace", pressed: true })).toBeInTheDocument();
    /* the address names the state, so it's stated, not asked */
    expect(screen.getByText("From the site address")).toBeInTheDocument();
    expect(panel("work").getByText("New South Wales")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "State" })).toBeNull();
    /* no high-risk categories on the first screen — they come from steps not yet ticked */
    expect(panel("work").queryByText(/Falling more than 2 m/)).toBeNull();
    /* the tabs say which screen this is; the footer doesn't say it again */
    expect(screen.queryByText(/Step \d of 4/)).toBeNull();
  });

  it("asks the state only when the address doesn't say", async () => {
    swmsWizardContext.mockImplementation(async () => context({ job: { ...context().job, address: "14 Attunga Road, Miranda", state: null, jurisdiction: null } }));
    open();
    await ready();
    expect(screen.getByText("The address doesn't say")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("group", { name: "State" })).getByRole("button", { name: "QLD" }));
    await tab("Review");
    expect(panel("review").getByText("Queensland")).toBeInTheDocument();
  });

  /* a Victorian site was read as "the address doesn't say" and written to NSW rules */
  it("names a state the template doesn't cover, and offers nothing but Close", async () => {
    swmsWizardContext.mockImplementation(async () => context({ job: { ...context().job, address: "8 Lygon Street, Brunswick VIC 3056", state: "VIC", jurisdiction: null } }));
    open();
    expect(
      await screen.findByText("This job is in Victoria. The SWMS template is written to New South Wales and Queensland rules, so it can't write one for this site.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  /* the nearest hospital was typed from scratch on every SWMS */
  it("starts with the hospital the last SWMS in the same postcode named, and says where it came from", async () => {
    swmsWizardContext.mockImplementation(async () => context({ hospital: { name: "Sutherland Hospital, Caringbah", jobNumber: "2598" } }));
    open();
    await ready();
    await tab("Who it covers");
    expect(screen.getByLabelText("Nearest hospital")).toHaveValue("Sutherland Hospital, Caringbah");
    expect(screen.getByText("From job #2598, in the same postcode")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Nearest hospital"));
    await userEvent.type(screen.getByLabelText("Nearest hospital"), "St George Hospital");
    expect(screen.queryByText("From job #2598, in the same postcode")).toBeNull();
  });

  /* the first aider started "Not named" though staff records said who holds first aid */
  it("names the first aider the staff records show, until someone picks one", async () => {
    swmsWizardContext.mockImplementation(async () =>
      context({
        team: [
          { id: "troy", name: "Troy Porter", role: "Crew lead", booked: true, tickets: [{ name: "White Card", expires: null, current: true }] },
          { id: "dane", name: "Dane Whitmore", role: "", booked: true, tickets: [{ name: "HLTAID011 Provide First Aid", expires: "2027-01-01", current: true }] },
          { id: "sam", name: "Sam Ikpeba", role: "Electrician", booked: false, tickets: [{ name: "First aid", expires: "2020-01-01", current: false }] },
        ],
      })
    );
    open();
    await ready();
    await tab("Who it covers");
    expect((screen.getByLabelText("First aider") as HTMLSelectElement).value).toBe("staff:dane");
    expect(screen.getByText("Has first aid on file")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("First aider"), "");
    expect((screen.getByLabelText("First aider") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByText("Has first aid on file")).toBeNull();
  });

  it("starts an install with the steps every install has, and the site's steps unticked", async () => {
    open();
    await ready();
    await tab("How it's done");
    const ticked = (name: RegExp) => (panel("how").getByRole("checkbox", { name }) as HTMLInputElement).checked;
    expect(ticked(/Get onto the roof/)).toBe(false);
    expect(ticked(/Lift the outdoor unit/)).toBe(false);
    expect(ticked(/Core drill/)).toBe(false);
    expect(ticked(/ceiling space/)).toBe(false);
    expect(ticked(/Braze/)).toBe(true);
    expect(ticked(/Connect power/)).toBe(true);
  });

  it("offers a service only the steps that hold for it, and says when it needs a SWMS at all", async () => {
    open();
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Service or repair" }));
    expect(screen.getByText(/needs a SWMS only for high-risk work/)).toBeInTheDocument();
    await tab("How it's done");
    expect(panel("how").queryByRole("checkbox", { name: /Lift the outdoor unit/ })).toBeNull();
    expect(panel("how").queryByRole("checkbox", { name: /Connect power/ })).toBeNull();
    expect(panel("how").getByRole("checkbox", { name: /Get onto the roof/ })).not.toBeChecked();
  });
});

describe("who it covers", () => {
  it("puts a typed helper on the SWMS without an Add button to forget", async () => {
    open();
    await ready();
    await fillInstall();
    await userEvent.type(screen.getByLabelText("Their name"), "Kai Lindqvist");
    await tab("Review");
    expect(screen.getByText("4 people")).toBeInTheDocument();
    expect(screen.getByText("Troy Porter, Dane Whitmore, Sam Ikpeba, Kai Lindqvist")).toBeInTheDocument();
    /* one person, one row, and a blank one below for the next */
    expect(screen.getByLabelText("Name 1")).toHaveValue("Kai Lindqvist");
    expect(screen.getByLabelText("Their name")).toHaveValue("");
  });

  it("covers the electrician by choosing them, and takes one from outside the business by name", async () => {
    open();
    await ready();
    await tab("How it's done");
    await userEvent.selectOptions(screen.getByLabelText("Electrician connecting it"), "staff:sam");
    await tab("Who it covers");
    expect(screen.getByRole("checkbox", { name: /Sam Ikpeba/ })).toBeChecked();

    await tab("How it's done");
    await userEvent.selectOptions(screen.getByLabelText("Electrician connecting it"), "new");
    await userEvent.type(screen.getByLabelText("Electrician's name"), "Ali Sparks");
    await tab("Who it covers");
    expect(panel("who").getByDisplayValue("Ali Sparks")).toBeInTheDocument();
  });
});

describe("the review", () => {
  it("lists the high-risk work in plain words, and a category can be added by hand", async () => {
    open();
    await ready();
    await tab("How it's done");
    await userEvent.click(screen.getByRole("checkbox", { name: /ceiling space/ }));
    await tab("Review");
    expect(panel("review").getByText("Extreme heat or cold, like a roof space")).toBeInTheDocument();
    expect(panel("review").getByText("Inside an enclosed roof cavity")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add another category" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "In or near a confined space" }));
    expect(panel("review").getByText("Ticked on site")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear In or near a confined space" }));
    expect(panel("review").queryByText("Ticked on site")).toBeNull();
  });

  it("takes you from a problem to the field that answers it", async () => {
    open();
    await ready();
    await tab("Review");
    await userEvent.click(screen.getByRole("button", { name: "Name the isolation point." }));
    expect(screen.getByRole("tab", { name: "How it's done", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Isolation point")));
  });

  it("issues only once every rule is met and the site is walked, then hands on to sign-on", async () => {
    const bell = jest.fn();
    window.addEventListener(BELL_REFRESH_EVENT, bell);
    open();
    await ready();
    await fillInstall();
    await userEvent.type(screen.getByLabelText("Their name"), "Kai Lindqvist");
    await tab("Review");
    const issue = screen.getByRole("button", { name: "Issue the SWMS" });
    expect(issue).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /walked this site/ }));
    expect(issue).toBeEnabled();

    await userEvent.click(issue);
    expect(issueSwms).toHaveBeenCalledWith(
      expect.objectContaining({
        jobUuid: "job-1",
        swmsId: null,
        material: true,
        staffIds: ["troy", "dane", "sam"],
        outsiders: [{ name: "Kai Lindqvist", company: null }],
        responsibleStaffId: "troy",
        electrician: "staff:sam",
        siteChecked: true,
        answers: expect.objectContaining({ isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital", kind: "install" }),
      })
    );
    expect(await screen.findByRole("heading", { name: "The SWMS is on the job" })).toBeInTheDocument();
    expect(screen.getByText("Dane Whitmore, Sam Ikpeba")).toBeInTheDocument();
    expect(screen.getByText("Signing on here")).toBeInTheDocument();
    expect(bell).toHaveBeenCalled();
    expect(onIssued).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Open the SWMS" }));
    expect(onOpen).toHaveBeenCalledWith("v-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign on now" }));
    expect(onSignOn).toHaveBeenCalledWith("v-1");
    window.removeEventListener(BELL_REFRESH_EVENT, bell);
  });

  it("sends the helper chosen as electrician by their place among the helpers", async () => {
    open();
    await ready();
    await tab("How it's done");
    await userEvent.type(screen.getByLabelText("Isolation point"), "Main board");
    await userEvent.selectOptions(screen.getByLabelText("Electrician connecting it"), "new");
    await userEvent.type(screen.getByLabelText("Electrician's name"), "Ali Sparks");
    await tab("Who it covers");
    await userEvent.type(screen.getByLabelText("Nearest hospital"), "Sutherland Hospital");
    await tab("Review");
    await userEvent.click(screen.getByRole("checkbox", { name: /walked this site/ }));
    await userEvent.click(screen.getByRole("button", { name: "Issue the SWMS" }));
    expect(issueSwms).toHaveBeenCalledWith(expect.objectContaining({ outsiders: [{ name: "Ali Sparks", company: null }], electrician: "outside:0" }));
  });
});

describe("the template", () => {
  it("lets an owner read and approve it, then carries on", async () => {
    swmsWizardContext.mockImplementation(async () => context({ libraryApproved: false, canApprove: true }));
    open();
    expect(await screen.findByRole("heading", { name: "Approve the SWMS template" })).toBeInTheDocument();
    expect(screen.getByText("Get onto the roof and set fall protection")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve the template" }));
    expect(approveSwmsLibrary).toHaveBeenCalled();
    expect(await screen.findByRole("tab", { name: "The work" })).toBeInTheDocument();
  });

  it("names the owner to anyone else, and offers nothing to press but Close", async () => {
    swmsWizardContext.mockImplementation(async () => context({ libraryApproved: false, canApprove: false }));
    open();
    expect(await screen.findByText("Isaac Smith approves it before the first SWMS can be issued, and it's waiting in their bell.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve the template" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("a revision", () => {
  beforeEach(() => {
    swmsPrevious.mockImplementation(async () => ({
      swmsId: "s-1",
      version: 1,
      answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard", hospital: "Sutherland Hospital" },
      staffIds: ["troy", "sam"],
      outsiders: [{ name: "Kai Lindqvist", company: "Lindqvist Plumbing" }],
      responsibleStaffId: "troy",
      electricianName: "Sam Ikpeba",
      firstAiderName: "Troy Porter",
      signedStaffIds: ["troy"],
      signedOutsideNames: ["kai lindqvist"],
    }));
  });

  it("starts from the latest version, with who it named, and needs a reason", async () => {
    open("v-1");
    expect(await screen.findByRole("heading", { name: "Revise the SWMS" })).toBeInTheDocument();
    await tab("Who it covers");
    expect(screen.getByRole("checkbox", { name: /Dane Whitmore/ })).not.toBeChecked();
    expect(screen.getByDisplayValue("Lindqvist Plumbing")).toBeInTheDocument();
    expect((screen.getByLabelText("First aider") as HTMLSelectElement).value).toBe("staff:troy");
    await tab("How it's done");
    expect((screen.getByLabelText("Electrician connecting it") as HTMLSelectElement).value).toBe("staff:sam");
    await tab("Review");
    expect(screen.getByRole("button", { name: "Say what changed and why." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue version 2" })).toBeDisabled();
  });

  /* a correction from the office had to tick "I've walked this site" */
  it("issues a correction on the site walk it corrects, carrying the sign-ons", async () => {
    open("v-1");
    await screen.findByRole("heading", { name: "Revise the SWMS" });
    await tab("Review");
    await userEvent.type(screen.getByLabelText("What changed"), "Hospital name was wrong");
    expect(screen.getByRole("checkbox", { name: /walked this site/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /It's a correction/ }));
    expect(screen.getByText("Sign-ons and the site walk carry over")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /walked this site/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Issue version 2" }));
    expect(issueSwms).toHaveBeenCalledWith(expect.objectContaining({ swmsId: "s-1", reason: "Hospital name was wrong", material: false, electrician: "staff:sam" }));
  });

  it("won't offer a correction once how the work is done has changed", async () => {
    open("v-1");
    await screen.findByRole("heading", { name: "Revise the SWMS" });
    await tab("Review");
    await userEvent.click(screen.getByRole("radio", { name: /It's a correction/ }));
    await tab("How it's done");
    await userEvent.click(screen.getByRole("radio", { name: "Scaffold with a stair" }));
    await tab("Review");
    const correction = screen.getByRole("radio", { name: /It's a correction/ });
    expect(correction).toBeDisabled();
    expect(correction).not.toBeChecked();
    expect(screen.getByText("Fall protection changed, so everyone signs on again")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /walked this site/ })).toBeInTheDocument();
  });

  /* a correction that added someone offered no way to sign them on */
  it("asks, after a correction, everyone it didn't carry a sign-on for", async () => {
    issueSwms.mockImplementationOnce(async () => ({ ok: true as const, swmsId: "s-1", versionId: "v-2", version: 2 }));
    open("v-1");
    await screen.findByRole("heading", { name: "Revise the SWMS" });
    await tab("Who it covers");
    await userEvent.click(screen.getByRole("checkbox", { name: /Dane Whitmore/ }));
    await userEvent.type(screen.getByLabelText("Their name"), "Ali Sparks");
    await tab("Review");
    await userEvent.type(screen.getByLabelText("What changed"), "Added Dane and Ali");
    await userEvent.click(screen.getByRole("radio", { name: /It's a correction/ }));
    await userEvent.click(screen.getByRole("button", { name: "Issue version 2" }));

    expect(await screen.findByText("Filed under Documents, Compliance. Anyone who signed on before stays signed on.")).toBeInTheDocument();
    /* Troy and Kai signed version 1; Sam hadn't, and Dane and Ali are new */
    expect(screen.getByText("Dane Whitmore, Sam Ikpeba")).toBeInTheDocument();
    expect(screen.getByText("Ali Sparks")).toBeInTheDocument();
    expect(screen.queryByText("Kai Lindqvist")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign on now" }));
    expect(onSignOn).toHaveBeenCalledWith("v-2");
  });
});

it("asks before a stray Escape throws the choices away", async () => {
  open();
  await ready();
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
