import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffLicence } from "@/lib/staff/types";
import type { StaffProfile } from "@/lib/staff/profile";
import { ProfileScreen } from "../profile-screen";
import type { AdminExtras, AssignedVehicle, PermissionsCtx, ProfileMode } from "../types";
import { TODAY, blankProfile, header, jordan, okActions } from "./fixtures/staff";

/* The Overview — the staff card on one screen, since 2026-09-29.

   Three rules built it and each is pinned here. A SECTION APPEARS ONCE IT HAS
   SOMETHING IN IT: a card never shows a blank row. EVERY BLANK IS SAID ONCE,
   in Still to add, in the group it belongs to. And EVERY DOOR OPENS A FORM:
   a card's Edit, and each Add, opens its section straight into edit mode,
   and saving or cancelling comes back here. */

/* FULLY TYPED, and that is the point of it. An earlier fixture went in through
   `as unknown as` and spelled two fields wrong; nothing caught it because the
   cast turned the compiler off. */
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
  { id: "l1", typeName: "ARC licence", licenceNumber: "AU41207", expiryDate: "2026-09-02", color: "#00A389" },
  { id: "l2", typeName: "White card", licenceNumber: null, expiryDate: null, color: null },
];

const PERMS: PermissionsCtx = {
  role: "staff",
  caps: new Set(["workboard", "toolbox"]),
  settable: new Set(),
  canChangeRole: true,
  editable: true,
};

const PAY: NonNullable<AdminExtras["payroll"]> = {
  hourly_wage: 42.5,
  pay_basis: "hourly",
  contracted_hours: 38,
  utilisation: 85,
  cost_split: { install: 60, service: 30, admin: 10 },
};

/* every field the completeness model counts, so nothing is left to add */
const complete: StaffProfile = {
  ...jordan,
  work_rights_status: "Australian citizen",
  photo_url: "staff/p1.jpg",
  shirt_size: "L",
};

function setup(
  over: {
    mode?: ProfileMode;
    licences?: StaffLicence[];
    vehicle?: AssignedVehicle | null;
    orgState?: string | null;
    profile?: StaffProfile;
    header?: typeof header;
    adminExtras?: AdminExtras;
    hasSignature?: boolean;
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
      today={TODAY}
      warnDays={30}
      org="Smith Air"
      // `in`, not `??` — passing null explicitly means "the org has no state"
      orgState={"orgState" in over ? over.orgState! : "NSW"}
      adminExtras={over.adminExtras}
      hasSignature={over.hasSignature}
      actions={actions}
    />
  );
  return { ...view, actions };
}

const card = (title: string) => screen.getByRole("region", { name: title });
const openSection = () => document.querySelector(".psec2")?.getAttribute("data-sec");
const isEditing = () => screen.queryByRole("button", { name: /^Save\b/ }) !== null;
const todo = (group: "Required" | "Optional") =>
  [...(screen.queryByRole("group", { name: group })?.querySelectorAll(".pov-ti b") ?? [])].map((b) => b.textContent);

describe("no tabs", () => {
  it("opens on the Overview, with no tab row at all", () => {
    setup();
    expect(openSection()).toBe("summary");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("the head", () => {
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

  /* The person's own hue behind their initials, the Team directory's hue
     darkened for white type — a custom property, never `background`. */
  it("paints the initials' tile in the person's own colour", () => {
    const { container } = setup();
    const tile = container.querySelector(".pident .pphoto") as HTMLElement;
    expect(tile.style.getPropertyValue("--av")).toMatch(/^hsl\(\d+ 62% 34%\)$/);
    expect(tile.style.background).toBe("");
  });

  it("shows the van as a large plate that opens it in Fleet", () => {
    const { container } = setup({ vehicle: VEHICLE });
    const jump = container.querySelector(".pov-van .vehjump") as HTMLAnchorElement;
    expect(jump).toHaveTextContent("ABC123");
    expect(jump.querySelector(".au-plate")).toHaveClass("lg");
    /* `?v=`, not a path segment: the app shell keys its outlet on pathname. */
    expect(jump.getAttribute("href")).toBe("/dashboard/assets?v=v1");
  });

  /* Isaac's call, still: the card names the vehicle, it does not nag. */
  it("carries no vehicle warning, and nothing at all when nobody has one", () => {
    setup({ vehicle: { ...VEHICLE, vehicle: { ...VEHICLE.vehicle, odometer: 133_500 } } });
    expect(screen.queryByText(/Service overdue/)).not.toBeInTheDocument();
  });

  it("says nothing about a van nobody has", () => {
    const { container } = setup({ vehicle: null });
    expect(container.querySelector(".pov-van")).toBeNull();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });
});

describe("the record line", () => {
  /* "N of 11 on file" is a fact about the screen, not the person, and a
     complete record is the normal state of a card. Isaac: "if 11 out of 11
     is on file then that can disappear". */
  it("goes when the record is complete", () => {
    const { container } = setup({ profile: complete, header: { ...header, photoUrl: "https://x/y.jpg" } });
    expect(container.querySelector(".pov-rec")).toBeNull();
    expect(screen.queryByText(/on file/)).not.toBeInTheDocument();
  });

  it("counts what is on file, and its one button opens the first required gap", async () => {
    const user = userEvent.setup();
    setup({ profile: { ...jordan, birthday: null } });
    // work rights and the photo are missing as well; the photo is not required
    expect(screen.getByText("8 of 11 on file")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add the 2 required details" }));
    expect(openSection()).toBe("personal");
    expect(isEditing()).toBe(true);
    expect(document.getElementById("birthday")).toHaveFocus();
  });
});

describe("the strip", () => {
  it("holds the facts you look up most, and only the ones on file", () => {
    const { container } = setup({ profile: { ...jordan, phone: null } });
    const strip = container.querySelector(".pov-strip") as HTMLElement;
    const labels = [...strip.querySelectorAll("dt")].map((d) => d.textContent);
    expect(labels).toEqual(["Email", "Started", "Employment"]);
    expect(strip).toHaveTextContent("01/06/2020");
  });
});

describe("a section appears once it has something in it", () => {
  it("shows Personal with only the rows on file", () => {
    setup({ profile: { ...jordan, address: null } });
    const labels = [...card("Personal").querySelectorAll("dt")].map((d) => d.textContent);
    expect(labels).toEqual(["Date of birth", "Holiday state"]);
    expect(within(card("Personal")).getByText("25/12/1990")).toBeInTheDocument();
    expect(card("Personal")).not.toHaveTextContent("—");
  });

  it("has no Personal card at all while there is nothing of the person's in it", () => {
    setup({ profile: { ...jordan, birthday: null, address: null } });
    expect(screen.queryByRole("region", { name: "Personal" })).not.toBeInTheDocument();
  });

  /* A new starter's card is a header, a strip and a checklist — no grid of
     dashes and Adds. */
  it("gives a new starter a checklist, not a page of empty boxes", () => {
    setup({ profile: { ...blankProfile, first_name: "Sam", last_name: "Taylor" } });
    for (const name of ["Personal", "Emergency contact", "Work rights", "Licences and tickets"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    expect(card("Still to add")).toBeInTheDocument();
    expect(screen.queryByLabelText("not recorded")).not.toBeInTheDocument();
  });
});

describe("Still to add — every blank, once", () => {
  it("splits what the business must hold from what it would like", () => {
    setup({ profile: { ...blankProfile, first_name: "Sam", last_name: "Taylor" } });
    expect(todo("Required")).toEqual(["Personal details", "Work rights"]);
    expect(todo("Optional")).toEqual([
      "Mobile number",
      "Emergency contact",
      "Licences and tickets",
      "Uniform sizes",
      "Photo",
    ]);
    // the Personal row names what it is short of
    expect(card("Still to add")).toHaveTextContent("Date of birth, address, start date, employment type");
  });

  it("asks for a wage only of the person who can see pay", () => {
    setup({ adminExtras: { payroll: { hourly_wage: null } } });
    expect(todo("Required")).toContain("Pay");
  });

  it("asks for your signature until you've drawn one, on your own card only", async () => {
    setup({ mode: "self", hasSignature: false });
    expect(todo("Optional")).toContain("Signature");
    await userEvent.click(screen.getByRole("button", { name: "Add signature" }));
    expect(openSection()).toBe("licences");
    /* opens on the Signature card, not on a new licence */
    expect(document.getElementById("profile-signature")).toHaveTextContent("Printed on the certificates you sign");
    /* the add-a-licence dialog stays shut */
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("doesn't ask for a signature once it's drawn, or on someone else's card", () => {
    const { unmount } = setup({ mode: "self", hasSignature: true });
    expect(todo("Optional")).not.toContain("Signature");
    unmount();
    setup({ mode: "admin", hasSignature: false });
    expect(todo("Optional")).not.toContain("Signature");
  });

  it("is not there when nothing is missing", () => {
    setup({
      profile: complete,
      header: { ...header, photoUrl: "https://x/y.jpg" },
      licences: LICENCES,
    });
    expect(screen.queryByRole("region", { name: "Still to add" })).not.toBeInTheDocument();
  });

  it("opens the form on the field a row names", async () => {
    const user = userEvent.setup();
    setup({ profile: { ...jordan, emergency_phone: null } });
    await user.click(screen.getByRole("button", { name: "Add emergency contact" }));
    expect(openSection()).toBe("emergency");
    expect(isEditing()).toBe(true);
    expect(document.getElementById("emergency_phone")).toHaveFocus();
  });

  it("lands a missing ticket on the add form", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add licences and tickets" }));
    expect(openSection()).toBe("licences");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("the emergency contact", () => {
  it("wears the red head, with the name and the number to dial", () => {
    setup();
    const sos = card("Emergency contact");
    expect(sos).toHaveClass("pov-sos");
    expect(sos.querySelector(".pov-sosh")).toHaveTextContent("Emergency contact");
    expect(sos.querySelector(".pov-who")).toHaveTextContent("Sarah Mills");
    expect(sos.querySelector(".pov-tel")).toHaveTextContent("0411 111 111");
    expect(sos).toHaveTextContent("Partner");
  });

  it("opens its form from Edit, and comes back here when saved", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: "Edit emergency contact" }));
    expect(openSection()).toBe("emergency");
    expect(isEditing()).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Save\b/ }));
    expect(actions.onSave).toHaveBeenCalled();
    expect(openSection()).toBe("summary");
  });

  it("comes back on Cancel too, having saved nothing", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: "Edit Personal" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(openSection()).toBe("summary");
    expect(actions.onSave).not.toHaveBeenCalled();
  });
});

describe("work rights", () => {
  it("reads as the answer and its evidence", () => {
    setup({ profile: { ...jordan, work_rights_status: "Australian citizen" } });
    const wr = card("Work rights");
    expect(wr.querySelector(".pov-line")).toHaveTextContent("Australian citizen");
    expect(wr.querySelector(".pov-line")).toHaveClass("ok");
    expect(wr).toHaveTextContent("Full working rights");
  });

  it("warns on a visa inside the window, in the dashboard chip's words", () => {
    setup({
      profile: {
        ...jordan,
        work_rights_status: "Temporary visa",
        visa_type: "482",
        visa_expiry: "2026-08-07",
      },
    });
    const wr = card("Work rights");
    expect(wr.querySelector(".pov-line")).toHaveClass("warn");
    expect(wr).toHaveTextContent("482: expires in 2 weeks");
  });
});

describe("the licences", () => {
  it("are the Compliance wall's plastic cards, each a door to it", async () => {
    const user = userEvent.setup();
    setup({ licences: LICENCES });
    const band = card("Licences and tickets");
    expect(band.querySelectorAll(".idc")).toHaveLength(2);
    expect(band).toHaveTextContent("AU41207");
    await user.click(screen.getByRole("button", { name: "Open ARC licence" }));
    expect(openSection()).toBe("licences");
  });
});

describe("the holiday state", () => {
  it("resolves an unset one against the org rather than describing it", () => {
    setup({ profile: { ...jordan, state: null }, orgState: "NSW" });
    expect(within(card("Personal")).getByText("NSW")).toBeInTheDocument();
    expect(within(card("Personal")).getByText("Organisation default")).toBeInTheDocument();
    expect(screen.queryByText("Same as organisation")).not.toBeInTheDocument();
  });

  it("shows an override as itself", () => {
    setup({ profile: { ...jordan, state: "VIC" } });
    expect(within(card("Personal")).getByText("VIC")).toBeInTheDocument();
    expect(within(card("Personal")).queryByText("Organisation default")).not.toBeInTheDocument();
  });

  it("is an admin row — your own card doesn't set which state pays you", () => {
    setup({ mode: "self" });
    expect(screen.queryByText("Holiday state")).not.toBeInTheDocument();
  });
});

describe("money is hidden until asked for", () => {
  /* "just in case someone walks past" — the wage is not in the page at all
     until Show wage, and Hide takes it away again. */
  it("keeps the wage off the screen until Show wage, and Hide puts it back", async () => {
    const user = userEvent.setup();
    setup({ adminExtras: { payroll: PAY } });
    const pay = card("Payroll");
    expect(pay).not.toHaveTextContent("$42.50");

    await user.click(within(pay).getByRole("button", { name: "Show wage" }));
    expect(pay).toHaveTextContent("$42.50");

    await user.click(within(pay).getByRole("button", { name: "Hide wage" }));
    expect(pay).not.toHaveTextContent("$42.50");
  });

  it("draws the cost split as one bar, with each share said", () => {
    setup({ adminExtras: { payroll: PAY } });
    const pay = card("Payroll");
    expect(pay.querySelectorAll(".pov-sbar i")).toHaveLength(3);
    expect(pay.querySelector(".pov-slg")).toHaveTextContent("60% Install30% Service10% Admin");
    expect(pay).toHaveTextContent("38 a week");
  });

  it("hides your own rate on My profile the same way", async () => {
    const user = userEvent.setup();
    render(
      <ProfileScreen
        mode="self"
        header={header}
        profile={jordan}
        licences={[]}
        vehicle={null}
        today={TODAY}
        warnDays={30}
        org="Smith Air"
        myPay={{ rate: 40, superPct: 12, superSource: "org" } as never}
        actions={okActions()}
      />
    );
    const mine = card("My pay");
    expect(mine).not.toHaveTextContent("$40.00");
    await user.click(within(mine).getByRole("button", { name: "Show pay rate" }));
    expect(mine).toHaveTextContent("$40.00");
  });
});

describe("the admin column", () => {
  it("says who a person is to the app, and opens Permissions to change it", async () => {
    const user = userEvent.setup();
    setup({ adminExtras: { permissions: PERMS } });
    const perms = card("Permissions");
    expect(perms).toHaveTextContent("Staff");
    expect(perms).toHaveTextContent("2 of 14 areas");
    await user.click(within(perms).getByRole("button", { name: "Edit Permissions" }));
    expect(openSection()).toBe("permissions");
    expect(isEditing()).toBe(true);
  });

  it("shows a note that is there, and offers to write one that isn't", () => {
    const { unmount } = setup({ adminExtras: { notes: { notes: "Has his own ladder rack." } } });
    expect(card("Notes")).toHaveTextContent("Has his own ladder rack.");
    unmount();
    setup({ adminExtras: { notes: { notes: null } } });
    expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write a note" })).toBeInTheDocument();
  });

  it("is not there on your own card", () => {
    setup({ mode: "self", adminExtras: { payroll: PAY, permissions: PERMS, notes: { notes: "x" } } });
    for (const name of ["Payroll", "Permissions", "Notes"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
  });
});

describe("the breadcrumb is the way back", () => {
  it("grows a step while a section is open, and the person's name returns", async () => {
    const user = userEvent.setup();
    const { container } = setup({ licences: LICENCES });
    await user.click(screen.getByRole("button", { name: "Open ARC licence" }));
    const crumb = container.querySelector(".crumb") as HTMLElement;
    expect(crumb).toHaveTextContent("Team/Jordan Mills/Licences and tickets");

    await user.click(within(crumb).getByRole("button", { name: "Jordan Mills" }));
    expect(openSection()).toBe("summary");
  });
});
