import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffLicence } from "@/lib/staff/types";
import { ProfileScreen } from "../profile-screen";
import type { AssignedVehicle, ProfileMode } from "../types";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* Summary — the landing tab, redrawn 2026-09-15 from the worker-profile
   handoff: the identity row, three groups of facts, and one row of tiles for
   the tickets and the right to work.

   Two rules built it and both are pinned here. IF THE IDENTITY ROW SAYS IT, A
   GROUP DOESN'T — it is easy to add a cell back to Personal without noticing
   the row three inches above already says it, and that is how this screen
   once got to a screen and a half of scrolling. And EVERY DOOR ON THE PAGE
   LEADS TO THE TAB THAT OWNS THE FACT: an Add opens the section's form, a
   tile opens its tab, and the group's link does the same. */

/* FULLY TYPED, and that is the point of it. An earlier fixture went in through
   `as unknown as` and spelled two fields wrong; nothing caught it because the
   cast turned the compiler off. serviceKmLeft = 78,000 + 10,000 − 82,000 =
   6,000 and rego is 120 days out, so this vehicle is healthy; the no-warning
   test winds the odometer 45,500 km past due instead. */
const VEHICLE: AssignedVehicle = {
  vehicle: {
    id: "v1",
    name: "",
    make: "Toyota",
    model: "Hilux",
    year: 2022,
    plate: "ABC123",
    plateState: "NSW",
    status: "active",
    odometer: 82_000,
    regoDays: 120,
    insuranceDays: 200,
    ctpDays: 200,
    serviceIntervalKm: 10_000,
    lastServiceOdo: 78_000,
    serviceIntervalMonths: null,
    serviceDays: null,
    motorised: true,
  },
  openIssues: 0,
  lastFuel: null,
};

const LICENCES: StaffLicence[] = [
  {
    id: "l1",
    typeName: "ARC licence",
    licenceNumber: "AU41207",
    expiryDate: "2026-09-02",
    color: "#00A389",
  },
  { id: "l2", typeName: "White card", licenceNumber: null, expiryDate: null, color: null },
];

/* jordan holds every detail but the right to work and a photo; `cleared` adds
   the status, so the tile is a record rather than a required blank */
const cleared = { ...jordan, work_rights_status: "Australian citizen" };

function setup(
  over: {
    mode?: ProfileMode;
    licences?: StaffLicence[];
    vehicle?: AssignedVehicle | null;
    orgState?: string | null;
    profile?: typeof jordan;
    header?: typeof header;
  } = {}
) {
  const actions = okActions();
  const view = render(
    <ProfileScreen
      mode={over.mode ?? "admin"}
      header={over.header ?? header}
      profile={over.profile ?? jordan}
      licences={over.licences ?? []}
      vehicle={over.vehicle ?? null}
      today={TODAY} warnDays={30}
      org="Smith Air"
      // `in`, not `??` — passing null explicitly means "the org has no state",
      // and `?? "NSW"` would quietly give it one
      orgState={"orgState" in over ? over.orgState! : "NSW"}
      actions={actions}
    />
  );
  return { ...view, actions };
}

const group = (title: string) => screen.getByRole("region", { name: title });
const rows = () => [...document.querySelectorAll(".psum-tix-r")] as HTMLButtonElement[];
const standing = () => document.querySelector(".psum-stand") as HTMLElement;
const isEditing = () => screen.queryByRole("button", { name: /^Save\b/ }) !== null;

describe("what Summary does not repeat", () => {
  /* Name, role, status and start are the identity row's, so no group carries
     them — which is why Personal opens on Date of birth rather than First name. */
  it("leaves the identity row's facts to the identity row", () => {
    const { container } = setup();

    expect(container.querySelector(".pident h1")).toHaveTextContent("Jordan Mills");
    const personal = group("Personal");
    expect(within(personal).queryByText("First name")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Last name")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Job title")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Status")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Start date")).not.toBeInTheDocument();
    // and it opens on what the row can't say
    expect(within(personal).getByText("Date of birth")).toBeInTheDocument();
  });

  /* One sentence under the name: the role and since when. Not a chain of
     facts with dots between them, and not the org's name — there is only
     ever one org on screen. */
  it("says the role and the start as one sentence, without the org's name", () => {
    const { container } = setup();
    const sub = container.querySelector(".pident .sub");
    expect(sub).toHaveTextContent("Lead Installer, since Jun 2020 (6.1 years)");
    expect(sub).not.toHaveTextContent("Smith Air");
    expect(sub).not.toHaveTextContent("·");
  });

  it("puts the status beside the name, as a word with a dot", () => {
    const { container } = setup();
    const badge = container.querySelector(".pident .ptitle .badge");
    expect(badge).toHaveClass("active");
    expect(badge).toHaveTextContent("Active");
  });

  /* The vehicle had a group of four rows sitting under a row that had already
     named it — the same rule broken from the other end. The plate IS the fact,
     and Fleet owns everything the four rows copied. */
  it("gives the vehicle no group at all — the identity row carries the plate", () => {
    setup({ vehicle: VEHICLE });
    expect(screen.queryByRole("region", { name: /vehicle/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Make & model")).not.toBeInTheDocument();
    expect(screen.queryByText("Rego expiry")).not.toBeInTheDocument();
  });
});

describe("the groups", () => {
  /* The right to work left this row on 2026-09-16 and became the standing
     line, so the third group holds only things that expire and is named for
     them. Personal and Emergency sit side by side — Emergency is three fields
     and never earned a band of its own. */
  it("are three, each a hairline group with its own way in", () => {
    const { container } = setup();
    const names = [...document.querySelectorAll(".psum-g .psum-h")].map((h) => h.textContent);
    expect(names).toEqual(["Personal", "Emergency contact", "Licences and tickets"]);
    expect(within(group("Personal")).getByRole("button", { name: "Edit Personal" })).toBeInTheDocument();
    expect(within(group("Emergency contact")).getByRole("button", { name: "Edit Emergency contact" })).toBeInTheDocument();
    expect(within(group("Licences and tickets")).getByRole("button", { name: /^Manage/ })).toBeInTheDocument();
    // the two short groups share a row; the tickets run the full width below
    const pair = container.querySelector(".psum-pair")!;
    expect(pair.querySelectorAll(".psum-g")).toHaveLength(2);
  });

  /* A LEDGER, NOT A GRID. Label over value in three columns makes the eye
     zigzag — read down, jump right, read down — which is the slowest way to
     look one fact up. The label sits in its own column and the answer beside
     it, ruled between rows. */
  it("lays the facts out as a ledger, the label beside its answer", () => {
    setup();
    const personal = group("Personal");
    const labels = [...personal.querySelectorAll(".psum-rows dt")].map((d) => d.textContent);
    expect(labels).toEqual([
      "Date of birth",
      "Mobile",
      "Email",
      "Address",
      "Employment",
      "Uniform",
      "Holiday state",
    ]);
    expect(within(personal).getByText("25/12/1990")).toBeInTheDocument();
    expect(within(personal).getByText("0400 000 000")).toBeInTheDocument();
  });

  /* The group's link opens its section straight into the form — the same
     door every Add in the group opens. */
  it("opens the section's form from the group's Edit", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Edit Emergency contact" }));
    expect(screen.getByRole("tab", { name: /Emergency/ })).toHaveClass("on");
    expect(isEditing()).toBe(true);
  });
});

describe("blanks", () => {
  /* A blank the business is short of is an Add; a blank nobody is short of
     is a dash. The completeness model draws the line, so the Adds here and
     the counts on the tabs cannot disagree. */
  it("is an Add when the business is short of it, and a dash when it is not", () => {
    setup({ profile: { ...jordan, emergency_name: null, emergency_relationship: null } });
    const emergency = group("Emergency contact");
    expect(within(emergency).getByRole("button", { name: "Add Emergency contact name" })).toBeInTheDocument();
    expect(within(emergency).getAllByLabelText("not recorded")).toHaveLength(1);
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  /* ABSENCE IS SAID ONCE. The word Required used to sit beside every required
     blank AS WELL as in the count above them, which on a card with four gaps
     made absence the loudest thing on the screen — in the page's only strong
     colour, while everything on file sat quiet. The record line counts them;
     a cell just offers the Add, required or wanted alike. */
  it("does not repeat the count beside each blank", () => {
    setup({ profile: { ...jordan, phone: null, birthday: null } });
    const personal = group("Personal");
    expect(within(personal).getByRole("button", { name: "Add Date of birth" })).toBeInTheDocument();
    expect(within(personal).getByRole("button", { name: "Add Mobile" })).toBeInTheDocument();
    expect(personal).not.toHaveTextContent("Required");
    expect(document.querySelector(".psum-req")).toBeNull();
  });

  it("never offers to add what this card cannot write", () => {
    setup({ profile: { ...jordan, emergency_relationship: null } });
    expect(screen.queryByRole("button", { name: /Add Email/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Relationship/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Uniform/ })).not.toBeInTheDocument();
  });

  /* The start date reads in the identity row, so its Add is there too —
     otherwise the tab's count points at a blank nothing on the page shows. */
  it("puts the start date's Add in the identity row, where the start reads", async () => {
    const user = userEvent.setup();
    const { container } = setup({
      header: { ...header, started: "—", years: "—" },
      profile: { ...jordan, start_date: null },
    });
    const sub = container.querySelector(".pident .sub") as HTMLElement;
    expect(sub).toHaveTextContent("Lead Installer");
    expect(sub).not.toHaveTextContent("since");
    const add = within(sub).getByRole("button", { name: "Add a start date" });
    // the word Required went with the doubling; the record line counts it
    expect(sub).not.toHaveTextContent("Required");

    await user.click(add);
    expect(screen.getByRole("tab", { name: /Personal/ })).toHaveClass("on");
    expect(isEditing()).toBe(true);
  });

  it("says since when, with no Add, once the start is on file", () => {
    const { container } = setup();
    expect(container.querySelector(".pident .sub")).toHaveTextContent("since Jun 2020");
    expect(screen.queryByRole("button", { name: "Add a start date" })).not.toBeInTheDocument();
  });
});

describe("the holiday state", () => {
  /* "Same as organisation" is a sentence about a setting. The question is
     which public holidays this person is paid for, and the org's own state is
     the answer. */
  it("resolves an unset one against the org rather than describing it", () => {
    setup({ profile: { ...jordan, state: null }, orgState: "NSW" });
    const personal = group("Personal");
    expect(within(personal).getByText("NSW")).toBeInTheDocument();
    expect(within(personal).getByText("Organisation default")).toBeInTheDocument();
    expect(screen.queryByText("Same as organisation")).not.toBeInTheDocument();
  });

  it("shows an override as itself, with no qualifier", () => {
    setup({ profile: { ...jordan, state: "VIC" }, orgState: "NSW" });
    const personal = group("Personal");
    expect(within(personal).getByText("VIC")).toBeInTheDocument();
    expect(within(personal).queryByText("Organisation default")).not.toBeInTheDocument();
  });

  it("is an admin cell — your own card doesn't set which state pays you", () => {
    setup({ mode: "self" });
    expect(screen.queryByText("Holiday state")).not.toBeInTheDocument();
  });
});

/* THE STANDING LINE — the one thing the screen says out loud.

   The right to work was the first tile in the row of tickets, in the same
   grey as the White card beside it, which made the thing that decides whether
   a person can be sent to a job the thing you could not pick out. It is not a
   ticket: nothing on it expires the way a ticket does, and you do not hold a
   copy of it in the ute. It is a sentence now, at the reading size, above
   everything. */
describe("the standing line", () => {
  it("says the gap, and offers no clearance, while nothing is recorded", () => {
    setup();
    expect(standing()).toHaveTextContent("Right to work not recorded");
    expect(standing().querySelector("b")).toHaveClass("warn");
    // it is a statement, not a door: the tab beside it manages the right to work
    expect(within(standing()).queryByRole("button")).toBeNull();
  });

  it("reads the clearance and its evidence once the right to work is set", () => {
    setup({ profile: cleared });
    expect(standing().querySelector("b")).toHaveClass("ok");
    expect(standing()).toHaveTextContent("Cleared to work");
    expect(standing()).toHaveTextContent("Australian citizen, no visa required.");
  });

  /* A person on a valid visa IS cleared to work, so the warning goes on the
     visa and not on the word "cleared" — colouring the clearance amber to
     mean "but check the visa" is the sentence contradicting itself. */
  it("puts a warning on the evidence, not on the clearance", () => {
    setup({
      profile: {
        ...jordan,
        work_rights_status: "Full working rights (visa)",
        visa_type: "482 TSS",
        visa_expiry: "2026-08-07",
      },
    });
    expect(standing().querySelector("b")).toHaveClass("ok");
    expect(standing().querySelector("span.warn")).toHaveTextContent("482 TSS expires in 2 weeks.");
  });

  it("leaves no work-rights tile behind in the tickets", () => {
    setup({ licences: LICENCES, profile: cleared });
    expect(rows().map((r) => r.querySelector(".t")?.textContent)).not.toContain("Australian citizen");
  });
});

/* THE TICKETS — a list, not a row of tiles. Two tiles in a 1000px row look
   unfinished at any quality, because there are two; a ruled list reads as a
   record at one row and still reads at twelve. */
describe("the tickets", () => {
  it("renders every licence as a row, with the expiry doing the talking", () => {
    setup({ licences: LICENCES, profile: cleared });
    const all = rows();
    expect(all).toHaveLength(2);
    const [arc, white] = all;
    expect(arc).toHaveTextContent("ARC licence");
    expect(arc).toHaveTextContent("AU41207");
    // in date: when it lapses, quietly, off the ONE law in lib/staff/licence
    expect(arc.querySelector(".e")).toHaveTextContent("Expires 02/09/2026");
    expect(arc.querySelector(".e")).toHaveClass("mute");
    expect(white).toHaveTextContent("White card");
    expect(white.querySelector(".e")).toHaveTextContent("No expiry");
  });

  it("raises the same clause the dashboard's chip raises, in its colour, when a ticket is due", () => {
    setup({
      licences: [{ ...LICENCES[0], expiryDate: "2026-08-07" }],
      profile: cleared,
    });
    const foot = rows()[0].querySelector(".e")!;
    expect(foot).toHaveClass("warn");
    expect(foot).toHaveTextContent("Expires in 2 weeks");
  });

  it("opens Compliance from a licence row and from Manage", async () => {
    const user = userEvent.setup();
    setup({ licences: LICENCES, profile: cleared });
    await user.click(screen.getByRole("button", { name: "Open ARC licence" }));
    expect(screen.getByRole("tab", { name: /Compliance/ })).toHaveClass("on");
  });

  /* A LIST KEEPS ITS ADD. With tiles the row was never empty — the right to
     work was always in it — so the add line was the empty state and hid once
     a ticket arrived. A list of tickets still needs the way to add the next
     one, and an empty one leads with the action (law 12). */
  it("offers the way to add a ticket, empty or not, landing on the add form", async () => {
    const user = userEvent.setup();
    setup({ licences: [], profile: cleared });
    expect(rows()).toHaveLength(0);
    expect(screen.queryByText("No licences on file")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a licence or ticket" }));
    expect(screen.getByRole("tab", { name: /Compliance/ })).toHaveClass("on");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps that door once tickets are on file", () => {
    setup({ licences: LICENCES, profile: cleared });
    expect(screen.getByRole("button", { name: "Add a licence or ticket" })).toBeInTheDocument();
  });
});

describe("the vehicle, as a plate and a door", () => {
  it("reads as the plate, and opens that vehicle in Fleet", () => {
    const { container } = setup({ vehicle: VEHICLE });

    const jump = container.querySelector(".pident .vehjump") as HTMLAnchorElement;
    expect(jump).toHaveTextContent("ABC123");
    /* `?v=`, not a path segment: the app shell keys its outlet on pathname, so
       a link that writes the path remounts the page it lands on. */
    expect(jump.getAttribute("href")).toBe("/dashboard/assets?v=v1");
  });

  /* And ONLY the plate — the warnings the old panel carried live in Fleet now,
     behind the click. Isaac's call: the staff card names the vehicle, it does
     not nag about it, even when the service really is overdue. */
  it("carries no warning, even on a vehicle that has one", () => {
    const { container } = setup({
      vehicle: { ...VEHICLE, vehicle: { ...VEHICLE.vehicle, odometer: 133_500 } },
    });
    expect(container.querySelector(".pident .vehwarn")).toBeNull();
    expect(screen.queryByText(/Service overdue/)).not.toBeInTheDocument();
  });

  /* Nobody assigned, nothing said: "Unassigned" was a fact about an absence on
     a line that is a sentence about the person. */
  it("says nothing when nobody has one", () => {
    const { container } = setup({ vehicle: null });
    expect(container.querySelector(".vehjump")).toBeNull();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });
});

/* The same rule has to hold in the SECTION, not only on Summary — the cell is
   shown twice and a card that answers "NSW" in one place and "Same as
   organisation" in the other is a card that can't make its mind up. */
describe("the holiday state, in the Personal section", () => {
  it("resolves against the org there too", async () => {
    const user = userEvent.setup();
    setup({ profile: { ...jordan, state: null }, orgState: "NSW" });
    await user.click(screen.getByRole("tab", { name: /Personal/ }));

    expect(screen.getByText("NSW")).toBeInTheDocument();
    expect(screen.getByText("Organisation default")).toBeInTheDocument();
    expect(screen.queryByText("Same as organisation")).not.toBeInTheDocument();
  });

  /* With no org state there is nothing to inherit, so the row must go back to
     asking rather than printing a state nobody chose. */
  it("asks for one when the org has no state either", async () => {
    const user = userEvent.setup();
    setup({ profile: { ...jordan, state: null }, orgState: null });
    await user.click(screen.getByRole("tab", { name: /Personal/ }));

    expect(screen.getByRole("button", { name: /Add Holiday state/ })).toBeInTheDocument();
  });
});
