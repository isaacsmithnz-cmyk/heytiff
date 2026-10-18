import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EventForm, repeatChoices, repeatRule } from "../event-form";
import { WindowsContext } from "@/components/records/records-context";
import { addCalendarEventForm, deleteCalendarEvent, editCalendarEvent, undoCalendarLine } from "@/app/actions/calendar";
import type { CalItem } from "@/lib/calendar/items";

/* ADD AN EVENT AND AN EVENT'S EDIT (rules 51 and 52). The calendar's doors
   are pinned in the calendar's own suite (dashboard/home-cal-page); this
   holds the form: its kinds, its times on the wheel, its repeats named off
   the day, what it sends, and what the toast's Undo does. */

jest.mock("@/app/actions/calendar", () => ({
  addCalendarEventForm: jest.fn(async () => ({ ok: true, ids: ["e9"], day: "2026-11-06", skips: null })),
  undoCalendarLine: jest.fn(async () => ({ ok: true, summary: "1 event taken back." })),
  editCalendarEvent: jest.fn(async () => ({ ok: true })),
  deleteCalendarEvent: jest.fn(async () => ({ ok: true, count: 1 })),
}));

const FRAME = { today: "2026-10-18", windowStart: "2026-10-01", windowEnd: "2027-09-30" };
const toast = jest.fn();

const draw = (props: Partial<React.ComponentProps<typeof EventForm>> = {}) => {
  const onClose = jest.fn();
  const onAdded = jest.fn();
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <EventForm frame={FRAME} day="2026-11-06" onClose={onClose} onAdded={onAdded} {...props} />
    </WindowsContext.Provider>,
  );
  return { onClose, onAdded };
};
const dialog = () => screen.getByRole("dialog");
const name = (words: string) => fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: words } });
const press = async (label: string) => {
  await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name: label })));
};
/** Picks a time on the wheel: the hour and AM or PM. */
const wheel = (field: string, hour: string, meridiem: "AM" | "PM") => {
  fireEvent.click(screen.getByRole("combobox", { name: field }));
  const panel = screen.getByRole("dialog", { name: field });
  fireEvent.click(within(within(panel).getByRole("listbox", { name: "Hour" })).getByRole("option", { name: hour }));
  fireEvent.click(within(within(panel).getByRole("listbox", { name: "AM/PM" })).getByRole("option", { name: meridiem }));
  fireEvent.keyDown(panel, { key: "Escape" });
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("Add an event", () => {
  it("is drawn as the board draws it: kind, name, day and last day, from and to, repeats, where, who and note", () => {
    draw();
    expect(within(dialog()).getByRole("heading", { name: "Add an event" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("radiogroup", { name: "Kind" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Event" })).toHaveAttribute("aria-checked", "true");
    for (const label of ["Name", "Where", "Who", "Note"]) expect(within(dialog()).getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Day")).toHaveTextContent("06/11/2026");
    expect(screen.getByLabelText("Last day")).toHaveTextContent("Same day");
    expect(screen.getByRole("combobox", { name: "From" })).toHaveTextContent("No time");
    expect(screen.getByRole("combobox", { name: "Repeats" })).toHaveTextContent("Doesn't repeat");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    // no time is typed (rule 34), and no native select
    expect(dialog().querySelector('input[type="time"], select')).toBeNull();
  });

  it("sends the fields, the times as HH:MM off the wheel, and Undo takes it back off", async () => {
    const { onClose, onAdded } = draw();
    name("Toolbox talk");
    wheel("From", "7", "AM");
    wheel("To", "8", "AM");
    fireEvent.change(screen.getByRole("textbox", { name: "Where" }), { target: { value: "The depot, Brookvale" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Who" }), { target: { value: "Everyone" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Ladders and harness checks." } });
    await press("Add event");
    expect(addCalendarEventForm).toHaveBeenCalledWith({
      kind: "event",
      title: "Toolbox talk",
      startsOn: "2026-11-06",
      endsOn: "2026-11-06",
      startsAt: "07:00",
      endsAt: "08:00",
      repeat: null,
      location: "The depot, Brookvale",
      audience: "Everyone",
      note: "Ladders and harness checks.",
    });
    expect(onClose).toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledWith(["e9"], "2026-11-06");
    expect(toast).toHaveBeenCalledWith("Event added", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(undoCalendarLine).toHaveBeenCalledWith(["e9"]);
  });

  it("clears a time back to all day", () => {
    draw();
    wheel("From", "7", "AM");
    expect(screen.getByRole("combobox", { name: "From" })).toHaveTextContent("7:00 AM");
    fireEvent.click(screen.getByRole("button", { name: "Clear the start" }));
    expect(screen.getByRole("combobox", { name: "From" })).toHaveTextContent("No time");
  });

  it("names the repeats off the day, sends the rule, and holds a repeat to one day", async () => {
    draw();
    name("Toolbox talk");
    fireEvent.click(screen.getByRole("combobox", { name: "Repeats" }));
    // Friday 6 November 2026: the first Friday, not the month's last
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Doesn't repeat",
      "Every Friday",
      "Every second Friday",
      "Every first Friday",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Every first Friday" }));
    expect(screen.getByLabelText("Last day")).toBeDisabled();
    (addCalendarEventForm as jest.Mock).mockResolvedValueOnce({
      ok: true,
      ids: ["a", "b", "c"],
      day: "2026-11-06",
      skips: "Skips Christmas Day.",
    });
    await press("Add event");
    expect((addCalendarEventForm as jest.Mock).mock.calls[0][0]).toMatchObject({
      repeat: { every: "month", day: "fri", nth: 1 },
      endsOn: "2026-11-06",
    });
    expect(toast).toHaveBeenCalledWith("3 events added. Skips Christmas Day.", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(undoCalendarLine).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("gives a shutdown days and no hours or repeat", async () => {
    draw();
    fireEvent.click(screen.getByRole("radio", { name: "Shutdown" }));
    expect(screen.queryByRole("combobox", { name: "From" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Repeats" })).toBeNull();
    expect(screen.getByLabelText("Last day")).toBeEnabled();
    name("Christmas shutdown");
    await press("Add shutdown");
    expect((addCalendarEventForm as jest.Mock).mock.calls[0][0]).toMatchObject({
      kind: "shutdown",
      startsAt: null,
      endsAt: null,
      repeat: null,
    });
    expect(toast).toHaveBeenCalledWith("Shutdown added", expect.any(Function));
  });

  it("can't be added without a name, and says why the action refused, staying open", async () => {
    const { onClose } = draw();
    expect(within(dialog()).getByRole("button", { name: "Add event" })).toBeDisabled();
    name("Public holiday");
    (addCalendarEventForm as jest.Mock).mockResolvedValueOnce({ ok: false, error: "Fri 6 Nov isn't a public holiday in NSW." });
    await press("Add event");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Fri 6 Nov isn't a public holiday in NSW.");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

/* ── Edit ── */

const item = (over: Partial<CalItem> = {}): CalItem => ({
  id: "ev:e1",
  cat: "event",
  start: "2026-11-05",
  end: "2026-11-05",
  title: "Toolbox talk",
  time: "06:47",
  timeEnd: null,
  action: "edit",
  seriesId: null,
  event: { kind: "event", location: "The yard", audience: null, note: null },
  ...over,
});

describe("an event's Edit", () => {
  it("fills in the event, keeps a time it never moved as it was, and Undo puts back what it said", async () => {
    const it1 = item();
    draw({ item: it1, items: [it1] });
    expect(within(dialog()).getByRole("heading", { name: "Edit event" })).toBeInTheDocument();
    // no kind and no repeat: an edit changes neither, as today's
    expect(screen.queryByRole("radiogroup", { name: "Kind" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Repeats" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "From" })).toHaveTextContent("6:47 AM");
    name("Toolbox talk: ladders");
    await press("Save changes");
    expect(editCalendarEvent).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ title: "Toolbox talk: ladders", startsAt: "06:47", endsAt: null, location: "The yard" }),
      "one",
    );
    expect(toast).toHaveBeenCalledWith("Event saved", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(editCalendarEvent).toHaveBeenLastCalledWith(
      "e1",
      {
        title: "Toolbox talk",
        startsOn: "2026-11-05",
        endsOn: "2026-11-05",
        startsAt: "06:47",
        endsAt: null,
        location: "The yard",
        audience: null,
        note: null,
      },
      "one",
    );
  });

  it("saves all of a series, and Undo puts back each date as it was", async () => {
    const dates = ["2026-11-05", "2026-12-03"].map((d, i) => item({ id: `ev:s${i + 1}`, start: d, end: d, seriesId: "ser" }));
    draw({ item: dates[0], items: dates });
    expect(screen.queryByLabelText("Last day")).toBeNull();
    await press("Save all 2");
    expect(editCalendarEvent).toHaveBeenCalledWith("s1", expect.anything(), "series");
    expect(toast).toHaveBeenCalledWith("2 events saved", expect.any(Function));
    await toast.mock.calls[0][1]();
    const undone = (editCalendarEvent as jest.Mock).mock.calls.slice(1);
    expect(undone.map((c) => [c[0], c[1].startsOn, c[2]])).toEqual([
      ["s1", "2026-11-05", "one"],
      ["s2", "2026-12-03", "one"],
    ]);
  });

  it("deletes after asking, with a toast and no Undo, since a delete can't be taken back", async () => {
    const onDeleted = jest.fn();
    const it1 = item();
    draw({ item: it1, items: [it1], onDeleted });
    await press("Delete event");
    const ask = within(dialog()).getByRole("group", { name: "Delete for good?" });
    expect(within(ask).getByRole("button", { name: "Keep" })).toHaveFocus();
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Delete event" })));
    expect(deleteCalendarEvent).toHaveBeenCalledWith("e1", "one");
    expect(onDeleted).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Event deleted");
  });
});

describe("repeats off a day", () => {
  it("offers the month's last as well as its nth, and only the last past the fourth", () => {
    // Thursday 26 November 2026: the fourth Thursday, and the last
    expect(repeatChoices("2026-11-26").map((c) => c.label)).toEqual([
      "Doesn't repeat",
      "Every Thursday",
      "Every second Thursday",
      "Every fourth Thursday",
      "Every last Thursday",
    ]);
    // Thursday 29 October 2026: a fifth Thursday is only ever the last
    expect(repeatChoices("2026-10-29").map((c) => c.value)).toEqual(["none", "week", "fortnight", "last"]);
  });

  it("makes the rule the calendar counts", () => {
    expect(repeatRule("none", "2026-11-05")).toBeNull();
    expect(repeatRule("week", "2026-11-05")).toEqual({ every: "week", day: "thu" });
    expect(repeatRule("fortnight", "2026-11-05")).toEqual({ every: "fortnight", day: "thu" });
    expect(repeatRule("nth", "2026-11-05")).toEqual({ every: "month", day: "thu", nth: 1 });
    expect(repeatRule("last", "2026-11-26")).toEqual({ every: "month", day: "thu", nth: "last" });
  });
});
