import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { JobFacts } from "../job-facts";

/* THE STRIP OF FACTS (Isaac, 25 October 2026, "Yes, build the refined
   Overview A"): Site, Contact, Next visit and Money, one box; three cells
   for whoever doesn't see money. The customer column that stood under the
   tiles came into Site and Contact. */

const detail = (over: Partial<MirrorJobDetail> = {}) =>
  ({
    jobNumber: "3385",
    address: "8/36 Abbott Road\nSeven Hills NSW 2147",
    suburb: "Seven Hills",
    geoLine: null,
    contacts: [{ name: "Damian", type: "JOB", phone: "0403 183 628", altPhone: null, email: null }],
    purchaseOrder: null,
    ...over,
  }) as unknown as MirrorJobDetail;

const base = { detail: detail(), next: null, nextRead: true, onVisits: jest.fn() };
const cells = () => within(screen.getByRole("group", { name: "The job's facts" })).getAllByRole("region");
const cell = (name: string | RegExp) => within(screen.getByRole("region", { name }));

it("has four cells, Site, Contact, Next visit and Money, for whoever sees money", () => {
  render(<JobFacts {...base} money={<b className="jov-fig">$13,833.76</b>} onMoney={jest.fn()} />);
  expect(cells().map((c) => c.querySelector(".jov-lab")?.firstChild?.textContent)).toEqual(["Site", "Contact", "Next visit", "Money"]);
  expect(cell("Money").getByText("$13,833.76")).toBeInTheDocument();
});

it("has three cells without money", () => {
  render(<JobFacts {...base} />);
  expect(screen.getByRole("group", { name: "The job's facts" })).toHaveClass("jov-facts--3");
  expect(cells()).toHaveLength(3);
  expect(screen.queryByRole("region", { name: "Money" })).toBeNull();
});

it("says the job's number and its address in Site, and falls back to the geo line", () => {
  const { unmount } = render(<JobFacts {...base} />);
  expect(cell("Site").getByText("Job 3385")).toBeInTheDocument();
  expect(cell("Site").getByText(/8\/36 Abbott Road/)).toHaveTextContent("Seven Hills NSW 2147");
  unmount();
  render(<JobFacts {...base} detail={detail({ address: null, geoLine: "Rose Bay NSW 2029" })} />);
  expect(cell("Site").getByText("Rose Bay NSW 2029")).toBeInTheDocument();
});

it("puts who to ring in Contact: their disc, name, role and the number to dial, and Edit only where it saves", async () => {
  const onEditContact = jest.fn();
  const { unmount } = render(<JobFacts {...base} />);
  expect(cell("Contact").queryByRole("button", { name: "Edit" })).toBeNull();
  unmount();
  render(<JobFacts {...base} onEditContact={onEditContact} />);
  const c = cell("Contact");
  expect(c.getByText("Damian")).toBeInTheDocument();
  expect(c.getByText("Job contact")).toBeInTheDocument();
  expect(c.getByText("0403 183 628").closest("a")).toHaveAttribute("href", "tel:0403183628");
  expect(screen.getByRole("region", { name: "Contact" }).querySelector(".pt-initials--32")).toHaveTextContent("D");
  await userEvent.click(c.getByRole("button", { name: "Edit" }));
  expect(onEditContact).toHaveBeenCalled();
});

/* 25 October 2026, walking job 3440 from the Schedule: Next visit said
   "Nothing booked" while it read, then "Tomorrow, 7:30 am" */
it("offers Book a visit, blue, only once it knows nothing is booked and the reader may book", () => {
  const onBook = jest.fn();
  const { unmount, rerender } = render(<JobFacts {...base} nextRead={false} onBook={onBook} />);
  expect(cell("Next visit").getByText("Reading the visits")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Book a visit" })).toBeNull();
  rerender(<JobFacts {...base} onBook={onBook} />);
  expect(cell("Next visit").getByText("Nothing booked")).toBeInTheDocument();
  expect(cell("Next visit").getByRole("button", { name: "Book a visit" })).toHaveClass("pt-btn--main");
  rerender(<JobFacts {...base} />);
  expect(screen.queryByRole("button", { name: "Book a visit" })).toBeNull();
  rerender(<JobFacts {...base} onBook={onBook} next={{ when: "Tomorrow, 7:30 am", who: "Lyle Irving", state: null }} />);
  expect(cell("Next visit").getByText("Tomorrow, 7:30 am")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Book a visit" })).toBeNull();
  unmount();
});

it("opens Visits from Next visit and Billing from Money", async () => {
  const onVisits = jest.fn();
  const onMoney = jest.fn();
  render(<JobFacts {...base} onVisits={onVisits} money={<b>$1</b>} onMoney={onMoney} />);
  await userEvent.click(screen.getByRole("button", { name: "Next visit" }));
  await userEvent.click(screen.getByRole("button", { name: "Money" }));
  expect(onVisits).toHaveBeenCalled();
  expect(onMoney).toHaveBeenCalled();
});
