/* NEW › JOB and the board's New job: the job-new engine in a v2 dialog.
   Who first (a repeat customer comes up as the name is typed), a builder's
   job on a new site with their sites in the Site chooser, an address we've
   been to said with Use this site, the contact, the kind, the job, and how
   they came in, with Existing customer matched to a client already here.
   There is no Next: it just saves, and the job opens on its own page once
   the mirror has read it back. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WindowsContext } from "@/components/records/records-context";

const searchNewJobClients = jest.fn();
const searchClientSites = jest.fn();
const matchPreviousSite = jest.fn();
const readNewJobCategories = jest.fn();
const createNewJob = jest.fn();
jest.mock("@/app/actions/job-new", () => ({
  searchNewJobClients: (...a: unknown[]) => searchNewJobClients(...a),
  searchClientSites: (...a: unknown[]) => searchClientSites(...a),
  matchPreviousSite: (...a: unknown[]) => matchPreviousSite(...a),
  readNewJobCategories: (...a: unknown[]) => readNewJobCategories(...a),
  createNewJob: (...a: unknown[]) => createNewJob(...a),
}));
const openMirrorJob = jest.fn();
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: (...a: unknown[]) => openMirrorJob(...a) }));
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewJobForm } from "../new-job-form";

const BUILDER = { uuid: "c0c0c0c0-0000-4000-8000-0000000000b1", name: "Built By MK", address: "1 Office St", sites: 14, contacts: [{ name: "Jake Breen", mobile: "0400 000 000", phone: null, email: "jake@builtbymk.com.au" }] };
const PERSON = { uuid: "c0c0c0c0-0000-4000-8000-0000000000c1", name: "Tim Scott", address: "702/22 Sir John Young Cres, Woolloomooloo", sites: 0, contacts: [] };
const SITE = { uuid: "5e5e5e5e-0000-4000-8000-000000000001", name: "41 Waverley St, Bondi Junction", address: "41 Waverley St, Bondi Junction", parentName: "Built By MK", lastJob: "2904" };
const JOB = "10b10b10-0000-4000-8000-000000003401";
const IN = { ok: true, rowId: "r1", line: { state: "in", words: "In ServiceM8 as #3401.", number: "3401" }, sm8Url: "https://go.servicem8.com/job/x", jobUuid: JOB };

const toast = jest.fn();
beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
  searchNewJobClients.mockReset().mockResolvedValue([BUILDER, PERSON]);
  searchClientSites.mockReset().mockResolvedValue([SITE]);
  matchPreviousSite.mockReset().mockResolvedValue(null);
  readNewJobCategories.mockReset().mockResolvedValue([{ uuid: "ca7ca7ca-0000-4000-8000-000000000001", name: "Install", colour: "#7bb3ff" }]);
  createNewJob.mockReset().mockResolvedValue(IN);
  openMirrorJob.mockReset().mockResolvedValue({ id: JOB });
  push.mockReset();
  toast.mockReset();
});
afterEach(() => jest.useRealTimers());

const user = () => userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
const draw = (onClose = jest.fn()) => {
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <NewJobForm onClose={onClose} />
    </WindowsContext.Provider>,
  );
  return onClose;
};

async function typeName(name: string) {
  await user().type(screen.getByLabelText("Customer"), name);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
}
async function pickCustomer(name: RegExp) {
  await user().click(await screen.findByRole("button", { name }));
  await act(async () => {
    jest.advanceTimersByTime(10);
  });
}
function choose(field: string, option: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: field }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}
const create = () => screen.getByRole("button", { name: "Create job" });

describe("New job", () => {
  it("opens straight on the form, titled New job, asking who first, with no Next", () => {
    draw();
    expect(screen.getByRole("dialog", { name: "New job" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New job" })).toBeInTheDocument();
    expect(screen.getByLabelText("Customer")).toHaveFocus();
    expect(screen.queryByRole("radiogroup", { name: /next/i })).toBeNull();
    expect(screen.getByText("ServiceM8 may charge for jobs, as it does for jobs started there.")).toBeInTheDocument();
  });

  it("says what's missing on Create, and sends nothing", async () => {
    draw();
    await user().click(create());
    expect(screen.getByText("Say who the customer is.")).toBeInTheDocument();
    expect(screen.getByText("Say where the job is.")).toBeInTheDocument();
    expect(screen.getByText("Say what the job is.")).toBeInTheDocument();
    expect(createNewJob).not.toHaveBeenCalled();
  });

  it("brings up repeat customers as their name is typed, and offers a new one", async () => {
    draw();
    await typeName("Bui");
    expect(await screen.findByRole("button", { name: /Built By MK/ })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /Add “Bui” as a new customer/ }));
    expect(screen.getByText("A new customer.")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
  });

  it("puts a builder's job on a new site by default, with their previous sites to choose", async () => {
    draw();
    await typeName("Built");
    await pickCustomer(/Built By MK/);
    expect(screen.getByText("An existing customer: 14 sites.")).toBeInTheDocument();
    expect(screen.getByLabelText("Site address")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Site" })).toHaveTextContent("A new site");
    expect(searchClientSites).toHaveBeenCalledWith(BUILDER.uuid, "");
    choose("Site", /41 Waverley St/);
    expect(screen.getByText("41 Waverley St, Bondi Junction, last job 2904.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Site address")).toBeNull();
    /* past the sites read, theirs are searched */
    await user().type(screen.getByLabelText("Search their sites"), "Wav");
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(searchClientSites).toHaveBeenLastCalledWith(BUILDER.uuid, "Wav");
  });

  it("says when the address typed is a site we've been to", async () => {
    matchPreviousSite.mockResolvedValue(SITE);
    draw();
    await typeName("Built");
    await pickCustomer(/Built By MK/);
    await user().type(screen.getByLabelText("Site address"), "41 Waverley St");
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    expect(await screen.findByText("Matches a previous site: 41 Waverley St, Bondi Junction, job 2904, Built By MK.")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Use this site" }));
    expect(screen.getByRole("combobox", { name: "Site" })).toHaveTextContent("41 Waverley St, Bondi Junction");
  });

  it("creates the job under a new site, with its contact, kind and how they came in, then opens it on its page", async () => {
    const onClose = draw();
    await typeName("Built");
    await pickCustomer(/Built By MK/);
    await user().type(screen.getByLabelText("Site address"), "9 New Rd, Rose Bay");
    choose("Contact", "Jake Breen");
    expect(screen.getByLabelText("Mobile")).toHaveValue("0400 000 000");
    choose("Kind", "Install");
    await user().type(screen.getByLabelText("The job"), "Two splits upstairs");
    await user().click(screen.getByRole("radio", { name: "Phone" }));
    await user().click(create());
    await waitFor(() => expect(createNewJob).toHaveBeenCalledTimes(1));
    expect(createNewJob.mock.calls[0]![0]).toMatchObject({
      clientName: "Built By MK",
      client: { kind: "site", parentUuid: BUILDER.uuid, address: "9 New Rd, Rose Bay" },
      jobAddress: "9 New Rd, Rose Bay",
      description: "Two splits upstairs",
      categoryUuid: "ca7ca7ca-0000-4000-8000-000000000001",
      contact: { first: "Jake", last: "Breen", mobile: "0400 000 000", email: "jake@builtbymk.com.au" },
      via: "phone",
      next: null,
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}`));
    expect(openMirrorJob).toHaveBeenCalledWith(JOB);
    expect(onClose).toHaveBeenCalled();
    /* a job in ServiceM8 can't be taken back from here: no Undo */
    expect(toast).toHaveBeenCalledWith("Job 3401 added");
  });

  it("waits for the mirror to read the job back before opening it, and says where it is if it doesn't", async () => {
    openMirrorJob.mockResolvedValue(null);
    const onClose = draw();
    await typeName("Tim");
    await pickCustomer(/Tim Scott/);
    await user().type(screen.getByLabelText("The job"), "Service call");
    await user().click(create());
    expect(await screen.findByRole("button", { name: "Opening job 3401" })).toBeDisabled();
    for (let i = 0; i < 13; i++)
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
    expect(await screen.findByText("In ServiceM8 as #3401.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open in ServiceM8" })).toHaveAttribute("href", "https://go.servicem8.com/job/x");
    await user().click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("puts a person's job at their own address, under them, as an existing customer", async () => {
    draw();
    await typeName("Tim");
    await pickCustomer(/Tim Scott/);
    expect(screen.getByLabelText("Address")).toHaveValue(PERSON.address);
    expect(screen.getByRole("radio", { name: "Existing customer" })).toHaveAttribute("aria-checked", "true");
    await user().type(screen.getByLabelText("The job"), "Service call");
    await user().click(create());
    await waitFor(() => expect(createNewJob).toHaveBeenCalled());
    expect(createNewJob.mock.calls[0]![0]).toMatchObject({ client: { kind: "existing", uuid: PERSON.uuid }, contact: null, via: "an existing customer", next: null });
  });

  it("an Existing customer is matched to a client already here, not a new one", async () => {
    draw();
    await typeName("Rob");
    await user().click(await screen.findByRole("button", { name: /Add “Rob” as a new customer/ }));
    await user().click(screen.getByRole("radio", { name: "Existing customer" }));
    await user().type(screen.getByLabelText("Address"), "3 Ocean St, Narrabeen");
    await user().type(screen.getByLabelText("The job"), "Split in the study");
    await user().click(create());
    expect(screen.getByText("An existing customer is one already here. Find them by name.")).toBeInTheDocument();
    expect(createNewJob).not.toHaveBeenCalled();
    /* pressed again it is none, and the job goes as a new customer's */
    await user().click(screen.getByRole("radio", { name: "Existing customer" }));
    await user().click(create());
    await waitFor(() => expect(createNewJob).toHaveBeenCalled());
    expect(createNewJob.mock.calls[0]![0]).toMatchObject({ client: { kind: "new", name: "Rob" }, via: null });
  });

  it("says why when ServiceM8 can't take it, and keeps the form", async () => {
    createNewJob.mockResolvedValue({ ok: false, error: "Sending new jobs to ServiceM8 is switched off." });
    draw();
    await typeName("Tim");
    await pickCustomer(/Tim Scott/);
    await user().type(screen.getByLabelText("The job"), "Service call");
    await user().click(create());
    expect(await screen.findByText("Sending new jobs to ServiceM8 is switched off.")).toBeInTheDocument();
    expect(screen.getByLabelText("The job")).toHaveValue("Service call");
    expect(push).not.toHaveBeenCalled();
  });

  it("a job still on its way says so, and Create job asks again with the same press", async () => {
    createNewJob.mockResolvedValueOnce({ ...IN, line: { state: "waiting", words: "Waiting to go to ServiceM8.", number: null }, sm8Url: null });
    draw();
    await typeName("Tim");
    await pickCustomer(/Tim Scott/);
    await user().type(screen.getByLabelText("The job"), "Service call");
    await user().click(create());
    expect(await screen.findByText("Waiting to go to ServiceM8.")).toBeInTheDocument();
    await user().click(create());
    await waitFor(() => expect(createNewJob).toHaveBeenCalledTimes(2));
    expect(createNewJob.mock.calls[1]![0].pressId).toBe(createNewJob.mock.calls[0]![0].pressId);
  });
});
