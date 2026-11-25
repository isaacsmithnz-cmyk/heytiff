import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { JobFacts, JobHeadMap, JobSiteWords, addressLines, directionsHref, phoneWords, withoutCountry } from "../job-facts";

const counts: Record<string, number> = { "job-3416": 3, "job-bare": 0 };
jest.mock("@/app/actions/site-notes", () => ({
  addSiteNote: jest.fn(),
  changeSiteNote: jest.fn(),
  removeSiteNote: jest.fn(),
}));
/* the reads come by their own route (site-notes-read.ts) */
jest.mock("../site-notes-read", () => ({
  fetchSiteNoteCount: jest.fn(async (job: string) => counts[job] ?? null),
  fetchSiteNotes: jest.fn(async () => null),
}));

/* THE FACTS CARD (Isaac, 13 and 14 November 2026, mocks C and D): Next visit,
   the site with Directions, the contacts in full, one card on the left of the
   Overview. Money went to Billing. */

const detail = (over: Partial<MirrorJobDetail> = {}) =>
  ({
    jobNumber: "3385",
    address: "8/36 Laboris Road\nDummy Hills NSW 2147",
    suburb: "Dummy Hills",
    geoLine: null,
    contacts: [{ name: "Damian", type: "JOB", phone: "0491570006", altPhone: null, email: null }],
    purchaseOrder: null,
    ...over,
  }) as unknown as MirrorJobDetail;

const base = { detail: detail(), next: null, nextRead: true, onVisits: jest.fn() };
const cells = () => within(screen.getByRole("group", { name: "The job's facts" })).getAllByRole("region");
const cell = (name: string | RegExp) => within(screen.getByRole("region", { name }));

it("reads Next visit first, then the stages, then the contacts, and no money or site", () => {
  render(<JobFacts {...base} stages={<nav aria-label="Where the job is up to" />} />);
  expect(cells().map((c) => c.getAttribute("aria-label") ?? c.querySelector(".jov-lab")?.firstChild?.textContent)).toEqual(["Next visit", "Where the job is up to", "Contact"]);
  expect(screen.queryByRole("region", { name: "Money" })).toBeNull();
  /* the site and its map are the head's now (Isaac, 16 November 2026) */
  expect(screen.queryByRole("region", { name: "Site" })).toBeNull();
});

/* important text never fades: an email is shown whole, and not underlined */
it("shows a contact's email whole", () => {
  render(<JobFacts {...base} detail={detail({ contacts: [{ name: "Sharon", type: "JOB", phone: null, altPhone: null, email: "sharon@ironside.example" }] } as never)} />);
  const mail = cell("Contact").getByText("sharon@ironside.example");
  expect(mail).toHaveAttribute("href", "mailto:sharon@ironside.example");
  expect(mail).toHaveClass("jov-mail");
});

/* THE SITE IN THE HEAD (Isaac, 16 November 2026, A): the address's first line bold over the rest */
it("puts the address's first line in bold over the rest, and falls back to the geo line", () => {
  const { container, unmount } = render(<JobSiteWords detail={detail()} jobUuid={null} />);
  expect(screen.getByText("8/36 Laboris Road").tagName).toBe("B");
  expect(container.querySelector(".jp-addr")).toHaveTextContent("Dummy Hills NSW 2147");
  expect(container).not.toHaveTextContent(/3385/);
  unmount();
  render(<JobSiteWords detail={detail({ address: null, geoLine: "Example Bay NSW 2029" })} jobUuid={null} />);
  expect(screen.getByText("Example Bay NSW 2029")).toBeInTheDocument();
});

it("makes the head's map the directions to the site, in a new tab, its wide picture from our own route", () => {
  render(<JobHeadMap jobUuid="job-3385" hue="purple" address={"8/36 Laboris Road\nDummy Hills NSW 2147"} />);
  const go = screen.getByRole("link", { name: "Directions to 8/36 Laboris Road, Dummy Hills NSW 2147" });
  expect(go).toHaveAttribute("href", directionsHref("8/36 Laboris Road\nDummy Hills NSW 2147"));
  expect(go).toHaveAttribute("target", "_blank");
  expect(go.querySelector("img")).toHaveAttribute("src", "/api/workboard/job-map?job=job-3385&hue=purple&shape=head");
  expect(directionsHref("8/36 Laboris Road\nDummy Hills NSW 2147")).toBe("https://www.google.com/maps/dir/?api=1&destination=8%2F36%20Laboris%20Road%2C%20Dummy%20Hills%20NSW%202147");
});

/* bug 52 (Isaac, 20 November 2026: "map misaligned"): the map's card is the
   head's right column and the words' card's height, so its picture is asked
   for at the card's size */
it("asks for the head's picture at the size its card stands at", () => {
  const w = jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(380);
  const h = jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(164);
  try {
    render(<JobHeadMap jobUuid="job-3521" hue="orange" address="14/8 Example Crescent, Demoford NSW" />);
    const img = screen.getByRole("link", { name: /Directions to/ }).querySelector("img");
    expect(img).toHaveAttribute("src", "/api/workboard/job-map?job=job-3521&hue=orange&shape=head&w=380&h=164");
    expect(img).toHaveAttribute("width", "380");
    expect(img).toHaveAttribute("height", "164");
  } finally {
    w.mockRestore();
    h.mockRestore();
  }
});

it("puts who to ring in Contact a line each, their numbers and email dropping down when pressed, and Edit only where it saves", async () => {
  const onEditContact = jest.fn();
  const { unmount } = render(<JobFacts {...base} />);
  expect(cell("Contact").queryByRole("button", { name: "Edit" })).toBeNull();
  unmount();
  render(<JobFacts {...base} onEditContact={onEditContact} />);
  const c = cell("Contact");
  const who = c.getByRole("button", { name: /Damian\s*Job contact/ });
  expect(who).toHaveAttribute("aria-expanded", "false");
  expect(c.queryByRole("link", { name: "0491 570 006" })).toBeNull();
  expect(screen.getByRole("region", { name: "Contact" }).querySelector(".pt-initials--24")).toHaveTextContent("D");
  await userEvent.click(who);
  expect(who).toHaveAttribute("aria-expanded", "true");
  const tel = c.getByRole("link", { name: "0491 570 006" });
  expect(tel).toHaveAttribute("href", "tel:0491570006");
  expect(tel).toHaveClass("jov-tel");
  await userEvent.click(who);
  expect(c.queryByRole("link", { name: "0491 570 006" })).toBeNull();
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
  rerender(<JobFacts {...base} onBook={onBook} next={{ when: "Tomorrow, 7:30 am", who: "Lyle Irving", crew: 1, state: null }} />);
  expect(cell("Next visit").getByText("Tomorrow, 7:30 am")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Book a visit" })).toBeNull();
  unmount();
});

/* AT A GLANCE (Isaac, 25 November 2026: "just have person symbol and number
   with names", "add blue view booking, or book visit if theres nothing
   booked", "change card title to something that covers the whole card") */
it("heads the card At a glance, and gives a booked visit its crew and a blue View booking", async () => {
  const onVisits = jest.fn();
  render(<JobFacts {...base} onVisits={onVisits} next={{ when: "Thu 27 Nov, 7:30 am", who: "Lyle Irving and Dane Hill", crew: 2, state: null }} />);
  expect(screen.getByRole("heading", { name: "At a glance" })).toBeInTheDocument();
  const crew = screen.getByRole("region", { name: "Next visit" }).querySelector(".jfc-crew");
  expect(crew).toHaveTextContent("2Lyle Irving and Dane Hill");
  const view = cell("Next visit").getByRole("button", { name: "View booking" });
  expect(view).toHaveClass("pt-btn--main");
  await userEvent.click(view);
  expect(onVisits).toHaveBeenCalled();
});

it("counts the people booked only when there's more than one (Isaac, 26 November 2026)", () => {
  render(<JobFacts {...base} next={{ when: "Today, 7:30 am", who: "Lyle Irving", crew: 1, state: null }} />);
  const crew = screen.getByRole("region", { name: "Next visit" }).querySelector(".jfc-crew");
  expect(crew).toHaveTextContent(/^Lyle Irving$/);
  expect(crew!.querySelector("b")).toBeNull();
});

it("heads the steps Stage alone, the step it's at said once, in the steps (Isaac, 26 November 2026)", () => {
  render(<JobFacts {...base} stages={<nav aria-label="Where the job is up to" />} />);
  const head = screen.getByRole("region", { name: "Where the job is up to" }).querySelector(".jov-lab");
  expect(head).toHaveTextContent(/^Stage$/);
});

it("opens Visits from Next visit", async () => {
  const onVisits = jest.fn();
  render(<JobFacts {...base} onVisits={onVisits} />);
  await userEvent.click(screen.getByRole("button", { name: "Next visit" }));
  expect(onVisits).toHaveBeenCalled();
});

/* the walk of 25 October 2026: it read 0491570006 */
it("writes a number as Australians write it, and anything else as given", () => {
  expect(phoneWords("0491570006")).toBe("0491 570 006");
  expect(phoneWords("0491-570-006")).toBe("0491 570 006");
  expect(phoneWords("0298765432")).toBe("02 9876 5432");
  expect(phoneWords("(02) 9876 5432")).toBe("02 9876 5432");
  expect(phoneWords("1300 123 456")).toBe("1300 123 456");
  expect(phoneWords("+61 491 570 006")).toBe("+61 491 570 006");
  expect(phoneWords("0412 345 678 / 9999 a/h")).toBe("0412 345 678 / 9999 a/h");
});

it("keeps Book a visit's room while the visits are read, so nothing jumps", () => {
  const { rerender } = render(<JobFacts {...base} nextRead={false} onBook={jest.fn()} />);
  const held = screen.getByRole("region", { name: "Next visit" }).querySelector(".jov-press--held");
  expect(held).toHaveAttribute("aria-hidden", "true");
  rerender(<JobFacts {...base} nextRead={false} />);
  expect(screen.getByRole("region", { name: "Next visit" }).querySelector(".jov-press--held")).toBeNull();
});

/* Site notes (build 9): beside the address in the head, the orange asterisk
   on it only when the site has notes; no job, or no address, no button. */
it("offers Site notes beside the site, marked only when the site has notes", async () => {
  const { rerender } = render(<JobSiteWords detail={detail({ purchaseOrder: "PO-77" })} jobUuid="job-3416" />);
  const button = await screen.findByRole("button", { name: /^Site notes\s?, the site has notes$/ });
  expect(button.querySelector(".stn-mark")).not.toBeNull();
  /* the phone's building on the button, always (Isaac, 15 November 2026) */
  expect(button.querySelector(".stn-bldg")).not.toBeNull();
  expect(screen.getByText("PO-77")).toBeInTheDocument();

  rerender(<JobSiteWords detail={detail()} jobUuid="job-bare" />);
  expect(await screen.findByRole("button", { name: "Site notes" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Site notes" }).querySelector(".stn-mark")).toBeNull();

  rerender(<JobSiteWords detail={detail()} jobUuid={null} />);
  expect(screen.queryByRole("button", { name: /Site notes/ })).toBeNull();
  rerender(<JobSiteWords detail={detail({ address: "", suburb: "" })} jobUuid="job-3416" />);
  expect(screen.queryByRole("button", { name: /Site notes/ })).toBeNull();
});

it("lays a one-line address over two lines at its last comma (3533)", () => {
  expect(addressLines("2 Tempor Street, Demoford")).toEqual(["2 Tempor Street", "Demoford"]);
  expect(addressLines("Unit 2, 106 Exampleton Ave, Exampleton NSW 2061")).toEqual(["Unit 2, 106 Exampleton Ave", "Exampleton NSW 2061"]);
  expect(addressLines("910/226 Imaginary St\nMock Point NSW 2011")).toEqual(["910/226 Imaginary St", "Mock Point NSW 2011"]);
  expect(addressLines("Demoford")).toEqual(["Demoford"]);
});

it("leaves ServiceM8's country off, so the street isn't put over \"Australia\" (a quote's head)", () => {
  expect(addressLines("14/8 Example Crescent, Demoford NSW, Australia")).toEqual(["14/8 Example Crescent", "Demoford NSW"]);
  expect(addressLines("910/226 Imaginary St\nMock Point NSW 2011\nAustralia")).toEqual(["910/226 Imaginary St", "Mock Point NSW 2011"]);
  expect(withoutCountry("14/8 Example Crescent, Demoford NSW, Australia")).toBe("14/8 Example Crescent, Demoford NSW");
  expect(withoutCountry("12 Australia Street, Camperdown NSW 2050")).toBe("12 Australia Street, Camperdown NSW 2050");
  expect(withoutCountry("Camperdown NSW 2050, Australia ")).toBe("Camperdown NSW 2050");
  expect(withoutCountry("5 Hay Street, Perth, Western Australia")).toBe("5 Hay Street, Perth, Western Australia");
  expect(withoutCountry("5 King William St\nAdelaide\nSouth Australia")).toBe("5 King William St\nAdelaide\nSouth Australia");
  expect(withoutCountry("5 Hay Street, Perth WA 6000, AUSTRALIA")).toBe("5 Hay Street, Perth WA 6000");
});
