import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeopleImportCard } from "../people-import-card";
import type { PersonRow } from "@/lib/integrations/people-import";

/* The accept rule, exercised where it lives: the row shows every value that
   would land, the editor unticks or corrects them, and the payload that
   leaves this component is exactly what was on screen — nothing more. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const importPeople = jest.fn(async (..._args: unknown[]) => ({
  ok: true as const,
  imported: 1,
  skipped: 0,
}));
const linkPerson = jest.fn(async (..._args: unknown[]) => ({ ok: true as const }));
const unlinkSm8Staff = jest.fn(async (..._args: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/staff-import", () => ({
  importPeople: (...a: unknown[]) => importPeople(...(a as [])),
  linkPerson: (...a: unknown[]) => linkPerson(...(a as [])),
  unlinkSm8Staff: (...a: unknown[]) => unlinkSm8Staff(...(a as [])),
}));

const person = (over: Partial<PersonRow["person"]> & { id: string }) => ({
  first: "Dan",
  last: "Smith",
  name: "Dan Smith",
  jobTitle: "Technician",
  email: "dan@acme.com",
  phone: "0412 000 111",
  active: true,
  ...over,
});

const newRow = (id: string, over: Partial<PersonRow["person"]> = {}): PersonRow => ({
  kind: "new",
  person: person({ id, ...over }),
});

/** Defaults to ServiceM8 — the provider only matters where a test says so. */
const show = (props: {
  rows: PersonRow[];
  linkable?: { staffProfileId: string; name: string }[];
  error?: string | null;
  provider?: "servicem8" | "xero";
}) =>
  render(
    <PeopleImportCard
      provider={props.provider ?? "servicem8"}
      rows={props.rows}
      linkable={props.linkable ?? []}
      error={props.error ?? null}
    />,
  );

beforeEach(() => {
  refresh.mockClear();
  importPeople.mockClear();
  linkPerson.mockClear();
  unlinkSm8Staff.mockClear();
});

describe("the row is the review", () => {
  it("shows every value Import would write, right on the row", () => {
    show({ rows: [newRow("u-1")] });
    expect(screen.getByText("Dan Smith")).toBeInTheDocument();
    expect(screen.getByText(/Technician · dan@acme\.com · 0412 000 111/)).toBeInTheDocument();
  });

  it("imports the default-ticked fields as shown", async () => {
    show({ rows: [newRow("u-1")] });
    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));

    expect(importPeople).toHaveBeenCalledWith("servicem8", [
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
    show({ rows: [newRow("u-1")] });

    await userEvent.click(screen.getByRole("button", { name: /review fields/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /email/i }));

    expect(screen.queryByText(/dan@acme\.com/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));
    const sent = importPeople.mock.calls[0][1] as Record<string, unknown>[];
    expect(sent[0].email).toBeUndefined();
    expect(sent[0].jobTitle).toBe("Technician");
  });

  it("an edited value is what lands", async () => {
    show({ rows: [newRow("u-1")] });

    await userEvent.click(screen.getByRole("button", { name: /review fields/i }));
    const title = screen.getByRole("textbox", { name: "Job title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Lead Technician");
    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));

    expect((importPeople.mock.calls[0][1] as Record<string, unknown>[])[0].jobTitle).toBe(
      "Lead Technician"
    );
  });
});

describe("suggested rows resolve to links, not new cards", () => {
  const suggested: PersonRow = {
    kind: "suggested",
    person: person({ id: "u-2" }),
    staffProfileId: "s-9",
    staffName: "Danny Smith",
    reason: "email",
  };

  it("says who it looks like and links on accept", async () => {
    show({ rows: [suggested] });
    expect(screen.getByText(/Looks like/)).toBeInTheDocument();
    expect(screen.getByText("Danny Smith")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Link$/i }));
    expect(linkPerson).toHaveBeenCalledWith("servicem8", "s-9", "u-2", "auto");
    expect(importPeople).not.toHaveBeenCalled();
  });

  it("keeps import-as-new one step further away, inside the editor", async () => {
    show({ rows: [suggested] });
    expect(screen.queryByRole("button", { name: /import as a new card/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /review fields/i }));
    await userEvent.click(screen.getByRole("button", { name: /import as a new card/i }));
    expect(importPeople).toHaveBeenCalled();
  });
});

describe("bulk import", () => {
  it("selects only NEW rows and sends each row's current field state", async () => {
    const rows = [
      newRow("u-1"),
      newRow("u-2", { first: "Jo", last: "Blogs", name: "Jo Blogs", email: null, phone: null }),
    ];
    show({ rows });

    await userEvent.click(screen.getByRole("checkbox", { name: /select all new/i }));
    await userEvent.click(screen.getByRole("button", { name: /import 2 selected/i }));

    const sent = importPeople.mock.calls[0][1] as Record<string, unknown>[];
    expect(sent.map((p) => p.uuid)).toEqual(["u-1", "u-2"]);
    expect(sent[1].email).toBeUndefined(); // nothing invented for the sparse one
  });
});

describe("inactive people and linked people stay out of the way", () => {
  it("hides inactive logins behind the toggle", async () => {
    show({
      rows: [
        newRow("u-1"),
        newRow("u-3", { name: "Gone Person", first: "Gone", last: "Person", active: false }),
      ],
    });
    expect(screen.queryByText("Gone Person")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show 1 inactive/i }));
    expect(screen.getByText("Gone Person")).toBeInTheDocument();
  });

  it("collapses linked people to a count, with unlink two clicks away", async () => {
    const linked: PersonRow = {
      kind: "linked",
      person: person({ id: "u-4" }),
      staffProfileId: "s-1",
      staffName: "Dan Smith",
    };
    show({ rows: [linked] });

    await userEvent.click(screen.getByRole("button", { name: /already linked \(1\)/i }));

    // armed, then confirmed — never one loose click
    await userEvent.click(screen.getByRole("button", { name: /^Unlink$/i }));
    expect(unlinkSm8Staff).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm unlink/i }));
    expect(unlinkSm8Staff).toHaveBeenCalledWith("s-1");
  });
});

/* One component, two providers — what changes is the name in the sentences
   and where an unlink belongs. */
describe("the provider only changes what it must", () => {
  it("names Xero in its own copy and sends its import there", async () => {
    show({ rows: [newRow("x-1", { phone: null })], provider: "xero" });

    expect(screen.getByText("People in Xero")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Import$/i }));

    expect(importPeople).toHaveBeenCalledWith("xero", [
      expect.objectContaining({ uuid: "x-1", phone: undefined }),
    ]);
  });

  it("sends a Xero unmatch to Time & Pay instead of offering a second control", async () => {
    const linked: PersonRow = {
      kind: "linked",
      person: person({ id: "x-2" }),
      staffProfileId: "s-1",
      staffName: "Dan Smith",
    };
    show({ rows: [linked], provider: "xero" });
    await userEvent.click(screen.getByRole("button", { name: /already linked \(1\)/i }));

    // unmatching there also settles the wage drift the link carries
    expect(screen.getByText(/Unmatch from Time & Pay/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Unlink$/i })).not.toBeInTheDocument();
  });
});

describe("degraded states", () => {
  it("a failed read shows its sentence instead of rows", () => {
    show({ rows: [], error: "ServiceM8 couldn't be reached just now. Try again shortly." });
    expect(screen.getByText(/couldn't be reached/)).toBeInTheDocument();
  });

  it("renders nothing at all for an empty account", () => {
    const { container } = show({ rows: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
