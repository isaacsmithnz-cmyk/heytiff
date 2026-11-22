import { conversationDays, todoLine, todoTone, type FeedTodo } from "../job-conversation";
import { withoutLogos, withoutSignature } from "../customer-messages";

/* THE FEED LIKE A CHAT (Isaac, 14 November 2026, mock D and calls 6, 7, 12, 20) */

describe("a To do's line", () => {
  const today = "2026-11-14";
  it("says who it's for and when it's due, by first name, anyone's when nobody's", () => {
    expect(todoLine({ who: "Isaac", dueDate: "2026-11-16", time: null, by: false }, today)).toEqual({ line: "For Isaac, due Mon 16 Nov", tone: null });
    expect(todoLine({ who: null, dueDate: null, time: null, by: false }, today)).toEqual({ line: "For anyone", tone: null });
    expect(todoLine({ who: "Isaac", dueDate: "2026-11-15", time: "9:00 am", by: true }, today).line).toBe("For Isaac, due tomorrow by 9:00 am");
  });

  it("is amber when it's due today and red once it's overdue", () => {
    expect(todoLine({ who: "Isaac", dueDate: today, time: null, by: false }, today)).toEqual({ line: "For Isaac, due today", tone: "look" });
    expect(todoLine({ who: "Isaac", dueDate: "2026-11-11", time: null, by: false }, today)).toEqual({ line: "For Isaac, was due Wed 11 Nov", tone: "wrong" });
  });

  it("makes the To do tab's word red for one overdue, amber for one due today, plain otherwise", () => {
    expect(todoTone([{ tone: "look" }, { tone: "wrong" }])).toBe("wrong");
    expect(todoTone([{ tone: null }, { tone: "look" }])).toBe("look");
    expect(todoTone([{ tone: null }])).toBeNull();
  });
});

describe("All, day by day", () => {
  const todo = (over: Partial<FeedTodo> = {}): FeedTodo => ({ id: "t1", title: "Chase Sharon", line: "", assigneeId: null, forLine: "For Isaac", by: "Isaac Smith", day: "2026-11-14", at: "2026-11-14 09:40", time: "9:40 am", done: false, ...over });
  it("puts a To do on the day it was made, oldest first", () => {
    const days = conversationDays([], [], "2026-11-14", new Set(), true, [], [todo(), todo({ id: "t0", day: "2026-11-12", at: "2026-11-12 08:00" })]);
    expect(days.map((d) => d.label)).toEqual(["Thu 12 Nov", "Today"]);
    expect(days[1]!.items[0]!.todo?.id).toBe("t1");
  });
});

describe("an email in the feed", () => {
  it("shows its words without its sign-off and what follows", () => {
    expect(withoutSignature("Hi Sharon want me to pay this out of Marsh Rent?\nKind regards,\nJacinta Corrie\nThe Corrie Agency\n0491 570 110")).toBe(
      "Hi Sharon want me to pay this out of Marsh Rent?",
    );
    expect(withoutSignature("All good, see you then.\nSent from my iPhone")).toBe("All good, see you then.");
    expect(withoutSignature("Thanks!")).toBe("Thanks!");
  });

  it("finds a signature with no sign-off over it (3408, the walk of 15 November 2026)", () => {
    const jacinta =
      "Hi Sharon want me to pay this out of Marsh Rent?\nJACINTA CORRIE B.Ec L.R.E.A\n2024 SAMPLE BAY AGENCY OF THE YEAR\nDirector\nSales, Property Management\nM 0491 570 110 P (02) 5550 1717 F (02) 5550 3794\nE jacinta.corrie@thecorrieagency.example\nFind me on\nThe information contained in this e-mail and any included attachments are confidential";
    expect(withoutSignature(jacinta, "Jacinta")).toBe("Hi Sharon want me to pay this out of Marsh Rent?");
    /* no name to go on: the numbers or the disclaimer still end it */
    expect(withoutSignature("Can you come Tuesday?\nDirector\nM 0491 570 110", null)).toBe("Can you come Tuesday?\nDirector");
    expect(withoutSignature("Paid today.\nThis email is confidential and intended only for", null)).toBe("Paid today.");
    /* the sender's name inside a sentence, or on the first line, stays */
    expect(withoutSignature("Jacinta here\nJacinta is away till Monday, so call the office.", "Jacinta")).toBe(
      "Jacinta here\nJacinta is away till Monday, so call the office.",
    );
    expect(withoutSignature("The unit is on level 3.\nMe and Dave can do Thursday.", "Dave")).toBe("The unit is on level 3.\nMe and Dave can do Thursday.");
  });

  it("leaves out its signature's pictures and keeps what was sent", () => {
    const files = [
      { id: "a", name: "image001.png", type: "png" },
      { id: "b", name: "Outlook-abc123.png", type: "png" },
      { id: "c", name: "Invoice 3408.pdf", type: "pdf" },
      { id: "d", name: "photo of unit.jpg", type: "jpg" },
    ];
    expect(withoutLogos(files).map((f) => f.id)).toEqual(["c", "d"]);
  });
});
