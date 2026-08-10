import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sm8PeopleCard } from "../sm8-people-card";
import type { Sm8PersonRow } from "@/lib/integrations/sm8-people";

/* The accept rule, exercised where it lives: the row shows every value that
   would land, the editor unticks or corrects them, and the payload that
   leaves this component is exactly what was on screen — nothing more. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const importSm8Staff = jest.fn(async (..._args: unknown[]) => ({
  ok: true as const,
  imported: 1,
  skipped: 0,
}));
const linkSm8Staff = jest.fn(async (..._args: unknown[]) => ({ ok: true as const }));
const unlinkSm8Staff = jest.fn(async (..._args: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/staff-import", () => ({
  importSm8Staff: (...a: unknown[]) => importSm8Staff(...(a as [])),
  linkSm8Staff: (...a: unknown[]) => linkSm8Staff(...(a as [])),
  unlinkSm8Staff: (...a: unknown[]) => unlinkSm8Staff(...(a as [])),
}));

const person = (over: Partial<Sm8PersonRow["person"]> & { uuid: string }) => ({
  first: "Dan",
  last: "Smith",
  name: "Dan Smith",
  jobTitle: "Technician",
  email: "dan@acme.com",
  mobile: "0412 000 111",
  active: true,
  ...over,
});

const newRow = (uuid: string, over: Partial<Sm8PersonRow["person"]> = {}): Sm8PersonRow => ({
  kind: "new",
  person: person({ uuid, ...over }),
});

beforeEach(() => {
  refresh.mockClear();
  importSm8Staff.mockClear();
  linkSm8Staff.mockClear();
  unlinkSm8Staff.mockClear();
});

describe("the row is the review", () => {
  it("shows every value Import would write, right on the row", () => {
    render(<Sm8PeopleCard rows={[newRow("u-1")]} linkable={[]} error={null} />);
    expect(screen.getByText("Dan Smith")).toBeInTheDocument();
    expect(screen.getByText(/Technician · dan@acme\.com · 0412 000 111/)).toBeInTheDocument();
  });

  it("imports the default-ticked fields as shown", async () => {
    render(<Sm8PeopleCard rows={[newRow("u-1")]} linkable={[]} error={null} />);
    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));

    expect(importSm8Staff).toHaveBeenCalledWith([
      {
        uuid: "u-1",
        firstName: "Dan",
        lastName: "Smith",
        jobTitle: "Technician",
        email: "dan@acme.com",
        phone: "0412 000 111",
      },
    ]);
  });

  it("an unticked field never reaches the payload — and the row stops showing it", async () => {
    render(<Sm8PeopleCard rows={[newRow("u-1")]} linkable={[]} error={null} />);

    await userEvent.click(screen.getByRole("button", { name: /review fields/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /email/i }));

    expect(screen.queryByText(/dan@acme\.com/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));
    const sent = importSm8Staff.mock.calls[0][0] as Record<string, unknown>[];
    expect(sent[0].email).toBeUndefined();
    expect(sent[0].jobTitle).toBe("Technician");
  });

  it("an edited value is what lands", async () => {
    render(<Sm8PeopleCard rows={[newRow("u-1")]} linkable={[]} error={null} />);

    await userEvent.click(screen.getByRole("button", { name: /review fields/i }));
    const title = screen.getByRole("textbox", { name: "Job title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Lead Technician");
    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));

    expect((importSm8Staff.mock.calls[0][0] as Record<string, unknown>[])[0].jobTitle).toBe(
      "Lead Technician"
    );
  });
});

describe("suggested rows resolve to links, not new cards", () => {
  const suggested: Sm8PersonRow = {
    kind: "suggested",
    person: person({ uuid: "u-2" }),
    staffProfileId: "s-9",
    staffName: "Danny Smith",
    reason: "email",
  };

  it("says who it looks like and links on accept", async () => {
    render(<Sm8PeopleCard rows={[suggested]} linkable={[]} error={null} />);
    expect(screen.getByText(/Looks like/)).toBeInTheDocument();
    expect(screen.getByText("Danny Smith")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Link$/i }));
    expect(linkSm8Staff).toHaveBeenCalledWith("s-9", "u-2", "auto");
    expect(importSm8Staff).not.toHaveBeenCalled();
  });

  it("keeps import-as-new one step further away, inside the editor", async () => {
    render(<Sm8PeopleCard rows={[suggested]} linkable={[]} error={null} />);
    expect(screen.queryByRole("button", { name: /import as a new card/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /review fields/i }));
    await userEvent.click(screen.getByRole("button", { name: /import as a new card/i }));
    expect(importSm8Staff).toHaveBeenCalled();
  });
});

describe("bulk import", () => {
  it("selects only NEW rows and sends each row's current field state", async () => {
    const rows = [
      newRow("u-1"),
      newRow("u-2", { first: "Jo", last: "Blogs", name: "Jo Blogs", email: null, mobile: null }),
    ];
    render(<Sm8PeopleCard rows={rows} linkable={[]} error={null} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /select all new/i }));
    await userEvent.click(screen.getByRole("button", { name: /import 2 selected/i }));

    const sent = importSm8Staff.mock.calls[0][0] as Record<string, unknown>[];
    expect(sent.map((p) => p.uuid)).toEqual(["u-1", "u-2"]);
    expect(sent[1].email).toBeUndefined(); // nothing invented for the sparse one
  });
});

describe("inactive people and linked people stay out of the way", () => {
  it("hides inactive logins behind the toggle", async () => {
    render(
      <Sm8PeopleCard
        rows={[newRow("u-1"), newRow("u-3", { name: "Gone Person", first: "Gone", last: "Person", active: false })]}
        linkable={[]}
        error={null}
      />
    );
    expect(screen.queryByText("Gone Person")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show 1 inactive/i }));
    expect(screen.getByText("Gone Person")).toBeInTheDocument();
  });

  it("collapses linked people to a count, with unlink two clicks away", async () => {
    const linked: Sm8PersonRow = {
      kind: "linked",
      person: person({ uuid: "u-4" }),
      staffProfileId: "s-1",
      staffName: "Dan Smith",
    };
    render(<Sm8PeopleCard rows={[linked]} linkable={[]} error={null} />);

    await userEvent.click(screen.getByRole("button", { name: /already linked \(1\)/i }));

    // armed, then confirmed — never one loose click
    await userEvent.click(screen.getByRole("button", { name: /^Unlink$/i }));
    expect(unlinkSm8Staff).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm unlink/i }));
    expect(unlinkSm8Staff).toHaveBeenCalledWith("s-1");
  });
});

describe("degraded states", () => {
  it("a failed read shows its sentence instead of rows", () => {
    render(<Sm8PeopleCard rows={[]} linkable={[]} error="ServiceM8 couldn't be reached just now. Try again shortly." />);
    expect(screen.getByText(/couldn't be reached/)).toBeInTheDocument();
  });

  it("renders nothing at all for an empty account", () => {
    const { container } = render(<Sm8PeopleCard rows={[]} linkable={[]} error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
