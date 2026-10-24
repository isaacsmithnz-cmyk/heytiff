import { render, screen } from "@testing-library/react";
import { JobCustomer } from "../job-customer";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";

/* job-sheet carries the server actions; the customer column only borrows its tel: helper */
jest.mock("../job-sheet", () => ({ telHref: () => null }));

/* THE SITE ON OVERVIEW. The job's number and address left the page head's
   grey line (Isaac, 25 October 2026), so Overview's customer column is the
   one place they're said. */

const detail = (over: Partial<MirrorJobDetail> = {}) =>
  ({
    jobNumber: "3385",
    address: "8/36 Abbott Road\nSeven Hills NSW 2147",
    suburb: "Seven Hills",
    geoLine: null,
    contacts: [],
    purchaseOrder: null,
    ...over,
  }) as unknown as MirrorJobDetail;

it("says the job's number and its address above the contacts", () => {
  render(<JobCustomer detail={detail()} />);
  expect(screen.getByText("Site")).toBeInTheDocument();
  expect(screen.getByText("Job 3385")).toBeInTheDocument();
  expect(screen.getByText(/8\/36 Abbott Road/)).toHaveTextContent("Seven Hills NSW 2147");
});

it("falls back to the geo line for a job with no written address", () => {
  render(<JobCustomer detail={detail({ address: null, geoLine: "Rose Bay NSW 2029" })} />);
  expect(screen.getByText("Rose Bay NSW 2029")).toBeInTheDocument();
});

it("draws nothing for a job with no number, no address and no contacts", () => {
  const { container } = render(<JobCustomer detail={detail({ jobNumber: null, address: null, suburb: null })} />);
  expect(container).toBeEmptyDOMElement();
});
