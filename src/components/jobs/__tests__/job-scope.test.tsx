import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { JobScope } from "../job-scope";
import type { JobScopeRead } from "@/lib/jobs/job-scope";

/* The scope at the top of a job's Overview, as a written brief (layout B,
   Isaac, 28 October 2026), and its latest updates. */

const scope = (over: Partial<JobScopeRead> = {}): JobScopeRead => ({
  lede: "Four systems for the Carney Residence, from Anna Vaughan Architects' tender set (30 Sep).",
  systems: [
    { area: "Ground floor", kind: "ducted, under the floor", text: "Living/Dining, Kids Play, Guest Bed. Fan coil under the living room.", from: ["A200", "A202"] },
    { area: "Studio", kind: "split system", text: "Living and bedroom. No size given.", from: [] },
  ],
  added: [{ text: "Exhaust fans in the three bathrooms", from: "The builder's call, 28 Oct" }],
  notOurs: ["Solar panels off and back on", "Hot water and the pool heat pump"],
  clarify: [{ q: "Who removes the old units?", who: "Builder" }],
  updates: [{ on: "Wed 28 Oct", from: "Isaac Smith, the builder's call", said: "Added exhaust fans in the three bathrooms." }],
  undoSaid: "",
  stamp: "s",
  writtenAt: "2026-10-28T04:00:00Z",
  canUndo: false,
  ...over,
});

it("reads as a brief: a heading and paragraph per system, its sources after it", () => {
  render(<JobScope scope={scope()} />);
  const s = screen.getByRole("region", { name: "Scope" });
  expect(within(s).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Ground floor: ducted, under the floor",
    "Studio: split system",
    "Added",
    "Not ours",
    "To clarify",
  ]);
  expect(s).toHaveTextContent("Living/Dining, Kids Play, Guest Bed. Fan coil under the living room.A200, A202");
  expect(s).toHaveTextContent("Solar panels off and back on; Hot water and the pool heat pump");
  expect(within(s).getByText("Exhaust fans in the three bathrooms", { exact: false }).closest("li")).toHaveTextContent("Exhaust fans in the three bathroomsThe builder's call, 28 Oct");
});

it("numbers what's still to clarify and says who answers it", () => {
  render(<JobScope scope={scope()} />);
  expect(screen.getByText("Who removes the old units?").closest("li")).toHaveTextContent("1Who removes the old units?Builder");
});

it("lists the latest updates under it, and leaves out what it hasn't got", () => {
  const { unmount } = render(<JobScope scope={scope()} />);
  expect(screen.getByRole("region", { name: "Latest updates" })).toHaveTextContent("Wed 28 OctIsaac Smith, the builder's callAdded exhaust fans in the three bathrooms.");
  unmount();
  render(<JobScope scope={scope({ added: [], notOurs: [], clarify: [], updates: [] })} />);
  expect(screen.queryByRole("region", { name: "Latest updates" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Added" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "To clarify" })).toBeNull();
});

const twoUpdates = { canUndo: true, updates: [{ on: "Wed 28 Oct", from: "Isaac Smith", said: "Added exhaust fans." }, { on: "Tue 27 Oct", from: "Luke", said: "Started." }] };

it("offers Undo on the newest change alone", async () => {
  const onUndo = jest.fn(async () => {});
  render(<JobScope scope={scope(twoUpdates)} onUndo={onUndo} />);
  const buttons = screen.getAllByRole("button", { name: "Undo" });
  expect(buttons).toHaveLength(1);
  expect(buttons[0].closest("li")).toHaveTextContent("Added exhaust fans.");
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
});

it("offers no Undo when there's nothing to go back to", () => {
  render(<JobScope scope={scope()} onUndo={async () => {}} />);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("says it's reading a new note above the brief it still shows, with no Undo meanwhile", () => {
  render(<JobScope scope={scope(twoUpdates)} reading onUndo={async () => {}} />);
  const rows = within(screen.getByRole("region", { name: "Latest updates" })).getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("NowReading the new note");
  expect(screen.getByRole("region", { name: "Scope" })).toHaveTextContent("Four systems");
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

describe("after it's sent", () => {
  const study = { text: "Concealed fan coil unit next to the Study", from: "Anna Vaughan's email, Tue 3 Nov" };
  const sent = (over: Partial<JobScopeRead> = {}) =>
    scope({ added: [...scope().added, study], sincePriced: [study], quoted: { on: "Wed 28 Oct", version: 1 }, ...over });

  it("is the scope as quoted, with the day ServiceM8 sent it", () => {
    render(<JobScope scope={sent()} />);
    const s = screen.getByRole("region", { name: "Scope as quoted" });
    expect(s).toHaveTextContent("Sent from ServiceM8, Wed 28 Oct");
  });

  it("puts what's landed since under Since the quote, out of Added, with Update quote", () => {
    render(<JobScope scope={sent()} updateHref="/dashboard/jobs/j1/quote?update=1" />);
    const added = screen.getByRole("region", { name: "Scope as quoted" });
    expect(added).not.toHaveTextContent(study.text);
    const since = screen.getByRole("region", { name: "Since the quote" });
    expect(since).toHaveTextContent(study.text + study.from);
    expect(within(since).getByRole("link", { name: "Update quote" })).toHaveAttribute("href", "/dashboard/jobs/j1/quote?update=1");
  });

  it("leaves a thing out from its row", async () => {
    const onLeave = jest.fn(async () => {});
    render(<JobScope scope={sent()} onLeave={onLeave} />);
    fireEvent.click(within(screen.getByRole("region", { name: "Since the quote" })).getByRole("button", { name: "Leave out" }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledWith(study.text));
  });

  it("is the same once the job's accepted, with no sent day to give", () => {
    render(<JobScope scope={sent({ quoted: null, accepted: true })} />);
    expect(screen.getByRole("region", { name: "Scope" })).not.toHaveTextContent("Sent from ServiceM8");
    expect(screen.getByRole("region", { name: "Since the quote" })).toHaveTextContent(study.text);
  });

  it("before it's sent, keeps what's waiting on the quote in Added and draws no Since the quote", () => {
    render(<JobScope scope={sent({ quoted: null })} />);
    expect(screen.getByRole("region", { name: "Scope" })).toHaveTextContent(study.text);
    expect(screen.queryByRole("region", { name: "Since the quote" })).toBeNull();
  });

  it("says what's in version 2 in grey, with no Leave out and no Update quote", () => {
    render(<JobScope scope={sent({ sincePriced: [{ ...study, version: 2 }] })} updateHref="/q" onLeave={jest.fn(async () => {})} />);
    const since = screen.getByRole("region", { name: "Since the quote" });
    expect(since).toHaveTextContent(study.text);
    expect(since).toHaveTextContent("In version 2");
    expect(within(since).queryByRole("button", { name: "Leave out" })).toBeNull();
    expect(within(since).queryByRole("link", { name: "Update quote" })).toBeNull();
  });

  it("once version 2 is sent, has it in Added, saying it went in version 2", () => {
    render(<JobScope scope={sent({ sincePriced: [{ ...study, version: 2 }], quoted: { on: "Wed 4 Nov", version: 2 } })} />);
    expect(screen.queryByRole("region", { name: "Since the quote" })).toBeNull();
    const quoted = screen.getByRole("region", { name: "Scope as quoted" });
    expect(quoted).toHaveTextContent("Version 2 sent from ServiceM8, Wed 4 Nov");
    expect(quoted).toHaveTextContent(study.text + "Version 2, from " + study.from);
  });
});

describe("two scopes: what was supplied and what's quoted (11 November 2026)", () => {
  const supplied = {
    lede: "Watershed Architects' tender set, Issue G, with the specification.",
    systems: [
      { area: "Ground floor", kind: "Ducted", text: "Four Daikin FXDQ units in the ceiling.", from: ["CD105"] },
      { area: "Subfloor", kind: "Ventilation", text: "A quiet mechanical system running day and night.", from: ["Spec 0702, page 185"] },
    ],
    fine: [{ text: "Refrigerant GWP 700 or under", from: "Spec 0702, page 180" }],
    notOurs: ["Existing lights"],
    clarify: [{ q: "Who ducts the rangehood?", who: "Architect" }],
  };
  const both = () =>
    scope({
      systems: [
        { area: "Ground floor", kind: "ducted, under the floor", text: "Mitsubishi PEA-M125 under the floor.", from: ["Isaac Smith, 11 Nov"], differs: true },
        { area: "Subfloor", kind: "Ventilation", text: "A quiet mechanical system running day and night.", from: ["Spec 0702, page 185"] },
      ],
      supplied,
      suppliedAt: "2026-11-11T09:00:00Z",
    });

  it("has no tray while nothing was supplied", () => {
    render(<JobScope scope={scope()} />);
    expect(screen.queryByRole("radiogroup", { name: "Which scope" })).toBeNull();
    expect(screen.getByRole("region", { name: "Scope" })).toBeInTheDocument();
  });

  it("opens on the quoted scope, each system that departs saying Differs", () => {
    render(<JobScope scope={both()} />);
    const s = screen.getByRole("region", { name: "Quoted scope" });
    expect(within(s).getByRole("radio", { name: "Quoted" })).toHaveAttribute("aria-checked", "true");
    expect(within(s).getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Ground floor: ducted, under the floorDiffers");
    expect(within(s).getAllByRole("heading", { level: 3 })[1]).not.toHaveTextContent("Differs");
  });

  it("shows what was supplied, as read, with its fine print", () => {
    render(<JobScope scope={both()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Supplied" }));
    const s = screen.getByRole("region", { name: "Supplied scope" });
    expect(s).toHaveTextContent("Read on Wed 11 Nov");
    expect(s).toHaveTextContent("Four Daikin FXDQ units in the ceiling.CD105");
    expect(within(s).getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Ground floor: DuctedDiffers");
    expect(within(s).getByText("Refrigerant GWP 700 or under", { exact: false }).closest("li")).toHaveTextContent("Spec 0702, page 180");
  });

  it("lays the two side by side, a row per area, the quoted first", () => {
    render(<JobScope scope={both()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    const s = screen.getByRole("region", { name: "Scope" });
    const rows = s.querySelectorAll(".jsc-siderow:not(.jsc-sidetop)");
    expect(rows[0]).toHaveTextContent("Ground floorDiffersducted, under the floorMitsubishi PEA-M125 under the floor.");
    expect(rows[0]).toHaveTextContent("DuctedFour Daikin FXDQ units in the ceiling.");
    expect(rows[rows.length - 1]).toHaveTextContent("Fine printHeld to the supplied fine print");
  });

  it("offers no side by side where there's no room for it, as in the Studio's column", () => {
    render(<JobScope scope={both()} sideBySide={false} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Quoted", "Supplied"]);
  });
});
