import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { XeroPayroll, describe as describeState } from "../xero-payroll";
import type { LinkingData } from "@/app/actions/xero-links";
import type { XeroEmployee } from "@/lib/integrations/xero-shape";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const emp = (over: Partial<XeroEmployee> & { employeeId: string; name: string }): XeroEmployee => ({
  firstName: "",
  lastName: "",
  email: null,
  jobTitle: null,
  active: true,
  employmentType: null,
  payrollCalendarId: null,
  ...over,
});

const base: LinkingData = {
  connected: true,
  tenantName: "Acme Air",
  rows: [],
  unaccounted: [],
  calendar: null,
  elsewhere: 0,
  error: null,
};

const props = (data: LinkingData) => ({
  load: jest.fn().mockResolvedValue(data),
  onLink: jest.fn().mockResolvedValue({ ok: true }),
  onUnlink: jest.fn().mockResolvedValue({ ok: true }),
  onAdoptEmployment: jest.fn().mockResolvedValue({ ok: true }),
});

beforeEach(() => refresh.mockReset());

describe("describe()", () => {
  /* The reason a suggestion was made rides in the sentence, because "same
     email" and "same name" are very different levels of evidence and whoever
     presses the button should know which one they're trusting. */
  it("distinguishes email evidence from name evidence", () => {
    const employee = emp({ employeeId: "x1", name: "Dan Smith" });
    expect(describeState({ kind: "suggested", employee, reason: "email" })).toContain("same email");
    expect(describeState({ kind: "suggested", employee, reason: "name" })).toContain("same name");
  });

  it("says a linked person has left rather than dropping them", () => {
    const employee = emp({ employeeId: "x1", name: "Dan Smith", active: false });
    expect(describeState({ kind: "linked_left", employee, matchedBy: "manual" })).toContain("has left in Xero");
  });

  it("still names who a missing link meant", () => {
    expect(describeState({ kind: "linked_missing", remoteLabel: "Dan Smith" })).toContain("Dan Smith");
  });
});

describe("XeroPayroll", () => {
  it("says nothing is connected without inventing a roster", async () => {
    render(<XeroPayroll {...props({ ...base, connected: false })} />);
    expect(await screen.findByText(/Xero isn't connected/)).toBeInTheDocument();
  });

  /* "Nobody is on payroll" and "we couldn't ask Xero" look identical as an
     empty list and mean opposite things. */
  it("shows a read failure instead of an empty roster", async () => {
    render(<XeroPayroll {...props({ ...base, error: "The Xero connection needs reconnecting." })} />);
    expect(await screen.findByText("The Xero connection needs reconnecting.")).toBeInTheDocument();
  });

  it("offers a suggestion with its evidence, and links on confirmation", async () => {
    const user = userEvent.setup();
    const p = props({
      ...base,
      rows: [
        {
          staffProfileId: "s1",
          name: "Dan Smith",
          employmentType: null,
          state: { kind: "suggested", employee: emp({ employeeId: "x1", name: "Dan Smith" }), reason: "email" },
          employment: null,
        },
      ],
    });
    render(<XeroPayroll {...p} />);

    await user.click(await screen.findByText("Match by email"));

    // 'auto' records that a human accepted a suggestion — not that the machine decided
    await waitFor(() => expect(p.onLink).toHaveBeenCalledWith("s1", "x1", "auto"));
  });

  it("gives an ambiguous row no suggestion at all, only a manual choice", async () => {
    render(
      <XeroPayroll
        {...props({
          ...base,
          rows: [
            {
              staffProfileId: "s1",
              name: "Dan Smith",
              employmentType: null,
              state: { kind: "ambiguous" },
              employment: null,
            },
          ],
          unaccounted: [emp({ employeeId: "x1", name: "Dan Smith" }), emp({ employeeId: "x2", name: "Dan Smith" })],
        })}
      />
    );

    expect(await screen.findByText(/More than one Xero employee could be them/)).toBeInTheDocument();
    expect(screen.queryByText(/^Match by/)).not.toBeInTheDocument();
    expect(screen.getByText("Choose")).toBeInTheDocument();
  });

  it("surfaces a refused link rather than claiming success", async () => {
    const user = userEvent.setup();
    const p = props({
      ...base,
      rows: [
        {
          staffProfileId: "s1",
          name: "Dan Smith",
          employmentType: null,
          state: { kind: "suggested", employee: emp({ employeeId: "x1", name: "Dan Smith" }), reason: "name" },
          employment: null,
        },
      ],
    });
    p.onLink.mockResolvedValue({ ok: false, error: "That Xero employee is already linked to someone else." });
    render(<XeroPayroll {...p} />);

    await user.click(await screen.findByText("Match by name"));

    expect(
      await screen.findByText("That Xero employee is already linked to someone else.")
    ).toBeInTheDocument();
  });

  it("offers the employment-type adoption as a one-tap action", async () => {
    const user = userEvent.setup();
    const p = props({
      ...base,
      rows: [
        {
          staffProfileId: "s1",
          name: "Dan Smith",
          employmentType: "Full-time",
          state: { kind: "linked", employee: emp({ employeeId: "x1", name: "Dan Smith" }), matchedBy: "manual" },
          employment: { kind: "suggest_subbie", suggested: "Subcontractor" },
        },
      ],
    });
    render(<XeroPayroll {...p} />);

    await user.click(await screen.findByText("Set to Subcontractor"));

    await waitFor(() => expect(p.onAdoptEmployment).toHaveBeenCalledWith("s1", "Subcontractor"));
  });

  /* A contradiction gets no button: neither side is obviously right, and a
     one-tap "fix" would be this screen deciding something it doesn't know. */
  it("states a contradiction without offering to resolve it", async () => {
    render(
      <XeroPayroll
        {...props({
          ...base,
          rows: [
            {
              staffProfileId: "s1",
              name: "Dan Smith",
              employmentType: "Subcontractor",
              state: { kind: "linked", employee: emp({ employeeId: "x1", name: "Dan Smith" }), matchedBy: "manual" },
              employment: { kind: "contradiction", note: "Xero pays them as an employee, but they're a subcontractor here." },
            },
          ],
        })}
      />
    );

    expect(await screen.findByText(/Xero pays them as an employee/)).toBeInTheDocument();
    expect(screen.queryByText(/^Set to/)).not.toBeInTheDocument();
  });

  it("shows the calendar advisory as advice, not a fault", async () => {
    render(
      <XeroPayroll
        {...props({
          ...base,
          calendar: {
            xeroCycles: ["Fortnightly"],
            differs: true,
            note: "Xero pays these people Fortnightly; this workspace is set to Weekly. Nothing has been changed — check which is right.",
          },
        })}
      />
    );
    expect(await screen.findByText(/Nothing has been changed/)).toBeInTheDocument();
  });

  /* After a tenant switch, links for the old organisation stop applying. If the
     screen said nothing, that would read as data loss. */
  it("explains links parked on another Xero organisation", async () => {
    render(<XeroPayroll {...props({ ...base, elsewhere: 3 })} />);
    expect(await screen.findByText(/3 matches belong to a different Xero organisation/)).toBeInTheDocument();
  });

  it("lists Xero people nobody here accounts for", async () => {
    render(
      <XeroPayroll {...props({ ...base, unaccounted: [emp({ employeeId: "x9", name: "New Starter" })] })} />
    );
    expect(await screen.findByText("In Xero, not here")).toBeInTheDocument();
    expect(screen.getByText("New Starter")).toBeInTheDocument();
  });
});
