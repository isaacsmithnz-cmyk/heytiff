import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { JobFacts, directionsHref, phoneWords } from "../job-facts";

const counts: Record<string, number> = { "job-3416": 3, "job-bare": 0 };
jest.mock("@/app/actions/site-notes", () => ({
  readSiteNoteCount: jest.fn(async (job: string) => counts[job] ?? null),
  readSiteNotes: jest.fn(async () => null),
  addSiteNote: jest.fn(),
  changeSiteNote: jest.fn(),
  removeSiteNote: jest.fn(),
}));

/* THE FACTS CARD (Isaac, 13 and 14 November 2026, mocks C and D): Next visit,
   the site with Directions, the contacts in full, one card on the left of the
   Overview. Money went to Billing. */

const detail = (over: Partial<MirrorJobDetail> = {}) =>
  ({
    jobNumber: "3385",
    address: "8/36 Abbott Road\nSeven Hills NSW 2147",
    suburb: "Seven Hills",
    geoLine: null,
    contacts: [{ name: "Damian", type: "JOB", phone: "0403183628", altPhone: null, email: null }],
    purchaseOrder: null,
    ...over,
  }) as unknown as MirrorJobDetail;

const base = { detail: detail(), next: null, nextRead: true, onVisits: jest.fn() };
const cells = () => within(screen.getByRole("group", { name: "The job's facts" })).getAllByRole("region");
const cell = (name: string | RegExp) => within(screen.getByRole("region", { name }));

it("reads Next visit first, then the site, then the contacts, and no money", () => {
  // eslint-disable-next-line @next/next/no-img-element
  render(<JobFacts {...base} map={<img className="jfc-map" alt="Map of 8/36 Abbott Road" />} />);
  expect(cells().map((c) => c.querySelector(".jov-lab")?.firstChild?.textContent)).toEqual(["Next visit", "Site", "Contact"]);
  expect(screen.queryByRole("region", { name: "Money" })).toBeNull();
  /* the map sits between Next visit and the site */
  expect(screen.getByAltText("Map of 8/36 Abbott Road").nextElementSibling).toBe(screen.getByRole("region", { name: "Site" }));
});

/* calls 21 and the mock: the address at 16 bold, the rest grey, Directions beside its label */
it("puts the address's first line in bold, the rest under it, and Directions to it in a new tab", () => {
  render(<JobFacts {...base} />);
  expect(cell("Site").getByText("8/36 Abbott Road").tagName).toBe("B");
  expect(cell("Site").getByText("Seven Hills NSW 2147")).toBeInTheDocument();
  const go = cell("Site").getByRole("link", { name: "Directions" });
  expect(go).toHaveAttribute("href", directionsHref("8/36 Abbott Road\nSeven Hills NSW 2147"));
  expect(go).toHaveAttribute("target", "_blank");
  expect(directionsHref("8/36 Abbott Road\nSeven Hills NSW 2147")).toBe("https://www.google.com/maps/dir/?api=1&destination=8%2F36%20Abbott%20Road%2C%20Seven%20Hills%20NSW%202147");
});

/* important text never fades: an email is shown whole, and not underlined */
it("shows a contact's email whole", () => {
  render(<JobFacts {...base} detail={detail({ contacts: [{ name: "Sharon", type: "JOB", phone: null, altPhone: null, email: "sharoninclovelly@gmail.com" }] } as never)} />);
  const mail = cell("Contact").getByText("sharoninclovelly@gmail.com");
  expect(mail).toHaveAttribute("href", "mailto:sharoninclovelly@gmail.com");
  expect(mail).toHaveClass("jov-mail");
});

it("says the job's address in Site, not its number (the header's), and falls back to the geo line", () => {
  const { unmount } = render(<JobFacts {...base} />);
  expect(cell("Site").queryByText(/Job 3385/)).toBeNull();
  expect(cell("Site").getByText(/8\/36 Abbott Road/).closest("p")).toHaveTextContent("Seven Hills NSW 2147");
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
  const tel = c.getByText("0403 183 628").closest("a") as HTMLElement;
  expect(tel).toHaveAttribute("href", "tel:0403183628");
  expect(tel).toHaveClass("jov-tel");
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

it("opens Visits from Next visit", async () => {
  const onVisits = jest.fn();
  render(<JobFacts {...base} onVisits={onVisits} />);
  await userEvent.click(screen.getByRole("button", { name: "Next visit" }));
  expect(onVisits).toHaveBeenCalled();
});

/* the walk of 25 October 2026: it read 0403183628 */
it("writes a number as Australians write it, and anything else as given", () => {
  expect(phoneWords("0403183628")).toBe("0403 183 628");
  expect(phoneWords("0403-183-628")).toBe("0403 183 628");
  expect(phoneWords("0298765432")).toBe("02 9876 5432");
  expect(phoneWords("(02) 9876 5432")).toBe("02 9876 5432");
  expect(phoneWords("1300 123 456")).toBe("1300 123 456");
  expect(phoneWords("+61 403 183 628")).toBe("+61 403 183 628");
  expect(phoneWords("0412 345 678 / 9999 a/h")).toBe("0412 345 678 / 9999 a/h");
});

it("keeps Book a visit's room while the visits are read, so nothing jumps", () => {
  const { rerender } = render(<JobFacts {...base} nextRead={false} onBook={jest.fn()} />);
  const held = screen.getByRole("region", { name: "Next visit" }).querySelector(".jov-press--held");
  expect(held).toHaveAttribute("aria-hidden", "true");
  rerender(<JobFacts {...base} nextRead={false} />);
  expect(screen.getByRole("region", { name: "Next visit" }).querySelector(".jov-press--held")).toBeNull();
});

/* Site notes (build 9): under the address and their PO, the orange asterisk
   on it only when the site has notes; no job, or no address, no button. */
it("offers Site notes under the site, marked only when the site has notes", async () => {
  const { rerender } = render(<JobFacts {...base} detail={detail({ purchaseOrder: "PO-77" })} jobUuid="job-3416" />);
  const site = cell("Site");
  const button = await site.findByRole("button", { name: /^Site notes\s?, the site has notes$/ });
  expect(button.querySelector(".stn-mark")).not.toBeNull();
  /* after their PO */
  expect(site.getByText("PO-77").compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  rerender(<JobFacts {...base} jobUuid="job-bare" />);
  expect(await cell("Site").findByRole("button", { name: "Site notes" })).toBeTruthy();
  expect(cell("Site").getByRole("button", { name: "Site notes" }).querySelector(".stn-mark")).toBeNull();

  rerender(<JobFacts {...base} />);
  expect(cell("Site").queryByRole("button", { name: /Site notes/ })).toBeNull();
  rerender(<JobFacts {...base} detail={detail({ address: "", suburb: "" })} jobUuid="job-3416" />);
  expect(cell("Site").queryByRole("button", { name: /Site notes/ })).toBeNull();
});
