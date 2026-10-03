import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import { NewJobModal } from "../new-job-modal";

const BUILDER = { uuid: "c0c0c0c0-0000-4000-8000-0000000000b1", name: "Built By MK", address: "1 Office St", sites: 14, contacts: [{ name: "Jake Breen", mobile: "0400 000 000", phone: null, email: "jake@builtbymk.com.au" }] };
const PERSON = { uuid: "c0c0c0c0-0000-4000-8000-0000000000c1", name: "Tim Scott", address: "702/22 Sir John Young Cres, Woolloomooloo", sites: 0, contacts: [] };
const SITE = { uuid: "5e5e5e5e-0000-4000-8000-000000000001", name: "41 Waverley St, Bondi Junction", address: "41 Waverley St, Bondi Junction", parentName: "Built By MK", lastJob: "2904" };

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
  searchNewJobClients.mockReset().mockResolvedValue([BUILDER, PERSON]);
  searchClientSites.mockReset().mockResolvedValue([SITE]);
  matchPreviousSite.mockReset().mockResolvedValue(null);
  readNewJobCategories.mockReset().mockResolvedValue([{ uuid: "ca7ca7ca-0000-4000-8000-000000000001", name: "Install", colour: "#7bb3ff" }]);
  createNewJob.mockReset().mockResolvedValue({ ok: true, rowId: "r1", line: { state: "in", words: "In ServiceM8 as #3401.", number: "3401" }, sm8Url: "https://go.servicem8.com/job/x" });
});
afterEach(() => jest.useRealTimers());

const user = () => userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

async function typeName(name: string) {
  await user().type(screen.getByLabelText("Customer"), name);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
}

describe("New job", () => {
  it("opens straight on the form, titled New job, asking who first", () => {
    render(<NewJobModal onClose={jest.fn()} />);
    expect(screen.getByRole("dialog", { name: "New job" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New job" })).toBeInTheDocument();
    expect(screen.getByLabelText("Customer")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Create job" })).toBeDisabled();
  });

  it("brings up repeat customers as their name is typed, and offers a new one", async () => {
    render(<NewJobModal onClose={jest.fn()} />);
    await typeName("Bui");
    expect(await screen.findByRole("option", { name: /Built By MK/ })).toBeInTheDocument();
    await user().click(screen.getByRole("option", { name: /Add “Bui” as a new customer/ }));
    expect(screen.getByText("New customer")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
  });

  it("puts a builder's job on a new site by default, with their previous sites searchable", async () => {
    render(<NewJobModal onClose={jest.fn()} />);
    await typeName("Built");
    await user().click(await screen.findByRole("option", { name: /Built By MK/ }));
    expect(screen.getByLabelText("Site address")).toHaveValue("");
    await user().click(screen.getByRole("button", { name: "Previous sites" }));
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await user().click(await screen.findByRole("option", { name: /41 Waverley St/ }));
    expect(screen.getByText("#2904")).toBeInTheDocument();
    expect(searchClientSites).toHaveBeenCalledWith(BUILDER.uuid, "");
  });

  it("says when the address typed is a site we've been to", async () => {
    matchPreviousSite.mockResolvedValue(SITE);
    render(<NewJobModal onClose={jest.fn()} />);
    await typeName("Built");
    await user().click(await screen.findByRole("option", { name: /Built By MK/ }));
    await user().type(screen.getByLabelText("Site address"), "41 Waverley St");
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    expect(await screen.findByText(/Matches a previous site/)).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Use this site" }));
    expect(screen.getByText("#2904")).toBeInTheDocument();
  });

  it("creates the job under a new site, with how they came in and what's next, and says its number", async () => {
    const onClose = jest.fn();
    render(<NewJobModal onClose={onClose} />);
    await typeName("Built");
    await user().click(await screen.findByRole("option", { name: /Built By MK/ }));
    await user().type(screen.getByLabelText("Site address"), "9 New Rd, Rose Bay");
    await user().click(screen.getByRole("button", { name: "Jake Breen" }));
    await user().click(screen.getByRole("radio", { name: /Install/ }));
    await user().type(screen.getByLabelText("The job"), "Two splits upstairs");
    await user().click(screen.getByRole("radio", { name: "Phone" }));
    await user().click(screen.getByRole("radio", { name: "Book a site visit" }));
    await user().click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(createNewJob).toHaveBeenCalledTimes(1));
    expect(createNewJob.mock.calls[0]![0]).toMatchObject({
      clientName: "Built By MK",
      client: { kind: "site", parentUuid: BUILDER.uuid, address: "9 New Rd, Rose Bay" },
      jobAddress: "9 New Rd, Rose Bay",
      description: "Two splits upstairs",
      categoryUuid: "ca7ca7ca-0000-4000-8000-000000000001",
      contact: { first: "Jake", last: "Breen", mobile: "0400 000 000", email: "jake@builtbymk.com.au" },
      via: "phone",
      next: "book a site visit",
    });
    expect(await screen.findByText("In ServiceM8 as #3401.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in ServiceM8" })).toHaveAttribute("href", "https://go.servicem8.com/job/x");
    await user().click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("puts a person's job at their own address, under them", async () => {
    render(<NewJobModal onClose={jest.fn()} />);
    await typeName("Tim");
    await user().click(await screen.findByRole("option", { name: /Tim Scott/ }));
    expect(screen.getByLabelText("Address")).toHaveValue(PERSON.address);
    await user().type(screen.getByLabelText("The job"), "Service call");
    await user().click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(createNewJob).toHaveBeenCalled());
    expect(createNewJob.mock.calls[0]![0]).toMatchObject({ client: { kind: "existing", uuid: PERSON.uuid }, contact: null, via: null, next: null });
  });

  it("says why when ServiceM8 can't take it, and keeps the form", async () => {
    createNewJob.mockResolvedValue({ ok: false, error: "Sending new jobs to ServiceM8 is switched off." });
    render(<NewJobModal onClose={jest.fn()} />);
    await typeName("Tim");
    await user().click(await screen.findByRole("option", { name: /Tim Scott/ }));
    await user().type(screen.getByLabelText("The job"), "Service call");
    await user().click(screen.getByRole("button", { name: "Create job" }));
    expect(await screen.findByText("Sending new jobs to ServiceM8 is switched off.")).toBeInTheDocument();
    expect(screen.getByLabelText("The job")).toHaveValue("Service call");
  });
});
