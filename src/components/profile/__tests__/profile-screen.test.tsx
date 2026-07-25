import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import type { MyPay } from "@/lib/staff/my-pay";
import { ProfileScreen } from "../profile-screen";
import type { AdminExtras, PermissionsCtx, ProfileMode } from "../types";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* The staff card as a whole: what each mode may render, and — the point of
   the rewrite — that a save doesn't move you. */

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
  otMultiplier: 1.5,
  dblMultiplier: 2,
  superSource: "org",
  weekend: { sat: 1.5, sun: 2 },
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
      today={TODAY}
      org="Smith Air"
      adminExtras={over.adminExtras}
      myPay={over.myPay}
      initialSec={over.initialSec}
      actions={actions}
    />
  );
  return { ...view, actions };
}

const navLabels = () =>
  screen.getAllByRole("button").filter((b) => b.classList.contains("pn")).map((b) => b.textContent);

describe("self mode — My profile", () => {
  it("omits the admin-only sections entirely, nav included", () => {
    setup();
    for (const label of ["Payroll", "Permissions", "Notes & flags"]) {
      expect(navLabels()).not.toContain(label);
    }
    expect(screen.queryByText("Admin only")).not.toBeInTheDocument();
  });

  it("ignores adminExtras even if a caller passes them", () => {
    // mode is the gate, not the props — the self allowlist has no such columns
    setup({ adminExtras: { payroll: {}, permissions: ownerCtx, notes: {} } });
    expect(navLabels()).not.toContain("Payroll");
    expect(navLabels()).not.toContain("Permissions");
  });

  it("keeps the six self-editable sections and adds My pay", () => {
    setup({ myPay: MY_PAY });
    for (const label of [
      "Personal details",
      "Emergency contact",
      "Compliance",
      "Work rights",
      "Assigned vehicle",
      "Training",
      "My pay",
    ]) {
      expect(navLabels()).toContain(label);
    }
  });

  it("drops My pay from the nav when there is no pay payload", () => {
    setup({ myPay: null });
    expect(navLabels()).not.toContain("My pay");
  });

  it("shows a My profile breadcrumb, not the Team trail", () => {
    setup();
    expect(screen.getByText("My profile")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });
});

describe("admin mode — Team", () => {
  it("renders an admin section only when the page passed it", () => {
    setup({ mode: "admin", adminExtras: { payroll: {}, permissions: ownerCtx, notes: {} } });
    expect(navLabels()).toContain("Payroll");
    expect(navLabels()).toContain("Permissions");
    expect(navLabels()).toContain("Notes & flags");
    expect(screen.getByText("Admin only")).toBeInTheDocument();
  });

  it("omits Payroll entirely without `financials` — not rendered then hidden", () => {
    setup({ mode: "admin", adminExtras: { permissions: ownerCtx, notes: {} } });
    expect(navLabels()).not.toContain("Payroll");
    expect(navLabels()).toContain("Permissions");
  });

  it("omits Notes when looking at your own card", () => {
    setup({ mode: "admin", adminExtras: { permissions: ownerCtx } });
    expect(navLabels()).not.toContain("Notes & flags");
  });

  it("renders no admin sections at all when none are passed", () => {
    setup({ mode: "admin" });
    for (const label of ["Payroll", "Permissions", "Notes & flags"]) {
      expect(navLabels()).not.toContain(label);
    }
  });

  it("never shows My pay — someone else's rates are the Payroll card's job", () => {
    setup({ mode: "admin", adminExtras: { payroll: {}, permissions: ownerCtx }, myPay: MY_PAY });
    expect(navLabels()).not.toContain("My pay");
    expect(screen.queryByText("Base rate")).not.toBeInTheDocument();
  });

  it("shows the Team breadcrumb", () => {
    setup({ mode: "admin" });
    expect(screen.getAllByRole("link", { name: /Team|Staff/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Jordan Mills");
  });
});

describe("opening section", () => {
  it("opens Personal by default", () => {
    setup();
    expect(screen.getByRole("button", { name: /Emergency contact/ })).not.toHaveClass("on");
    expect(screen.getByRole("button", { name: /Personal details/ })).toHaveClass("on");
  });

  it("opens the section named by ?sec=", () => {
    setup({ initialSec: "workrights" });
    expect(screen.getByRole("button", { name: /Work rights/ })).toHaveClass("on");
  });

  it("ignores a ?sec= the viewer isn't allowed", () => {
    // a staff member can't be deep-linked into someone's payroll
    setup({ initialSec: "payroll" });
    expect(screen.getByRole("button", { name: /Personal details/ })).toHaveClass("on");
  });

  it("ignores a ?sec= that isn't a section at all", () => {
    setup({ initialSec: "../etc/passwd" });
    expect(screen.getByRole("button", { name: /Personal details/ })).toHaveClass("on");
  });
});

describe("dates", () => {
  it("renders stored ISO dates back as dd/mm/yyyy", () => {
    setup();
    expect(screen.getByText("01/06/2020")).toBeInTheDocument(); // start date
    expect(screen.getByText("25/12/1990")).toBeInTheDocument(); // birthday
  });
});

describe("a save does not move you — the bug this rewrite exists to kill", () => {
  it("stays on the section you saved from, with every card back in read mode", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    const { rerender } = setup({ actions });

    await user.click(screen.getByRole("button", { name: /Emergency contact/ }));
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    const name = screen.getByDisplayValue("Sarah Mills");
    await user.clear(name);
    await user.type(name, "Sam Mills");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(actions.onSave).toHaveBeenCalledWith(
      "emergency",
      expect.objectContaining({ emergency_name: "Sam Mills" })
    );

    // the action revalidated, so the server re-rendered with the new values —
    // exactly what used to slam the screen back to Personal
    rerender(
      <ProfileScreen
        mode="self"
        header={header}
        profile={{ ...jordan, emergency_name: "Sam Mills" }}
        licences={[]}
        vehicle={null}
        today={TODAY}
        org="Smith Air"
        actions={actions}
      />
    );

    expect(screen.getByRole("button", { name: /Emergency contact/ })).toHaveClass("on");
    expect(screen.getByRole("button", { name: /Personal details/ })).not.toHaveClass("on");
    // and the card it saved is locked again, showing the new value
    expect(screen.getByText("Sam Mills")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Sam Mills")).not.toBeInTheDocument();
  });

  it("submits only the keys that section's allowlist accepts", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup({ actions });

    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    const [section, fields] = actions.onSave.mock.calls[0];
    expect(section).toBe("personal");
    expect(Object.keys(fields).sort()).toEqual([
      "address",
      "birthday",
      "employment_type",
      "first_name",
      "last_name",
      "phone",
      "preferred_name",
      "start_date",
      "status",
    ]);
  });

  it("lets an admin set the job title, which the admin allowlist allows", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup({ mode: "admin", actions });

    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    const [, fields] = actions.onSave.mock.calls[0];
    expect(fields).toHaveProperty("job_title", "Lead Installer");
  });
});
