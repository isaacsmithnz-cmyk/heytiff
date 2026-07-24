/* Guided fault-finding trees — structural integrity. A dangling answer or an
   unreachable outcome is invisible in the UI until a tech walks into it, so
   the shape of every tree is enforced here. */

import {
  allReferences,
  getOutcome,
  getQuestion,
  getSymptom,
  isOutcomeRef,
  outcomeId,
  OUTCOMES,
  QUESTIONS,
  remainingLabel,
  stepsRemaining,
  SYMPTOMS,
} from "../guided";

describe("tree integrity", () => {
  it("every answer points at a question or outcome that exists", () => {
    const dangling: string[] = [];
    for (const q of QUESTIONS) {
      for (const a of q.answers) {
        const ok = isOutcomeRef(a.next)
          ? getOutcome(outcomeId(a.next)) !== undefined
          : getQuestion(a.next) !== undefined;
        if (!ok) dangling.push(`${q.id} → "${a.label}" → ${a.next}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("every symptom starts at a real question", () => {
    for (const s of SYMPTOMS) {
      expect(getQuestion(s.start)).toBeDefined();
    }
  });

  it("question and outcome ids are unique", () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    expect(new Set(OUTCOMES.map((o) => o.id)).size).toBe(OUTCOMES.length);
  });

  it("every question is reachable from some symptom", () => {
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const a of getQuestion(id)?.answers ?? []) {
        if (!isOutcomeRef(a.next)) walk(a.next);
      }
    };
    for (const s of SYMPTOMS) walk(s.start);
    const orphans = QUESTIONS.map((q) => q.id).filter((id) => !seen.has(id));
    expect(orphans).toEqual([]);
  });

  it("every outcome is reachable from some answer", () => {
    const reached = new Set(
      allReferences().filter(isOutcomeRef).map(outcomeId)
    );
    const unreachable = OUTCOMES.map((o) => o.id).filter((id) => !reached.has(id));
    expect(unreachable).toEqual([]);
  });

  it("no question can loop back on itself", () => {
    for (const q of QUESTIONS) {
      for (const a of q.answers) {
        expect(a.next).not.toBe(q.id);
      }
    }
  });

  it("every path terminates at an outcome within a sane number of steps", () => {
    const depth = (id: string, seen: string[]): number => {
      expect(seen).not.toContain(id); // cycle guard
      const q = getQuestion(id)!;
      return (
        1 +
        Math.max(
          ...q.answers.map((a) =>
            isOutcomeRef(a.next) ? 0 : depth(a.next, [...seen, id])
          )
        )
      );
    };
    for (const s of SYMPTOMS) {
      const d = depth(s.start, []);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(9); // an apprentice shouldn't answer 10 questions
    }
  });
});

describe("content quality", () => {
  it("every question has at least two answers and a real question", () => {
    for (const q of QUESTIONS) {
      expect(q.answers.length).toBeGreaterThanOrEqual(2);
      expect(q.ask.length).toBeGreaterThan(10);
      expect(q.ask).toMatch(/\?$/); // it's a question
      for (const a of q.answers) expect(a.label.length).toBeGreaterThan(1);
    }
  });

  it("every outcome explains itself and says what to do", () => {
    for (const o of OUTCOMES) {
      expect(o.title.length).toBeGreaterThan(5);
      expect(o.explain.length).toBeGreaterThan(40);
      expect(o.actions.length).toBeGreaterThanOrEqual(2);
      expect(["likely", "possible", "info"]).toContain(o.confidence);
    }
  });

  it("all eleven symptoms are covered, each with an icon and colour", () => {
    expect(SYMPTOMS).toHaveLength(11);
    for (const s of SYMPTOMS) {
      expect(s.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(s.icon.length).toBeGreaterThan(2);
      expect(s.blurb.length).toBeGreaterThan(5);
    }
  });

  it("carries no manufacturer fault codes (pack-data rule)", () => {
    const text = JSON.stringify({ QUESTIONS, OUTCOMES, SYMPTOMS });
    for (const brand of ["Mitsubishi", "Daikin", "Fujitsu", "Panasonic", "Samsung", "LG"]) {
      expect(text).not.toContain(brand);
    }
    // no "E6"-style code literals being passed off as universal
    expect(text).not.toMatch(/\b[EUPF]\d{1,2}\b/);
  });

  it("routes electrical and refrigerant work to specialists", () => {
    const shortEarth = getOutcome("short-earth")!;
    expect(shortEarth.escalate).toBe(true);
    expect(getOutcome("electrical-smell")!.escalate).toBe(true);
    // the safety-critical ones say so in their first action
    expect(shortEarth.actions[0]).toMatch(/isolate/i);
  });

  it("hands off to the other Toolbox tools where pressures or sizing decide it", () => {
    const withTool = OUTCOMES.filter((o) => o.tool);
    expect(withTool.length).toBeGreaterThanOrEqual(6);
    for (const o of withTool) {
      expect(o.tool!.href).toMatch(/^\/dashboard\/toolbox\//);
    }
  });
});

describe("walking a tree", () => {
  it("cooling opens on mode and setpoint, the way heating does", () => {
    const q1 = getQuestion(getSymptom("cooling")!.start)!;
    expect(q1.ask).toMatch(/set to COOL/i);
    // and it offers a one-question exit, which the tree used to lack
    const wrong = q1.answers.find((a) => a.label.startsWith("No"))!;
    expect(isOutcomeRef(wrong.next)).toBe(true);
    expect(getOutcome(outcomeId(wrong.next))!.title).toMatch(/isn't calling for cooling/i);
  });

  it("not cooling → outdoor dead → indoor alive → outdoor has no power", () => {
    const mode = getQuestion(getSymptom("cooling")!.start)!;
    const q1 = getQuestion(mode.answers.find((a) => a.label.includes("definitely"))!.next)!;
    expect(q1.ask).toMatch(/what's actually happening/i);
    const dead = q1.answers.find((a) => a.label.includes("isn't running"))!;
    const q2 = getQuestion(dead.next)!;
    expect(q2.ask).toMatch(/indoor unit respond/i);
    const alive = q2.answers.find((a) => a.label.includes("indoor works"))!;
    expect(isOutcomeRef(alive.next)).toBe(true);
    expect(getOutcome(outcomeId(alive.next))!.title).toMatch(/outdoor unit isn't/i);
  });

  it("not cooling → all basics good → ends at the pressures hand-off", () => {
    let id = getSymptom("cooling")!.start;
    const answers = ["Yes, definitely cooling", "Running, but the air is barely cool", "Clean, good airflow", "No ice", "Clean and clear"];
    let final = "";
    for (const label of answers) {
      const q = getQuestion(id)!;
      const a = q.answers.find((x) => x.label === label)!;
      expect(a).toBeDefined();
      if (isOutcomeRef(a.next)) { final = outcomeId(a.next); break; }
      id = a.next;
    }
    expect(final).toBe("go-pressures");
    expect(getOutcome(final)!.tool!.href).toContain("running-pressures");
  });

  it("burning smell short-circuits straight to isolate", () => {
    const q = getQuestion(getSymptom("smell")!.start)!;
    const burning = q.answers.find((a) => a.label.includes("Burning"))!;
    expect(isOutcomeRef(burning.next)).toBe(true);
    expect(getOutcome(outcomeId(burning.next))!.title).toMatch(/isolate it now/i);
  });

  it("icing and breaker symptoms carry up-front safety notes", () => {
    expect(getSymptom("ice")!.safety).toMatch(/never chip/i);
    expect(getSymptom("breaker")!.safety).toMatch(/licensed/i);
  });

  it("no question branches on the tech's toolbag instead of the machine", () => {
    // "Do you have gauges on it?" narrowed nothing — both answers meant the
    // same fault. That belongs in the outcome, not as a step in the tree.
    for (const q of QUESTIONS) {
      expect(q.ask).not.toMatch(/do you have|have you got/i);
    }
  });
});

describe("multi and VRF", () => {
  it("opens on scope, which narrows these systems fastest", () => {
    const q = getQuestion(getSymptom("multi")!.start)!;
    expect(q.ask).toMatch(/how much of the system/i);
    expect(q.answers.length).toBeGreaterThanOrEqual(4);
  });

  it("a head that conditions while switched off is valve creep, in one question", () => {
    const q = getQuestion(getSymptom("multi")!.start)!;
    const creep = q.answers.find((a) => a.label.includes("when it's off"))!;
    expect(isOutcomeRef(creep.next)).toBe(true);
    expect(getOutcome(outcomeId(creep.next))!.title).toMatch(/creeping/i);
  });

  it("heads disagreeing on a two-pipe system is explained as design, not a fault", () => {
    let id = getSymptom("multi")!.start;
    let final = "";
    for (const label of ["Some heads heat while others want cool", "Two-pipe, or not sure"]) {
      const a = getQuestion(id)!.answers.find((x) => x.label === label)!;
      expect(a).toBeDefined();
      if (isOutcomeRef(a.next)) { final = outcomeId(a.next); break; }
      id = a.next;
    }
    const out = getOutcome(final)!;
    expect(out.title).toMatch(/mode conflict/i);
    expect(out.explain).toMatch(/nothing is broken/i);
    expect(out.escalate).toBeFalsy(); // it isn't a fault to escalate
  });

  it("one dead head with live neighbours lands on comms, not the outdoor unit", () => {
    let id = getSymptom("multi")!.start;
    let final = "";
    for (const label of ["One indoor unit", "No, it's dead", "Supply is present at the head"]) {
      const a = getQuestion(id)!.answers.find((x) => x.label === label)!;
      expect(a).toBeDefined();
      if (isOutcomeRef(a.next)) { final = outcomeId(a.next); break; }
      id = a.next;
    }
    expect(getOutcome(final)!.title).toMatch(/transmission line or addressing/i);
  });

  it("sends inverter multi and VRF to the service monitor, not just gauges", () => {
    expect(getOutcome("vrf-monitor")!.explain).toMatch(/gauge ports tell you far less/i);
  });
});

describe("telling the tech how much further", () => {
  it("counts the questions still ahead, best case to worst", () => {
    // the cooling spine is the deepest branch in the tool
    const start = getSymptom("cooling")!.start;
    const { min, max } = stepsRemaining(start);
    expect(min).toBe(0); // "no, wrong mode" ends it right there
    expect(max).toBe(4); // and the deepest walk is four more after this one
  });

  it("the walk-around is one question, not two", () => {
    // "is the outdoor unit running" and "is the air cold" are one look
    const state = getQuestion("cool.state")!;
    expect(state.answers).toHaveLength(3);
    expect(getQuestion("cool.odu")).toBeUndefined();
    expect(getQuestion("cool.cold")).toBeUndefined();
  });

  it("the deepest path is five questions, down from six", () => {
    const { max } = stepsRemaining(getSymptom("cooling")!.start);
    expect(max + 1).toBe(5);
  });

  it("says something useful at every question in every tree", () => {
    for (const q of QUESTIONS) {
      expect(remainingLabel(q.id)).toBeTruthy();
    }
    // and names the end when it is the end
    const smell = getSymptom("smell")!.start;
    expect(remainingLabel(smell)).toBe("Last question");
  });
});
