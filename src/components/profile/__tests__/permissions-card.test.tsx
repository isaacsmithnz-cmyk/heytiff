import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CAPABILITIES, resolve, type Capability } from "@/lib/permissions";
import { PermissionsCard } from "../permissions-card";
import type { PermissionsCtx } from "../types";

/* Role & access.

   The thing worth pinning is the split: READ mode states what is true, EDIT
   mode offers the controls. It used to show its locked state as a row of dead
   toggles — switches you cannot flick, which read as broken rather than as
   read-only. */

const ctx = (over: Partial<PermissionsCtx> = {}): PermissionsCtx => ({
  role: "staff",
  caps: resolve("staff"),
  settable: new Set<Capability>(CAPABILITIES),
  canChangeRole: true,
  editable: true,
  ...over,
});

const setup = (over: Partial<PermissionsCtx> = {}) => {
  const onSave = jest.fn().mockResolvedValue({ ok: true });
  const view = render(<PermissionsCard ctx={ctx(over)} onSave={onSave} />);
  return { ...view, onSave };
};

/** the value cell of a named Access row */
const accessRow = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLElement>(".pdrow")].find(
    (r) => r.querySelector("dt")?.textContent === label
  )!;

describe("read mode states the facts", () => {
  it("names the role and what it means", () => {
    const { container } = setup();
    const role = accessRow(container, "Role");
    expect(role).toHaveTextContent("Staff");
    expect(role).toHaveTextContent("Field worker — own data only");
  });

  it("says On for a granted capability and Off for a withheld one", () => {
    const { container } = setup();
    // a staff member reaches the toolbox but not other people's pay
    expect(accessRow(container, "Toolbox")).toHaveTextContent("On");
    expect(accessRow(container, "Financials")).toHaveTextContent("Off");
  });

  it("offers no toggles at all — nothing to flick that wouldn't move", () => {
    setup();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("marks what this viewer may not set, rather than hiding it", () => {
    const { container } = setup({ settable: new Set<Capability>(["toolbox"]) });
    expect(accessRow(container, "Financials")).toHaveTextContent("owner-granted");
    expect(accessRow(container, "Toolbox")).not.toHaveTextContent("owner-granted");
  });

  it("explains itself when the whole card is locked, and has no Edit", () => {
    setup({ editable: false, lockedReason: "The owner's access can't be changed." });
    expect(screen.getByText("The owner's access can't be changed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();
  });
});

describe("edit mode offers the controls", () => {
  it("brings up every role and a live switch per capability", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));

    // read mode showed only the role held; choosing means seeing them all
    for (const role of ["Staff", "Admin", "Owner"]) {
      expect(screen.getByText(role)).toBeInTheDocument();
    }
    expect(screen.getByRole("switch", { name: "Toolbox" })).toBeEnabled();
  });

  it("locks the switches this viewer may not set, and only those", async () => {
    const user = userEvent.setup();
    setup({ settable: new Set<Capability>(["toolbox"]) });
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));

    expect(screen.getByRole("switch", { name: "Toolbox" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Financials" })).toBeDisabled();
  });

  it("submits the flipped capability", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    await user.click(screen.getByRole("switch", { name: "Toolbox" }));
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(onSave).toHaveBeenCalledWith(
      "permissions",
      expect.objectContaining({ cap_toolbox: "off" })
    );
  });

  it("keeps the role radios out of reach when the viewer can't change roles", async () => {
    const user = userEvent.setup();
    const { container } = setup({ canChangeRole: false });
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));

    for (const radio of container.querySelectorAll("input[name='org_role']")) {
      expect(radio).toBeDisabled();
    }
    // …but they are still SHOWN, so an admin can see why the access is what it is
    expect(within(container).getByText("Owner")).toBeInTheDocument();
  });
});
