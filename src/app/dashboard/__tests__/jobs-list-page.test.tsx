import { isValidElement, type ReactElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { JobsList } from "@/components/jobs/jobs-list";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { jobMoneyOf } from "@/lib/workboard/job-money";
import type { JobsListData } from "@/lib/workboard/jobs-list-query";
import { DEFAULT_STATE, jobsListRows, type JobsListInput, type ListState } from "@/lib/workboard/jobs-list";

/* /dashboard/jobs: the gate, the address, and the screen — its views and
   their counts, the money column, the search, the empty view, and a row
   that opens the job's page. */

let allowed = true;
const can = jest.fn(async (_c: string) => allowed);
const loadJobsList = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));
jest.mock("@/lib/workboard/jobs-list-query", () => ({ loadJobsList: () => loadJobsList() }));
jest.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const TODAY = "2026-10-13";

const job = (over: Partial<AllJobsMirrorJob> & { remoteId: string }): AllJobsMirrorJob => ({
  jobNumber: "3323",
  status: "Work Order",
  clientName: "Northgate Realty",
  description: null,
  suburb: "Ryde",
  categoryName: "Installation",
  categoryColour: "#2563eb",
  date: "2026-09-20 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: jobMoneyOf({ total_invoice_amount: "24600" }),
  paidCents: 0,
  ...over,
});

function dataFor(over: Partial<JobsListInput> = {}, moneyVisible = true, rest: Partial<JobsListData> = {}): JobsListData {
  const input: JobsListInput = {
    jobs: [
      job({ remoteId: "wo-booked", jobNumber: "3342", clientName: "Rifkin, Julian", suburb: "Bellevue Hill", nextBooking: `${TODAY} 09:00:00` }),
      job({ remoteId: "wo-waiting" }),
      job({ remoteId: "q-1", jobNumber: "3361", status: "Quote", clientName: "Okafor, Ada", suburb: "Riverview", money: null, quote: { lines: 0, priced: false, headline: null } }),
    ],
    projectLinks: [],
    visits: [],
    agreements: [],
    projects: [],
    trips: [],
    crew: { "wo-booked": ["Lyle Irving", "Chris Adams"] },
    wonOn: {},
    today: TODAY,
    moneyVisible,
    ...over,
  };
  if (!moneyVisible) input.jobs = input.jobs.map((j) => ({ ...j, money: null }));
  return { rows: jobsListRows(input), today: TODAY, moneyVisible, manage: true, connected: true, syncing: false, truncated: false, ...rest };
}

const show = (data: JobsListData, initial: Partial<ListState> = {}) => render(<JobsList data={data} initial={{ ...DEFAULT_STATE, ...initial }} />);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const rowLinks = () => within(screen.getByRole("list")).queryAllByRole("link");

beforeEach(() => {
  allowed = true;
  can.mockClear();
  loadJobsList.mockReset();
  window.history.replaceState(null, "", "/dashboard/jobs");
});

describe("the route", () => {
  it("sends a reader without the Workboard back to Home, and reads nothing", async () => {
    allowed = false;
    const { default: JobsPage } = await import("@/app/dashboard/jobs/page");
    await expect(JobsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("workboard");
    expect(loadJobsList).not.toHaveBeenCalled();
  });

  it("opens on the view, person, sort and search the address names", async () => {
    loadJobsList.mockResolvedValue(dataFor());
    const { default: JobsPage } = await import("@/app/dashboard/jobs/page");
    const page = (await JobsPage({ searchParams: Promise.resolve({ view: "quotes", who: "Lyle Irving", sort: "oldest", q: "okafor" }) })) as ReactElement<{
      children: ReactElement<{ searchParams: Promise<Record<string, string>> }>;
    }>;
    const body = page.props.children;
    const list = await (body.type as (p: typeof body.props) => Promise<ReactElement<{ initial: ListState }>>)(body.props);
    expect(isValidElement(list)).toBe(true);
    expect(list.props.initial).toEqual({ view: "quotes", who: "lyle irving", sort: "oldest", q: "okafor" });
  });

  it("lands on Home when there is no workspace to read", async () => {
    loadJobsList.mockResolvedValue(null);
    const { default: JobsPage } = await import("@/app/dashboard/jobs/page");
    const page = (await JobsPage({ searchParams: Promise.resolve({}) })) as ReactElement<{ children: ReactElement }>;
    const body = page.props.children;
    await expect((body.type as (p: unknown) => Promise<unknown>)(body.props)).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("the screen", () => {
  it("says what's open and counts each view", () => {
    show(dataFor());
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByText("3 open")).toBeInTheDocument();
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^All/)).toHaveTextContent("All3");
    expect(tab(/^To book/)).toHaveTextContent("To book1");
    expect(tab(/^Quotes/)).toHaveTextContent("Quotes1");
    expect(rowLinks()).toHaveLength(3);
  });

  it("opens a row on the job's page", () => {
    show(dataFor());
    const link = screen.getByRole("link", { name: /3342/ });
    expect(link).toHaveAttribute("href", "/dashboard/jobs/wo-booked");
    expect(within(link).getByRole("img", { name: "Lyle Irving" })).toBeInTheDocument();
    expect(link).toHaveTextContent("Booked");
    expect(link).toHaveTextContent("Today 9am");
    expect(link).toHaveTextContent("$24,600");
    expect(screen.getByRole("link", { name: /3361/ })).toHaveTextContent("Nobody yet");
  });

  it("holds the view in the address as it changes", () => {
    show(dataFor());
    fireEvent.click(tab(/^Quotes/));
    expect(tab(/^Quotes/)).toHaveAttribute("aria-selected", "true");
    expect(rowLinks()).toHaveLength(1);
    expect(window.location.pathname + window.location.search).toBe("/dashboard/jobs?view=quotes");
    fireEvent.click(tab(/^All/));
    expect(window.location.search).toBe("");
  });

  it("searches as you type, and writes the words in the address", () => {
    show(dataFor());
    fireEvent.change(screen.getByRole("textbox", { name: "Search jobs, clients and sites" }), { target: { value: "bellevue" } });
    expect(rowLinks()).toHaveLength(1);
    expect(tab(/^All/)).toHaveTextContent("All1");
    expect(window.location.search).toBe("?q=bellevue");
    fireEvent.click(screen.getByRole("button", { name: "Clear the search box" }));
    expect(rowLinks()).toHaveLength(3);
    expect(window.location.search).toBe("");
  });

  it("says when the search finds nothing, and clears it", () => {
    show(dataFor(), { q: "nobody-matches" });
    expect(screen.getByText('No jobs here match "nobody-matches"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(rowLinks()).toHaveLength(3);
  });

  it("narrows to nobody yet from the address", () => {
    show(dataFor(), { who: "nobody" });
    expect(rowLinks().map((a) => a.getAttribute("href")).sort()).toEqual(["/dashboard/jobs/q-1", "/dashboard/jobs/wo-waiting"]);
  });

  it("says when a person has nothing here, and shows everyone's again", () => {
    show(dataFor(), { who: "someone else" });
    expect(screen.getByText("Nothing here for this person")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everyone's jobs" }));
    expect(rowLinks()).toHaveLength(3);
    expect(window.location.search).toBe("");
  });

  it("shows money only with the grant", () => {
    show(dataFor({}, false));
    expect(screen.queryByText("Value")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Owed/ })).not.toBeInTheDocument();
    expect(screen.queryByText("$24,600")).not.toBeInTheDocument();
  });

  it("shows the Value column and Owed with the grant", () => {
    show(dataFor());
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(tab(/^Owed/)).toHaveTextContent("Owed0");
  });
});

describe("an empty view", () => {
  const cases: [RegExp, string][] = [
    [/^To book/, "Every work order has a day"],
    [/^Quotes/, "No quotes waiting on an answer"],
    [/^To invoice/, "Nothing to invoice"],
    [/^Owed/, "Nothing owed on finished work"],
    [/^Projects/, "No projects running"],
    [/^Agreements/, "No service agreements"],
  ];
  it.each(cases)("%s says what's missing and leads back to all jobs", (name, words) => {
    show(dataFor({ jobs: [job({ remoteId: "x", nextBooking: `${TODAY} 09:00:00` })] }));
    fireEvent.click(tab(name));
    expect(screen.getByText(words)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See all jobs" }));
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
    expect(rowLinks()).toHaveLength(1);
  });

  it("All says there are no open jobs", () => {
    show(dataFor({ jobs: [] }, true, { connected: true, syncing: false }));
    expect(screen.getByText("No open jobs")).toBeInTheDocument();
  });

  it("says ServiceM8 isn't connected, with the way to connect it", () => {
    show(dataFor({ jobs: [] }, true, { connected: false }));
    expect(screen.getByText("ServiceM8 isn't connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect ServiceM8" })).toHaveAttribute("href", "/dashboard/admin/integrations/servicem8");
  });

  it("says the first sync is still bringing the jobs across", () => {
    show(dataFor({ jobs: [] }, true, { syncing: true }));
    expect(screen.getByText("Bringing the jobs across from ServiceM8")).toBeInTheDocument();
  });
});
