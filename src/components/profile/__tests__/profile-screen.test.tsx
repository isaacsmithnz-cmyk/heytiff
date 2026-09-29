import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import type { MyPay } from "@/lib/staff/my-pay";
import { ProfileScreen } from "../profile-screen";
import type { AdminExtras, PermissionsCtx, ProfileMode } from "../types";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* The staff card as a whole: what each mode may render, and — the point of
   the rewrite — that a save lands you somewhere on purpose. Since
   2026-09-29 there are no tabs: the card is the Overview, and each section
   is a form opened from it. Which sections EXIST is asked the only way that
   is left, by deep link: a section the viewer may not see cannot be opened. */

const ownerCtx: PermissionsCtx = {
  role: "staff",
  caps: resolve("staff"),
  settable: new Set(CAPABILITIES),
  canChangeRole: true,
  editable: true,
};

const MY_PAY: MyPay = {
  rate: 45,
  superPct: 12,
  superSource: "org",
  // the rules travel whole now — `up` is what a single multiplier threw away
  rules: {
    sat: { on: true, rate: 1.5, up: 2 },
    sun: { on: true, rate: 2, up: null },
    ph: { on: true, rate: 2, up: null },
    night: { on: false, rate: 2, up: null },
  },
  otAfter: 8,
  otUnit: "day",
  dblAfter: 12,
};

function setup(
  over: {
    mode?: ProfileMode;
    adminExtras?: AdminExtras;
    myPay?: MyPay | null;
    initialSec?: string;
    actions?: ReturnType<typeof okActions>;
  } = {}
) {
  const actions = over.actions ?? okActions();
  const view = render(
    <ProfileScreen
      mode={over.mode ?? "self"}
      header={header}
      profile={jordan}
      licences={[]}
      vehicle={null}
      today={TODAY} warnDays={30}
      org="Smith Air"
      adminExtras={over.adminExtras}
      myPay={over.myPay}
      initialSec={over.initialSec}
      actions={actions}
    />
  );
  return { ...view, actions };
}

/** the view a `?sec=` lands on — the section, or the Overview ("summary") */
const landsOn = (sec: string, over: Parameters<typeof setup>[0] = {}) => {
  const { unmount } = setup({ ...over, initialSec: sec });
  const got = document.querySelector(".psec2")?.getAttribute("data-sec");
  unmount();
  return got;
};
const region = (name: string) => screen.queryByRole("region", { name });

describe("self mode — My profile", () => {
  it("omits the admin-only sections entirely", () => {
    for (const sec of ["payroll", "permissions", "notes"]) expect(landsOn(sec)).toBe("summary");
    setup();
    for (const name of ["Payroll", "Permissions", "Notes"]) expect(region(name)).toBeNull();
  });

  it("ignores adminExtras even if a caller passes them", () => {
    // mode is the gate, not the props — the self allowlist has no such columns
    const extras = { adminExtras: { payroll: { hourly_wage: 40 }, permissions: ownerCtx, notes: { notes: "x" } } };
    expect(landsOn("payroll", extras)).toBe("summary");
    expect(landsOn("permissions", extras)).toBe("summary");
  });

  it("carries My pay, and drops it when there is no pay payload", () => {
    expect(landsOn("mypay", { myPay: MY_PAY })).toBe("mypay");
    expect(landsOn("mypay", { myPay: null })).toBe("summary");
    setup({ myPay: MY_PAY });
    expect(region("My pay")).toBeInTheDocument();
  });

  it("puts Change on the Email row it already had", async () => {
    /* The address lives with your details, which is where it always was —
       what changed is that the row now says how to move it. */
    setup({ initialSec: "personal" });
    expect(screen.getByRole("button", { name: /^Change$/ })).toBeInTheDocument();
  });

  it("has no section for the sign-in address", () => {
    /* It had one, briefly, holding a single read-only row that Personal
       already showed. The row opens a dialog instead (Isaac, 2026-09-01). */
    expect(landsOn("signin")).toBe("summary");
  });

  it("shows a My profile breadcrumb, not the Team trail", () => {
    setup();
    expect(screen.getByText("My profile")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });
});

describe("admin mode — Team", () => {
  it("NEVER offers to change the sign-in address on somebody else’s card", async () => {
    /* `changeMySignInEmail` moves whoever the SESSION is, so this control on
       an admin's view of a colleague would change the admin's own address
       while showing the colleague's name. The screen withholds the action;
       Personal renders the button only when handed one. Asserted IN the
       Personal section, where the Email row renders. */
    setup({ mode: "admin", adminExtras: { payroll: {}, permissions: ownerCtx, notes: {} }, initialSec: "personal" });
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Change$/ })).toBeNull();
  });

  it("opens an admin section only when the page passed it", () => {
    const all = { mode: "admin" as const, adminExtras: { payroll: {}, permissions: ownerCtx, notes: {} } };
    expect(landsOn("payroll", all)).toBe("payroll");
    expect(landsOn("permissions", all)).toBe("permissions");
    expect(landsOn("notes", all)).toBe("notes");
  });

  it("omits Payroll entirely without `financials` — not rendered then hidden", () => {
    const some = { mode: "admin" as const, adminExtras: { permissions: ownerCtx, notes: {} } };
    expect(landsOn("payroll", some)).toBe("summary");
    expect(landsOn("permissions", some)).toBe("permissions");
    setup(some);
    expect(region("Payroll")).toBeNull();
    // and nobody is asked for a wage they may not see
    expect(screen.queryByRole("button", { name: "Add pay" })).not.toBeInTheDocument();
  });

  it("omits Notes when looking at your own card", () => {
    expect(landsOn("notes", { mode: "admin", adminExtras: { permissions: ownerCtx } })).toBe("summary");
  });

  it("renders no admin sections at all when none are passed", () => {
    setup({ mode: "admin" });
    for (const name of ["Payroll", "Permissions", "Notes"]) expect(region(name)).toBeNull();
    expect(screen.queryByRole("button", { name: "Write a note" })).not.toBeInTheDocument();
  });

  it("never shows My pay — someone else's rates are the Payroll card's job", () => {
    expect(landsOn("mypay", { mode: "admin", adminExtras: { payroll: {}, permissions: ownerCtx }, myPay: MY_PAY })).toBe("summary");
    setup({ mode: "admin", adminExtras: { payroll: {}, permissions: ownerCtx }, myPay: MY_PAY });
    expect(region("My pay")).toBeNull();
  });

  it("shows the Team breadcrumb", () => {
    setup({ mode: "admin" });
    expect(screen.getAllByRole("link", { name: /Team|Staff/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Jordan Mills");
  });

  /* It read `Team / Staff / name` with BOTH crumbs pointing at /dashboard/team.
     A breadcrumb claims depth, so a step that doesn't step misdescribes where
     you are — and the second was the same click as the first. */
  it("has one crumb per level, not two links to the same place", () => {
    setup({ mode: "admin" });
    const hrefs = [...document.querySelectorAll<HTMLAnchorElement>(".crumb a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/dashboard/team"]);
  });

  /* The admin-only cards say so in words, not with a glyph. */
  it("says the admin-only cards are restricted", () => {
    setup({ mode: "admin", adminExtras: { permissions: ownerCtx, notes: { notes: "x" } } });
    for (const name of ["Permissions", "Notes"]) {
      expect(region(name)!.querySelector(".pov-adm")).toHaveTextContent("Admin only");
    }
  });
});

describe("opening section", () => {
  it("opens the Overview by default", () => {
    setup();
    expect(document.querySelector(".psec2")).toHaveAttribute("data-sec", "summary");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("opens the section named by ?sec=", () => {
    expect(landsOn("workrights")).toBe("workrights");
  });

  it("ignores a ?sec= the viewer isn't allowed", () => {
    // a staff member can't be deep-linked into someone's payroll
    expect(landsOn("payroll")).toBe("summary");
  });

  it("ignores a ?sec= that isn't a section at all", () => {
    expect(landsOn("../etc/passwd")).toBe("summary");
  });

  /* Retired keys land on the Overview, where their facts went, rather than
     falling through as unknown values would: the vehicle tab (its plate is in
     the head) and Training (a placeholder that went with the tabs). */
  it("lands retired ?sec= links on the Overview", () => {
    expect(landsOn("vehicle")).toBe("summary");
    expect(landsOn("training")).toBe("summary");
  });
});

describe("dates", () => {
  it("renders stored ISO dates back as dd/mm/yyyy", () => {
    setup({ mode: "admin" });
    expect(screen.getByText("01/06/2020")).toBeInTheDocument(); // start date, in the strip
    expect(screen.getByText("25/12/1990")).toBeInTheDocument(); // birthday, on Personal
  });
});

describe("a save lands you on purpose — the bug this rewrite exists to kill", () => {
  /* The old screen snapped back to Personal with every card re-locked when a
     save revalidated. Now the view is state above the data: a save that the
     server re-renders changes VALUES, and the only move is the one the form
     asks for — back to the Overview, showing what was saved. */
  it("comes back to the Overview after a save, and a revalidation doesn't move it", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    const { rerender } = setup({ actions });

    await user.click(screen.getByRole("button", { name: "Edit emergency contact" }));
    const name = screen.getByDisplayValue("Sarah Mills");
    await user.clear(name);
    await user.type(name, "Sam Mills");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(actions.onSave).toHaveBeenCalledWith(
      "emergency",
      expect.objectContaining({ emergency_name: "Sam Mills" })
    );

    // the action revalidated, so the server re-rendered with the new values
    rerender(
      <ProfileScreen
        mode="self"
        header={header}
        profile={{ ...jordan, emergency_name: "Sam Mills" }}
        licences={[]}
        vehicle={null}
        today={TODAY} warnDays={30}
        org="Smith Air"
        actions={actions}
      />
    );

    expect(document.querySelector(".psec2")).toHaveAttribute("data-sec", "summary");
    expect(screen.getByRole("region", { name: "Emergency contact" })).toHaveTextContent("Sam Mills");
    expect(screen.queryByDisplayValue("Sam Mills")).not.toBeInTheDocument();
  });

  it("keeps you on a section opened by link until you leave it", async () => {
    const user = userEvent.setup();
    setup({ initialSec: "licences" });
    // the licence wall is several things to manage, not one form: it has no Done
    expect(document.querySelector(".psec2")).toHaveAttribute("data-sec", "licences");
    await user.click(screen.getByRole("button", { name: "My profile" }));
    expect(document.querySelector(".psec2")).toHaveAttribute("data-sec", "summary");
  });

  it("submits only the keys that section's allowlist accepts", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup({ actions });

    await user.click(screen.getByRole("button", { name: "Edit Personal" }));
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    const [section, fields] = actions.onSave.mock.calls[0];
    expect(section).toBe("personal");
    expect(Object.keys(fields).sort()).toEqual([
      "address",
      "birthday",
      // the uniform sizes ride the personal section — same save, same
      // allowlist, no extra round trip. `boot_scale` is the picked half of the
      // boot size, saved with it. See lib/staff/uniform.ts.
      "boot_scale",
      "boot_size",
      "employment_type",
      "first_name",
      "jacket_size",
      "last_name",
      "phone",
      "preferred_name",
      "shirt_size",
      "start_date",
      "status",
      "trousers_size",
    ]);
  });

  it("lets an admin set the job title, which the admin allowlist allows", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup({ mode: "admin", actions });

    await user.click(screen.getByRole("button", { name: "Edit Personal" }));
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    const [, fields] = actions.onSave.mock.calls[0];
    expect(fields).toHaveProperty("job_title", "Lead Installer");
  });
});
