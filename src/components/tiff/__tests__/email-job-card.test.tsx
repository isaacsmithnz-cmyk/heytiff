/* The job Tiff proposes from a forwarded email, in the Inbox (28 October 2026;
   30 October: the decision at the top, Add to job, not File): what she read,
   made only on Create job, put away by Not a job, or made from the New job form
   filled in. */
import { act, fireEvent, render, screen } from "@testing-library/react";

const readEmailJob = jest.fn();
const createJobFromEmail = jest.fn();
const emailJobMade = jest.fn();
const notAJob = jest.fn();
const fileEmailOnJob = jest.fn();
jest.mock("@/app/actions/email-in-job", () => ({
  fileEmailOnJob: (...a: unknown[]) => fileEmailOnJob(...a),
  readEmailJob: (...a: unknown[]) => readEmailJob(...a),
  createJobFromEmail: (...a: unknown[]) => createJobFromEmail(...a),
  emailJobMade: (...a: unknown[]) => emailJobMade(...a),
  notAJob: (...a: unknown[]) => notAJob(...a),
}));
let formProps: Record<string, unknown> | null = null;
jest.mock("@/components/making/new-job-form", () => ({
  NewJobForm: (p: Record<string, unknown>) => {
    formProps = p;
    return <div role="dialog" aria-label="New job form" />;
  },
}));

import { EmailJobActions, EmailJobFacts, useEmailJob } from "../email-job-card";

function EmailJobCard({ id }: { id: string }) {
  const job = useEmailJob(id);
  return (
    <>
      <EmailJobActions job={job} />
      <EmailJobFacts job={job} />
    </>
  );
}

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const view = (over: Record<string, unknown> = {}) => ({
  id: ID,
  state: "read",
  proposal: {
    isJob: true,
    aboutJob: false,
    jobNumbers: [],
    notJobWhy: "",
    summary: "",
    client: "Truecut Building",
    contact: { first: "Matt", last: "Glass", mobile: "0412 345 678", phone: "", email: "matt@truecut.example" },
    site: "40 Westbourne Street, Stanmore NSW 2048",
    due: "2026-11-07",
    scope: ["Modify the existing underfloor AC", "Extend it to the attic"],
    excluded: ["The secondary dwelling"],
    clientMatch: { uuid: "c1", name: "Truecut Building", builder: true },
    siteMatch: null,
  },
  files: [{ name: "A-101 Architectural.pdf", size: 16_000_000 }],
  links: [],
  subject: "Fwd: Attic extension",
  body: "Please quote.",
  why: "Not kept: Schedule.xlsx",
  jobUuid: null,
  jobNumber: null,
  fromName: "Isaac Smith",
  receivedAt: "2026-10-29T22:12:00Z",
  ...over,
});

const draw = async () => {
  await act(async () => {
    render(<EmailJobCard id={ID} />);
  });
};

beforeEach(() => {
  for (const f of [readEmailJob, createJobFromEmail, emailJobMade, notAJob, fileEmailOnJob]) f.mockReset();
  formProps = null;
  readEmailJob.mockResolvedValue(view());
});

it("shows what Tiff read: the client already here, a new site for them, the scope, the files and what wasn't kept", async () => {
  await draw();
  expect(screen.getByRole("heading", { name: "New job" })).toBeInTheDocument();
  expect(screen.getByText(/already a client/)).toBeInTheDocument();
  expect(screen.getByText(/a new site for them/)).toBeInTheDocument();
  expect(screen.getByText("Matt Glass, 0412 345 678, matt@truecut.example")).toBeInTheDocument();
  expect(screen.getByText("Saturday 7 November")).toBeInTheDocument();
  expect(screen.getByText("Extend it to the attic")).toBeInTheDocument();
  expect(screen.getByText("The secondary dwelling")).toBeInTheDocument();
  expect(screen.getByText("A-101 Architectural.pdf, to the job's Documents")).toBeInTheDocument();
  expect(screen.getByText("Schedule.xlsx")).toBeInTheDocument();
  expect(screen.queryByText("Link")).toBeNull();
});

/* "She could at least bring the link for you to click on straight from the
   job card" (29 October 2026) */
it("brings the tender folder the email pointed to, to open in a new tab, and says it goes to the job's Documents", async () => {
  const url = "https://watershedmanly-my.sharepoint.com/:f:/g/personal/x/abc?e=1";
  readEmailJob.mockResolvedValue(view({ files: [], why: null, links: [{ url, name: "260917 Tender Issue", what: "OneDrive folder" }] }));
  await draw();
  expect(screen.getByText("Link")).toBeInTheDocument();
  const a = screen.getByRole("link", { name: "260917 Tender Issue" });
  expect(a).toHaveAttribute("href", url);
  expect(a).toHaveAttribute("target", "_blank");
  expect(a).toHaveAttribute("rel", "noopener noreferrer");
  /* a word button, never underlined text (Isaac, 29 October 2026) */
  expect(a).toHaveClass("pt-btn--quiet");
  expect(a).not.toHaveClass("pt-link");
  expect(a.closest("li")).toHaveTextContent("260917 Tender Issue a OneDrive folder, to the job's Documents");
});

it("makes the job only on Create job, and then says so with Open job", async () => {
  createJobFromEmail.mockResolvedValue({ ok: true, jobUuid: "j-1", number: "3471" });
  await draw();
  expect(createJobFromEmail).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
  });
  expect(createJobFromEmail).toHaveBeenCalledWith(ID);
  expect(screen.getByText("Job 3471 made in ServiceM8")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open job 3471" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create job" })).toBeNull();
});

it("says why a job couldn't be made, and keeps the buttons", async () => {
  createJobFromEmail.mockResolvedValue({ ok: false, error: "New jobs are off. Turn them on in Settings › Integrations." });
  await draw();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("New jobs are off.");
  expect(screen.getByRole("button", { name: "Create job" })).toBeEnabled();
});

it("opens the New job form filled in, on the email's own press, and files the email on the job it makes", async () => {
  await draw();
  fireEvent.click(screen.getByRole("button", { name: "Change the details" }));
  expect(screen.getByRole("dialog", { name: "New job form" })).toBeInTheDocument();
  expect(formProps?.initial).toMatchObject({ pressId: ID, clientName: "Truecut Building", address: "40 Westbourne Street, Stanmore NSW 2048", first: "Matt", via: "email" });
  await act(async () => {
    (formProps!.onMade as (u: string) => void)("j-2");
  });
  expect(emailJobMade).toHaveBeenCalledWith(ID, "j-2");
  expect(screen.getByText("Job made in ServiceM8")).toBeInTheDocument();
});

it("puts the card away on Not a job, and draws nothing for an email that isn't work", async () => {
  notAJob.mockResolvedValue(true);
  await draw();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Not a job" }));
  });
  expect(notAJob).toHaveBeenCalledWith(ID);
  expect(screen.getByText("Not a job")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create job" })).toBeNull();
});

it("draws nothing for an email that isn't a request for work", async () => {
  readEmailJob.mockResolvedValue(view({ proposal: { ...view().proposal, isJob: false } }));
  await draw();
  expect(screen.queryByRole("heading", { name: "New job" })).toBeNull();
});

/* "What if I just forward documents that were sent to us for an existing
   job?" (28 October 2026) */
describe("documents for a job already here", () => {
  const job = (n: string, found: string) => ({ uuid: `u-${n}`, number: n, address: "40 Westbourne Street\nStanmore NSW 2048", client: "Truecut Building", status: "Work Order", found });
  const about = (jobs: unknown[]) => view({ proposal: { ...view().proposal, isJob: false, aboutJob: true, jobs } });

  it("offers the one job it's sure of, says how it knows, and adds the email to it", async () => {
    readEmailJob.mockResolvedValue(about([job("3444", "number")]));
    fileEmailOnJob.mockResolvedValue(true);
    await draw();
    expect(screen.getByRole("heading", { name: "For job 3444" })).toBeInTheDocument();
    expect(screen.getByText("Its number is in the email")).toBeInTheDocument();
    expect(screen.getByText("To the job's notes")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to job 3444" }));
    });
    expect(fileEmailOnJob).toHaveBeenCalledWith(ID, "u-3444");
    expect(screen.getByText("Added to job 3444")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open job 3444" })).toBeInTheDocument();
  });

  it("asks which job when it isn't sure, each with its own Add", async () => {
    readEmailJob.mockResolvedValue(about([job("3444", "client"), job("3500", "client")]));
    fileEmailOnJob.mockResolvedValue(true);
    await draw();
    expect(screen.getByRole("heading", { name: "Which job?" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to job 3500" }));
    });
    expect(fileEmailOnJob).toHaveBeenCalledWith(ID, "u-3500");
    expect(screen.getByText("Added to job 3500")).toBeInTheDocument();
  });

  it("turns into a new job on Make a new job instead", async () => {
    readEmailJob.mockResolvedValue(about([job("3444", "number")]));
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Make a new job instead" }));
    expect(screen.getByRole("heading", { name: "New job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create job" })).toBeInTheDocument();
  });
});
