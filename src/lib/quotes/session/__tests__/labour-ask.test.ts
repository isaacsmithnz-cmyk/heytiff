import { hoursNotOnLines, isLabourAsk, labourPut } from "../labour-ask";

/* 3465 as it stood on 4 November 2026: two visits built task by task */
const visit = (stage: string, people: number, hours: number[]) => ({ stage, people, dayHours: 8, tasks: hours.map((h, i) => ({ task: `t${i}`, hours: h, was: null, byHand: false })) });
const line = (o: Record<string, unknown>) => ({ kind: "labour" as const, name: "x", qty: 0, unit: "h", optionIndex: 0, visit: null, ...o });
const lines = [
  line({ name: "Day 1: 5 people, 1 day", visit: visit("Day 1", 5, [20, 24]) }),
  line({ name: "Day 2: 2 people, 1 day", visit: visit("Day 2", 2, [9, 8]) }),
  { kind: "unit" as const, name: "PEA-M140HAA", qty: 1, unit: "", optionIndex: 0, visit: null },
];

describe("a question about the crew", () => {
  it("is one that asks about the crew, the labour or the hours", () => {
    expect(isLabourAsk({ question: "Which crew and days do you want?", topic: "Crew and days" })).toBe(true);
    expect(isLabourAsk({ question: "How many people for the install?" })).toBe(true);
    expect(isLabourAsk({ question: "How long is the pipe run?", topic: "Pipe run" })).toBe(false);
  });

  it("says what the labour lines have, visit by visit, with the whole", () => {
    expect(labourPut(lines)).toBe("Day 1: 5 people, 44 h; Day 2: 2 people, 17 h (61 h in all)");
    expect(labourPut([line({ name: "Install: 3 people, 1 day", qty: 24 })])).toBe("Install: 3 people, 24 h");
    expect(labourPut(lines.slice(2))).toBeNull();
  });

  it("names each option's labour where the quote has more than one", () => {
    expect(labourPut([line({ name: "Install: 2 people, 1 day", qty: 16 }), line({ name: "Install: 3 people, 1 day", qty: 24, optionIndex: 1 })])).toBe("Option 1: Install: 2 people, 16 h. Option 2: Install: 3 people, 24 h");
  });

  it("catches 3465's 35 h and 26 h, hours no line has", () => {
    const q = { question: "Day 1 is 5 people for 35 h, day 2 is 2 people for 26 h (61 h). Which crew and days do you want?", answers: [{ label: "Keep my two days (61 h)", changes: [] }] };
    expect(hoursNotOnLines(q, lines)).toEqual([35, 26]);
  });

  it("lets the lines' own hours by, a person's day on a line, and hours an answer offers", () => {
    const q = { question: "I worked the labour out at 61 hours: 44 h on day 1, 8.8 h each for five, then 17 h. Or one day at 48 hours?", answers: [{ label: "One day, 48 h", changes: [] }] };
    expect(hoursNotOnLines(q, lines)).toEqual([]);
    expect(hoursNotOnLines(q, lines.slice(2))).toEqual([]);
  });
});
