import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeopleReview } from "../people-review";
import type { PersonRow } from "@/lib/integrations/people-import";

/* The accept rule, exercised where it lives: each person's line shows every
   value that would land, Edit fields unticks or corrects them, and the
   payload that leaves this component is exactly what was on screen. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const importPeople = jest.fn(async (..._args: unknown[]) => ({ ok: true as const, imported: 1, skipped: 0 }));
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

const newRow = (id: string, over: Partial<PersonRow["person"]> = {}): PersonRow => ({ kind: "new", person: person({ id, ...over }) });

/** Defaults to ServiceM8: the app only matters where a test says so. */
const show = (props: {
  rows: PersonRow[];
  linkable?: { staffProfileId: string; name: string }[];
  error?: string | null;
  provider?: "servicem8" | "xero";
}) =>
  render(
    <div className="fg">
      <PeopleReview provider={props.provider ?? "servicem8"} rows={props.rows} linkable={props.linkable ?? []} error={props.error ?? null} />
    </div>,
  );

/** Opens the review, and hands back the dialog. */
const review = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Review people" }));
  return within(screen.getByRole("dialog"));
};

beforeEach(() => {
  refresh.mockClear();
  importPeople.mockClear();
  linkPerson.mockClear();
  unlinkSm8Staff.mockClear();
});

describe("the row in the group", () => {
  it("names the app and counts what there is to settle, leaving out what is none", () => {
    show({
      rows: [
        newRow("u-1"),
        newRow("u-2"),
        { kind: "linked", person: person({ id: "u-3" }), staffProfileId: "s-1", staffName: "Dan Smith" },
      ],
    });
    const row = screen.getByText("People in ServiceM8").closest(".st2-set") as HTMLElement;
    expect(row.querySelector(".st2-sets")).toHaveTextContent(/^2 not here yet, 1 linked$/);
  });

  it("says when everyone is matched", () => {
    show({ rows: [{ kind: "linked", person: person({ id: "u-3" }), staffProfileId: "s-1", staffName: "Dan Smith" }] });
    expect(screen.getByText("Everyone in this account is matched to a card here.")).toBeInTheDocument();
  });

  it("opens nothing until Review people is pressed", () => {
    show({ rows: [newRow("u-1")] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("each person's line is the review", () => {
  it("shows every value Import would write", async () => {
    show({ rows: [newRow("u-1")] });
    const d = await review();
    expect(d.getByText("Dan Smith")).toBeInTheDocument();
    expect(d.getByText(/Technician, dan@acme\.com, 0412 000 111/)).toBeInTheDocument();
  });

  it("imports the default-ticked fields as shown, and says so", async () => {
    show({ rows: [newRow("u-1")] });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: /^Import$/ }));
    expect(importPeople).toHaveBeenCalledWith("servicem8", [
      { uuid: "u-1", firstName: "Dan", lastName: "Smith", jobTitle: "Technician", email: "dan@acme.com", phone: "0412 000 111" },
    ]);
    expect(await d.findByText(/Imported 1 person\./)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("an unticked field never reaches the payload, and the line stops showing it", async () => {
    show({ rows: [newRow("u-1")] });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: /review fields/i }));
    await userEvent.click(d.getByRole("checkbox", { name: "Include email" }));
    expect(d.queryByText(/dan@acme\.com/)).not.toBeInTheDocument();

    await userEvent.click(d.getByRole("button", { name: /^Import$/ }));
    const sent = importPeople.mock.calls[0][1] as Record<string, unknown>[];
    expect(sent[0].email).toBeUndefined();
    expect(sent[0].jobTitle).toBe("Technician");
  });

  it("an edited value is what lands", async () => {
    show({ rows: [newRow("u-1")] });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: /review fields/i }));
    const title = d.getByRole("textbox", { name: "Job title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Lead Technician");
    await userEvent.click(d.getByRole("button", { name: /^Import$/ }));
    expect((importPeople.mock.calls[0][1] as Record<string, unknown>[])[0].jobTitle).toBe("Lead Technician");
  });

  it("matches a new person to a card already here, by hand", async () => {
    show({ rows: [newRow("u-1")], linkable: [{ staffProfileId: "s-4", name: "Daniel Smith" }] });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: /review fields/i }));
    expect(d.getByRole("button", { name: "Link to them" })).toBeDisabled();
    await userEvent.click(d.getByRole("combobox", { name: "Match Dan Smith to someone already here" }));
    await userEvent.click(screen.getByRole("option", { name: "Daniel Smith" }));
    await userEvent.click(d.getByRole("button", { name: "Link to them" }));
    expect(linkPerson).toHaveBeenCalledWith("servicem8", "s-4", "u-1", "manual");
  });
});

describe("possible matches resolve to links, not new cards", () => {
  const suggested: PersonRow = {
    kind: "suggested",
    person: person({ id: "u-2" }),
    staffProfileId: "s-9",
    staffName: "Danny Smith",
    reason: "email",
  };

  it("says who it looks like and links on accept", async () => {
    show({ rows: [suggested] });
    const d = await review();
    expect(d.getByText(/Looks like/)).toHaveTextContent("Looks like Danny Smith, same email address");
    await userEvent.click(d.getByRole("button", { name: /^Link$/ }));
    expect(linkPerson).toHaveBeenCalledWith("servicem8", "s-9", "u-2", "auto");
    expect(importPeople).not.toHaveBeenCalled();
  });

  it("keeps import-as-new one step further away, inside the fields", async () => {
    show({ rows: [suggested] });
    const d = await review();
    expect(d.queryByRole("button", { name: /import as a new card/i })).not.toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: /review fields/i }));
    await userEvent.click(d.getByRole("button", { name: /import as a new card/i }));
    expect(importPeople).toHaveBeenCalled();
  });
});

describe("bulk import", () => {
  it("selects only NEW people and sends each one's current fields", async () => {
    const rows = [newRow("u-1"), newRow("u-2", { first: "Jo", last: "Blogs", name: "Jo Blogs", email: null, phone: null })];
    show({ rows });
    const d = await review();
    await userEvent.click(d.getByRole("checkbox", { name: /select all new/i }));
    await userEvent.click(d.getByRole("button", { name: /import 2 selected/i }));
    const sent = importPeople.mock.calls[0][1] as Record<string, unknown>[];
    expect(sent.map((p) => p.uuid)).toEqual(["u-1", "u-2"]);
    expect(sent[1].email).toBeUndefined(); // nothing invented for the sparse one
  });
});

describe("inactive people and linked people stay out of the way", () => {
  it("hides inactive logins behind the toggle", async () => {
    show({ rows: [newRow("u-1"), newRow("u-3", { name: "Gone Person", first: "Gone", last: "Person", active: false })] });
    const d = await review();
    expect(d.queryByText("Gone Person")).not.toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: /show 1 inactive/i }));
    expect(d.getByText("Gone Person")).toBeInTheDocument();
    expect(d.getByText("Inactive in ServiceM8")).toBeInTheDocument();
  });

  it("folds linked people behind a button, with unlink two presses away", async () => {
    const linked: PersonRow = { kind: "linked", person: person({ id: "u-4" }), staffProfileId: "s-1", staffName: "Dan Smith" };
    show({ rows: [linked] });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: "Show the 1 linked" }));
    // armed, then confirmed — never one loose press
    await userEvent.click(d.getByRole("button", { name: /^Unlink$/ }));
    expect(unlinkSm8Staff).not.toHaveBeenCalled();
    await userEvent.click(d.getByRole("button", { name: /confirm unlink/i }));
    expect(unlinkSm8Staff).toHaveBeenCalledWith("s-1");
  });
});

/* Two-way phase 2: each person answers "Is <ServiceM8 name> you?" before a
   note goes as them, and "Not me" is kept against the link — the owner sees
   it here, beside that link, which is where it is fixed. */
describe("a link its person said isn't them", () => {
  it("(F) says so beside the link, and a confirmed one says nothing", async () => {
    const linked = (id: string, denied?: boolean): PersonRow => ({
      kind: "linked",
      person: person({ id, name: id === "u-4" ? "Dan Smith" : "Ann Lee" }),
      staffProfileId: `s-${id}`,
      staffName: "A card",
      ...(denied ? { denied } : {}),
    });
    show({ rows: [linked("u-4", true), linked("u-5")] });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: "Show the 2 linked" }));
    expect(d.getAllByText("Says this isn't them.")).toHaveLength(1);
    expect(d.getByText("Says this isn't them.").closest(".st2-int-person")).toHaveTextContent("Dan Smith");
  });
});

/* One component, two apps: what changes is the name in the sentences and
   where an unlink belongs. */
describe("the app only changes what it must", () => {
  it("names Xero in its own words and sends its import there", async () => {
    show({ rows: [newRow("x-1", { phone: null })], provider: "xero" });
    expect(screen.getByText("People in Xero")).toBeInTheDocument();
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: /^Import$/ }));
    expect(importPeople).toHaveBeenCalledWith("xero", [expect.objectContaining({ uuid: "x-1", phone: undefined })]);
  });

  it("sends a Xero unmatch to Time & Pay instead of offering a second control", async () => {
    const linked: PersonRow = { kind: "linked", person: person({ id: "x-2" }), staffProfileId: "s-1", staffName: "Dan Smith" };
    show({ rows: [linked], provider: "xero" });
    const d = await review();
    await userEvent.click(d.getByRole("button", { name: "Show the 1 linked" }));
    // unmatching there also settles the wage drift the link carries
    expect(d.getByText(/Unmatch from Time & Pay/)).toBeInTheDocument();
    expect(d.queryByRole("button", { name: /^Unlink$/ })).not.toBeInTheDocument();
  });
});

describe("degraded states", () => {
  it("a failed read shows its sentence instead of a review", () => {
    show({ rows: [], error: "ServiceM8 couldn't be reached just now. Try again shortly." });
    expect(screen.getByText(/couldn't be reached/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review people" })).not.toBeInTheDocument();
  });

  it("renders nothing at all for an empty account", () => {
    const { container } = show({ rows: [] });
    expect(container.querySelector(".fg")).toBeEmptyDOMElement();
  });
});
