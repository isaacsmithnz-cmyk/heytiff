import { skillRow, skillsOf } from "../note-skills";
import { rawFromCalls, resolveAssignee, shapeProposal, MOVE_SAY, type NoteContext } from "../note-brain";
import { clockIn } from "../note-move";
import { looksLikeHandOff } from "@/lib/brain/intent";

/* BUG 112 (Isaac, 26 November 2026): "Can you put Alex L onto The Camperdown
   Cellars Darlinghurst service call at 2:00 p.m. today" was read as a booking
   handed over, and Tiff said she couldn't. A new booking is a visit (the
   router's words, checked live); a booking handed over is done now, through
   the Schedule's own change (schedule-change.test's "a booking given"). */

const ctx: NoteContext = {
  staff: [
    { id: "s-isaac", fullName: "Isaac Smith" },
    { id: "s-alexl", fullName: "Alex Lorenz" },
    { id: "s-alexm", fullName: "Alex Morozoff" },
    { id: "s-luke", fullName: "Luke Ingold" },
  ],
  author: { id: "s-isaac", fullName: "Isaac Smith" },
  todayISO: "2026-11-26",
};

const swap = (item: Record<string, unknown>) =>
  shapeProposal(rawFromCalls([{ name: "swap_visit", input: { items: [{ booking: "", from_hint: "", to_hint: "", day: "", ...item }] } }]), ctx, "");

describe("a booking handed over", () => {
  it("is the speaker's when nobody is named, and goes to the person named", () => {
    const p = swap({ booking: "my 2pm", to_hint: "Alex L", day: "2026-11-26" });
    expect(p.skills?.[0]).toMatchObject({ kind: "swap_visit", whoId: "s-alexl", fromId: "s-isaac" });
  });

  it("is that person's when one is named, and asks when two share the name", () => {
    expect(swap({ booking: "Camperdown job", from_hint: "Luke", to_hint: "Alex L" }).skills?.[0]).toMatchObject({ whoId: "s-alexl", fromId: "s-luke" });
    const two = swap({ booking: "Camperdown job", from_hint: "Alex", to_hint: "Luke" });
    expect(two.clarify?.question).toBe("Which Alex did you mean?");
  });

  it("never falls to the speaker when the name matches nobody", () => {
    expect(swap({ booking: "my 2pm", to_hint: "Dave" }).skills?.[0]).toMatchObject({ whoId: null, fromId: "s-isaac" });
    expect(swap({ booking: "his 2pm", from_hint: "Dave", to_hint: "Luke" }).skills?.[0]).toMatchObject({ fromId: null });
  });

  it("keeps whose it is through being stored, and is no longer shown as waiting on an answer", () => {
    const [s] = skillsOf(JSON.parse(JSON.stringify(swap({ booking: "Camperdown job", from_hint: "Luke", to_hint: "Alex L" }).skills)));
    expect(s).toMatchObject({ kind: "swap_visit", whoId: "s-alexl", fromId: "s-luke" });
    expect(skillRow(s!, "Alex").needs).toBe(false);
  });
});

describe("the time in the words that name a booking", () => {
  it.each([
    ["my 2pm", "14:00", "my"],
    ["the 2:30 p.m. at Smiths", "14:30", "the at Smiths"],
    ["12 am", "00:00", ""],
    ["12pm", "12:00", ""],
    ["the 7:30", "07:30", "the"],
    ["3587", "", "3587"],
    ["Leo's Sampleton job", "", "Leo's Sampleton job"],
  ])("%s", (words, start, rest) => {
    expect(clockIn(words)).toEqual({ start, rest });
  });
});

describe("two cards with one name (bug 99)", () => {
  const twins = [
    { id: "s-isaac-1", fullName: "Isaac Smith" },
    { id: "s-isaac-2", fullName: "Isaac Smith" },
    { id: "s-luke", fullName: "Luke Ingold" },
  ];
  it("is the speaker's own when one of them is the speaker", () => {
    expect(resolveAssignee("Isaac Smith", twins, "s-isaac-2")).toEqual({ kind: "one", id: "s-isaac-2" });
    expect(resolveAssignee("Isaac", twins, "s-isaac-1")).toEqual({ kind: "one", id: "s-isaac-1" });
  });
  it("is still asked about when neither is the speaker", () => {
    expect(resolveAssignee("Isaac", twins, "s-luke")).toMatchObject({ kind: "ambiguous" });
  });
});

describe("a request to do something, with a question mark", () => {
  it.each([
    "Can you put Alex L onto 3587 at 2?",
    "Could you move my 3pm to Friday?",
    "can you mark 3602 complete?",
    "Can you give my 2pm to Alex?",
    "can you take Alex off Smiths tomorrow?",
    "Could you block out Friday arvo for me?",
    "Can you add 2 metres of pipe to Smiths?",
  ])("is work, not a question: %s", (words) => {
    expect(looksLikeHandOff(words)).toBe(true);
  });
  it.each(["Can you tell me what's on tomorrow?", "Can you check whether 3587 is booked?", "What's the clearance for an SP140?"])("is still a question: %s", (words) => {
    expect(looksLikeHandOff(words)).toBe(false);
  });
  it("and a move she couldn't read never says she can't move one", () => {
    expect(MOVE_SAY).not.toMatch(/can't/);
  });
});
