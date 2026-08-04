import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffLicence } from "@/lib/staff/types";
import { ProfileScreen } from "../profile-screen";
import type { AssignedVehicle, ProfileMode } from "../types";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* Summary — the landing tab, and the two rules that built it.

   ONE PANEL PER TAB, in tab order, named the same, each opening the tab it
   overviews. IF THE IDENTITY BLOCK SAYS IT, A PANEL DOESN'T. The second rule
   is the one worth pinning: it is easy to add a row back to Personal without
   noticing the block three inches above already says it, and that is exactly
   how this screen got to a screen and a half of scrolling the first time. */

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

function setup(
  over: {
    mode?: ProfileMode;
    licences?: StaffLicence[];
    vehicle?: AssignedVehicle | null;
    orgState?: string | null;
    profile?: typeof jordan;
  } = {}
) {
  const actions = okActions();
  const view = render(
    <ProfileScreen
      mode={over.mode ?? "admin"}
      header={header}
      profile={over.profile ?? jordan}
      licences={over.licences ?? []}
      vehicle={over.vehicle ?? null}
      today={TODAY}
      org="Smith Air"
      // `in`, not `??` — passing null explicitly means "the org has no state",
      // and `?? "NSW"` would quietly give it one
      orgState={"orgState" in over ? over.orgState! : "NSW"}
      actions={actions}
    />
  );
  return { ...view, actions };
}

/* `.pdlh > span` — the DIRECT child. The jump button carries a screen-reader
   span naming the same panel ("Open Work rights"), so a descendant selector
   matches the heading twice. */
const panel = (title: string) =>
  screen.getByText(title, { selector: ".pdlh > span" }).closest(".pdlcard") as HTMLElement;

describe("what Summary does not repeat", () => {
  /* Name, role and status are the identity block's, so no panel carries them —
     which is why Personal opens on Date of birth rather than on First name. */
  it("leaves the identity block's facts to the identity block", () => {
    const { container } = setup();

    expect(container.querySelector(".pident h1")).toHaveTextContent("Jordan Mills");
    const personal = panel("Personal");
    expect(within(personal).queryByText("First name")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Last name")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Job title")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Status")).not.toBeInTheDocument();
    expect(within(personal).queryByText("Start date")).not.toBeInTheDocument();
    // and it opens on what the block can't say
    expect(within(personal).getByText("Date of birth")).toBeInTheDocument();
  });

  it("says the role once, without the org's name after it", () => {
    const { container } = setup();
    const sub = container.querySelector(".pident .sub");
    expect(sub).toHaveTextContent("Lead Installer");
    // the org is the issuer line on every licence card; it adds nothing here
    expect(sub).not.toHaveTextContent("Smith Air");
  });

  /* The block's Vehicle fact was the whole story while nothing is assigned, so
     the panel that would only have said "—" isn't rendered at all. */
  it("gives the vehicle a panel only once there is one", () => {
    setup({ vehicle: null });
    expect(screen.queryByText("Assigned vehicle", { selector: ".pdlh > span" })).not.toBeInTheDocument();
  });
});

describe("blanks", () => {
  /* Nothing on Summary is editable, so a blank has no button behind it and
     nothing to say beyond "nothing". Eight "Not set"s down one column read as
     an error state rather than as a card someone hasn't finished. */
  it("reads as a dash, not as 'Not set'", () => {
    setup({ profile: { ...jordan, emergency_name: null } });
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    const emergency = panel("Emergency");
    expect(within(emergency).getAllByLabelText("not recorded").length).toBeGreaterThan(0);
  });
});

describe("the holiday state", () => {
  /* "Same as organisation" is a sentence about a setting. The question is
     which public holidays this person is paid for, and the org's own state is
     the answer. */
  it("resolves an unset one against the org rather than describing it", () => {
    setup({ profile: { ...jordan, state: null }, orgState: "NSW" });
    const personal = panel("Personal");
    expect(within(personal).getByText("NSW")).toBeInTheDocument();
    expect(within(personal).getByText("Organisation default")).toBeInTheDocument();
    expect(screen.queryByText("Same as organisation")).not.toBeInTheDocument();
  });

  it("shows an override as itself, with no qualifier", () => {
    setup({ profile: { ...jordan, state: "VIC" }, orgState: "NSW" });
    const personal = panel("Personal");
    expect(within(personal).getByText("VIC")).toBeInTheDocument();
    expect(within(personal).queryByText("Organisation default")).not.toBeInTheDocument();
  });

  it("is an admin row — your own card doesn't set which state pays you", () => {
    setup({ mode: "self" });
    expect(screen.queryByText("Holiday state")).not.toBeInTheDocument();
  });
});

describe("the licence wall", () => {
  it("renders every licence as a card, with the expiry doing the talking", () => {
    setup({ licences: LICENCES });
    const wall = panel("Licences & tickets");
    expect(wall.querySelectorAll(".idc")).toHaveLength(2);
    expect(within(wall).getByText("ARC licence")).toBeInTheDocument();
    // the status comes from the ONE law in lib/staff/licence, not from
    // anything this panel worked out for itself
    expect(within(wall).getByText("02/09/2026")).toBeInTheDocument();
    expect(within(wall).getByText("No expiry")).toBeInTheDocument();
  });

  /* Three of these sit side by side, so the card had to survive being one of a
     wall. The issuer said the same business name on every card and took the
     width the facts wanted; the status was a third fact long enough to wrap
     one card's row and not its neighbours. */
  it("carries no issuer line — every card would say the same business name", () => {
    setup({ licences: LICENCES });
    const wall = panel("Licences & tickets");
    expect(wall.querySelector(".idc-org")).toBeNull();
    expect(within(wall).queryByText("Smith Air")).not.toBeInTheDocument();
  });

  it("puts the status in a pill, leaving two facts that line up across cards", () => {
    setup({ licences: LICENCES });
    const wall = panel("Licences & tickets");

    const pills = [...wall.querySelectorAll(".idc-state")].map((p) => p.textContent);
    expect(pills).toEqual(["Valid", "No expiry"]);

    // every card is left with the same two facts, in the same two columns
    for (const card of wall.querySelectorAll(".idc")) {
      expect([...card.querySelectorAll(".idc-facts .f em")].map((e) => e.textContent)).toEqual([
        "Licence no.",
        "Expires",
      ]);
    }
  });

  it("says so plainly when there are none, and points at Compliance", () => {
    setup({ licences: [] });
    const wall = panel("Licences & tickets");
    expect(within(wall).getByText("No licences on file")).toBeInTheDocument();
    expect(wall.querySelectorAll(".idc")).toHaveLength(0);
  });
});

describe("a panel opens its tab", () => {
  it("drives the card without touching the tab strip", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(panel("Work rights")).getByRole("button", { name: /Open/ }));

    expect(screen.getByRole("tab", { name: /Work rights/ })).toHaveClass("on");
    // read mode — opening a section is not the same as asking to edit it
    expect(screen.queryByRole("button", { name: /^Save\b/ })).not.toBeInTheDocument();
  });

  it("has no jump on a panel that isn't a tab", () => {
    setup({
      vehicle: {
        vehicle: {
          id: "v1",
          plate: "ABC123",
          plateState: "NSW",
          make: "Toyota",
          model: "Hilux",
          odometer: 82000,
          serviceEveryKm: 10000,
          lastServiceKm: 78000,
          regoDays: 120,
        } as unknown as AssignedVehicle["vehicle"],
        openIssues: 0,
        lastFuel: null,
      },
    });
    const v = panel("Assigned vehicle");
    expect(within(v).queryByRole("button", { name: /Open/ })).not.toBeInTheDocument();
    expect(within(v).getByText("from Fleet")).toBeInTheDocument();
  });
});

/* The same rule has to hold in the SECTION, not only on Summary — the row is
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

    expect(screen.getByRole("button", { name: /Set Holiday state/ })).toBeInTheDocument();
  });
});
