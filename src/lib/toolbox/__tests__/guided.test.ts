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

  it("all fifteen symptoms are covered, each with an icon and colour", () => {
    expect(SYMPTOMS).toHaveLength(15);
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

  /* Refusing to carry a code table is the rule above. Ending the walk there
     was the bug: every outcome that lands on a code has to offer somewhere to
     take it, or the tool stops at "read the manual" — the one instruction it
     can't help with. */
  it("offers the library everywhere a diagnosis lands on a code", () => {
    const coded = OUTCOMES.filter((o) => o.library).map((o) => o.id);
    expect(coded).toEqual(
      expect.arrayContaining(["code-persists", "code-transient", "protection-coded"])
    );
    // and nowhere else — the flag is about holding a code, not about codes
    // being mentioned
    expect(coded).toHaveLength(3);
    // you can't look up a code you haven't written down yet
    expect(getOutcome("record-first")!.library).toBeUndefined();
  });

  it("no longer sends anyone to a manual it can't open", () => {
    for (const o of OUTCOMES.filter((o) => o.library)) {
      for (const a of o.actions) expect(a).not.toMatch(/service manual/i);
      for (const alt of o.alternatives ?? []) expect(`${alt.fix} ${alt.when}`).not.toMatch(/service manual/i);
    }
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

  it("separates crossed comms from crossed pipework — they present differently", () => {
    const q = getQuestion("vrf.crossed")!;
    const [comms, pipes] = q.answers.map((a) => getOutcome(outcomeId(a.next))!);
    expect(comms.title).toMatch(/control wiring crossed/i);
    expect(pipes.title).toMatch(/pipework crossed/i);
  });

  /* Crossed pipes used to end on "re-pipe it — recovery, braze and recharge"
     under a Specialist badge. The pipes and the cables only have to AGREE, and
     the cables are the side that moves at a terminal block. */
  it("corrects crossed pipework by moving the cables, not the pipes", () => {
    const pipes = getOutcome("vrf-crossed-pipes")!;
    const actions = pipes.actions.join(" ");
    expect(actions).toMatch(/move the cables, not the pipes/i);
    expect(actions).not.toMatch(/re-pip/i);
    expect(pipes.escalate).toBeFalsy();
    expect(getOutcome("vrf-crossed-comms")!.escalate).toBeFalsy();
    // those terminals can carry mains, so it says isolate before a cable comes off
    expect(pipes.safety).toMatch(/isolate/i);
    // re-piping is still offered, but as the flagged last resort it is
    const repipe = pipes.alternatives!.find((a) => /re-pipe/i.test(a.fix))!;
    expect(repipe.escalate).toBe(true);
    expect(pipes.alternatives!.indexOf(repipe)).toBe(pipes.alternatives!.length - 1);
  });
});

/* The crossed-pipes miss had a shape, and the audit found it again and again:
   the expensive fix written as THE fix, with the clip-on part, the closed
   valve or the slipped sensor that would have done it never mentioned. Each
   pin below is one of those, so a later edit can't quietly put the braze back
   in front of the spanner. */
describe("the cheap fix comes before the expensive one", () => {
  const all = (id: string) => {
    const o = getOutcome(id)!;
    return { o, best: o.actions.join(" "), alts: o.alternatives ?? [] };
  };

  it("a starved head checks its service valves and the valve's coil before the valve", () => {
    const { o, best, alts } = all("vrf-branch");
    expect(o.actions[0]).toMatch(/service valves/i);
    expect(best).toMatch(/pushed fully onto the valve body/i);
    expect(best).toMatch(/power-cycle/i); // a stepper that lost count re-homes on start-up
    expect(alts.find((a) => a.fix === "Replace the valve")!.escalate).toBe(true);
    expect(alts.find((a) => /coil/.test(a.fix))!.escalate).toBeFalsy();
  });

  it("a creeping valve is power-cycled and its coil checked before it's replaced", () => {
    const { best, alts } = all("vrf-creep");
    expect(best).toMatch(/power-cycle/i);
    expect(best).toMatch(/coil/i);
    expect(alts.find((a) => a.fix === "Replace the valve")!.escalate).toBe(true);
  });

  it("an iced outdoor coil checks its defrost sensor before its charge", () => {
    const { o, best } = all("defrost-fault");
    expect(best).toMatch(/sensor is clipped tight/i);
    expect(o.actions.findIndex((a) => /sensor/i.test(a))).toBeLessThan(
      o.actions.findIndex((a) => /read pressures/i.test(a))
    );
  });

  it("no heat checks the reversing valve's coil and its volts before the valve", () => {
    const { best, alts } = all("heat-none");
    expect(best).toMatch(/volts at the reversing valve's coil/i);
    expect(best).toMatch(/clip-on part/i);
    expect(alts.find((a) => /reversing valve/i.test(a.fix))!.escalate).toBe(true);
  });

  it("a stuck reversing valve proves its coil before it's cut out", () => {
    const { best, alts } = all("reversing-valve");
    expect(best).toMatch(/clip-on part/i);
    expect(alts.every((a) => a.escalate)).toBe(true);
  });

  it("a dead unit checks the isolator's insides and the board fuses before an electrician", () => {
    const { best, alts } = all("no-power");
    expect(best).toMatch(/volts into and out of the outdoor isolator/i);
    expect(best).toMatch(/fuses on the outdoor board/i);
    expect(alts[0].escalate).toBe(true);
    expect(all("odu-no-power").best).toMatch(/restart delay/i);
    expect(all("odu-no-power").best).toMatch(/burnt terminal/i);
  });

  it("an earth fault tests the cheaper parts before the compressor takes the blame", () => {
    const earth = all("short-earth").best;
    expect(earth).toMatch(/crankcase heater, the fan motors, the reversing valve coil and any base heater/i);
    // the expansion valve's coil is low voltage off the board: named, so
    // nobody burns an hour meggering it for a switchboard trip
    expect(earth).toMatch(/expansion valve's coil off that list/i);
    expect(all("rcd-moisture").best).toMatch(/reversing valve coil/i);
    expect(all("rcd-moisture").alts[0].fix).toMatch(/crankcase heater/i);
  });

  /* Isaac, on the breaker path: "have you got anywhere about checking the
     expansion valve?" It had nowhere. A valve stuck open floods the compressor
     and pulls current exactly like a tight one, so superheat is read before a
     compressor is condemned for high amps. */
  it("high amps with a clean condenser reads superheat before the compressor", () => {
    const { o, best, alts } = all("compressor-amps");
    expect(o.explain).toMatch(/expansion valve stuck open/i);
    expect(best).toMatch(/superheat/i);
    expect(best).toMatch(/bulb is clamped to the suction line/i);
    expect(best).toMatch(/power-cycle/i);
    const fixes = alts.map((a) => a.fix);
    expect(fixes).toContain("Replace the expansion valve");
    // the compressor is the last option offered, after the valve and the charge
    expect(fixes[fixes.length - 1]).toBe("Replace the compressor");
    expect(o.tool!.href).toContain("running-pressures");
  });

  it("a board that's dead to everything gets its plugs reseated and its ants out first", () => {
    const { best } = all("control-board");
    expect(best).toMatch(/reseat every plug/i);
    expect(best).toMatch(/ants/i);
  });

  it("a remote that's ignored checks its address before anything is ordered", () => {
    expect(all("remote-fault").best).toMatch(/different address/i);
  });

  /* The compressor path, audited the same way. Each of these is a good
     compressor that the old walk could have condemned, or a cheap fix it
     never offered. */
  it("a cold, idle compressor is warmed and retested before low megohms condemn it", () => {
    for (const id of ["comp-damp", "comp-earthed"]) {
      const { best } = all(id);
      expect(best).toMatch(/liquid refrigerant/i);
      expect(best).toMatch(/crankcase heater or the drive's (own )?preheat/i);
    }
    // the drier and the compressor are the fallbacks, not the first move
    const damp = all("comp-damp");
    expect(damp.best).not.toMatch(/change the liquid-line drier/i);
    expect(damp.alts.every((a) => a.escalate)).toBe(true);
  });

  it("a 'shorted' winding is proved at the posts, because a dead drive reads the same", () => {
    const { o, alts } = all("comp-short");
    expect(o.actions[0]).toMatch(/leads off, at the compressor's own posts/i);
    expect(o.actions[0]).toMatch(/power module/i);
    expect(alts.map((a) => a.fix)).toContain("Replace the drive board");
  });

  it("an unbalanced winding gets its posts cleaned before it's condemned", () => {
    expect(all("comp-unbalanced").best).toMatch(/bright metal/i);
  });

  it("a sound compressor that won't start has an inverter answer, not just a contactor", () => {
    const { best, alts } = all("comp-sound");
    expect(best).toMatch(/Inverter: there's no capacitor, relay or contactor/);
    expect(best).toMatch(/Fixed-speed three-phase: open the contactor/);
    const fixes = alts.map((a) => a.fix);
    expect(fixes).toEqual(expect.arrayContaining(["Add a restart delay", "Fit a hard-start kit", "Replace the drive board"]));
    expect(alts.find((a) => a.fix === "Fit a hard-start kit")!.when).toMatch(/never on an inverter/i);
  });

  it("an open overload can be cooled back sooner than hours", () => {
    expect(all("comp-overload").alts[0].fix).toMatch(/cool the shell/i);
  });

  it("a mild burnout cleans up on driers; the flush and new pipe are the fallbacks", () => {
    const { best, alts } = all("oil-burnout");
    expect(best).toMatch(/mild one cleans up on driers/i);
    expect(alts.map((a) => a.fix)).toEqual(["Flush the lines", "Replace the lines"]);
  });

  /* Pressures won't split, audited the same way. */
  it("an open manifold valve is ruled out before any compressor is suspected", () => {
    expect(getQuestion("nop.running")!.why).toMatch(/gauge manifold are shut/i);
    const { o } = all("not-pumping");
    expect(o.actions[0]).toMatch(/service valves fully open/i);
    expect(o.actions[0]).toMatch(/manifold shut/i);
  });

  it("a scroll gets its relief valve reset before it's condemned for not pumping", () => {
    const { o, best, alts } = all("not-pumping");
    expect(best).toMatch(/internal relief valve/i);
    expect(o.escalate).toBeFalsy();
    expect(alts.find((a) => a.fix === "Replace the compressor")!.escalate).toBe(true);
  });

  it("a held-back drive checks its settings, its heat sink and the refrigerant before the board", () => {
    const { best } = all("drive-limited");
    expect(best).toMatch(/quiet, night or econo modes/i);
    expect(best).toMatch(/demand-response/i);
    expect(best).toMatch(/heat sink/i);
    expect(best).toMatch(/refrigerant side, not the drive/i);
  });

  it("a stuck reversing valve gets its head raised before the changeovers", () => {
    expect(all("reversing-valve").best).toMatch(/raise the head first/i);
  });

  /* Ice on pipes or coil, audited the same way. */
  it("a frozen coil looks past the filters at the fan wheel and the zones", () => {
    expect(getQuestion("ice.filters")!.why).toMatch(/fan wheel/i);
    const { best, alts } = all("airflow-starved");
    expect(best).toMatch(/barrel behind a wall unit's louvres/i);
    expect(best).toMatch(/open more zones/i);
    // a slow fan is a capacitor before it's a motor, and neither is specialist
    expect(alts.map((a) => a.fix)).toEqual(["Replace the indoor fan's capacitor", "Replace the indoor fan motor"]);
    expect(alts.every((a) => !a.escalate)).toBe(true);
  });

  it("a coil starved of refrigerant checks the valves, the frost line and a re-home before the leak", () => {
    const { o, best, alts } = all("charge-or-valve");
    expect(best).toMatch(/service valves fully open/i);
    expect(best).toMatch(/look where the frost starts/i);
    expect(best).toMatch(/power-cycle at the isolator to re-home it/i);
    expect(o.escalate).toBeFalsy();
    expect(alts.every((a) => a.escalate)).toBe(true);
  });

  it("an iced outdoor coil watches a forced defrost before blaming the charge", () => {
    const { o, best } = all("defrost-fault");
    expect(best).toMatch(/force a defrost/i);
    expect(best).toMatch(/defrost field setting/i);
    expect(o.actions.findIndex((a) => /force a defrost/i.test(a))).toBeLessThan(
      o.actions.findIndex((a) => /read pressures/i.test(a))
    );
  });

  it("cooling on a cold day asks why it's cooling at all before any hardware", () => {
    const { o, alts } = all("low-ambient");
    expect(o.actions[0]).toMatch(/why it's cooling at all/i);
    expect(alts[0].fix).toMatch(/outside air/i);
  });

  it("the icing outcome on the other paths offers the fast thaw and the easy checks", () => {
    const { best, alts } = all("icing");
    expect(best).toMatch(/service valves fully open/i);
    expect(best).toMatch(/fan wheel/i);
    expect(alts[0].fix).toBe("Thaw it in heat mode");
    expect(alts[0].when).toMatch(/meltwater comes all at once/i);
  });

  /* Short cycling, audited the same way. */
  it("short cycling is timed at the compressor, not the fan", () => {
    expect(getQuestion("cyc.howlong")!.why).toMatch(/time the compressor, not the indoor fan/i);
  });

  it("a silent cut-out checks freeze protection and the float before the refrigerant", () => {
    const { o, best, alts } = all("protection-silent");
    expect(o.actions[0]).toMatch(/freeze protection/i);
    expect(best).toMatch(/float switch/i);
    expect(o.escalate).toBeFalsy();
    expect(alts.every((a) => a.escalate)).toBe(true);
    expect(all("protection-coded").best).toMatch(/filters/i);
  });

  it("an oversized unit drops a fan speed to run longer — raising it was backwards", () => {
    const { best } = all("oversized");
    expect(best).toMatch(/drop the fan a speed/i);
    expect(best).not.toMatch(/raise fan speed/i);
    expect(best).toMatch(/doesn't ice/i);
  });

  it("a sensor stopping it early checks sleep modes and meters itself before new hardware", () => {
    const { o, best, alts } = all("sensor-misread");
    expect(o.actions[0]).toMatch(/sleep or eco mode/i);
    expect(best).toMatch(/meter the room sensor/i);
    expect(alts[0].fix).toMatch(/remote sensor/i);
  });

  /* Water leaking, audited the same way. */
  it("water at the outdoor unit is its own answer, not sweating pipework", () => {
    const where = getQuestion("water.where")!;
    const outside = where.answers.find((a) => /outdoor unit/i.test(a.label))!;
    expect(isOutcomeRef(outside.next)).toBe(true);
    const out = getOutcome(outcomeId(outside.next))!;
    expect(out.confidence).toBe("info");
    expect(out.explain).toMatch(/defrost/i);
    expect(out.customer).toBeTruthy();
    // and it still says when water out there IS worth chasing
    expect(out.actions.join(" ")).toMatch(/sweating insulation/i);
  });

  it("a dry outlet isn't called a blockage before the humidity is checked", () => {
    expect(getQuestion("water.drain")!.why).toMatch(/dry air it legitimately makes almost none/i);
  });

  it("a blocked drain is cleared at the tray outlet, by pulling not pushing", () => {
    const { o, best, alts } = all("drain-blocked");
    expect(o.actions[0]).toMatch(/union apart at the head/i);
    expect(best).toMatch(/pulling from the discharge end/i);
    expect(best).toMatch(/weakest joint in the ceiling/i);
    expect(alts.map((a) => a.fix)).toEqual(["Fit a capped access tee at the head", "Fit a float switch in the tray or the line"]);
  });

  /* Isaac, on the spitting step: "could also be Gas related due to ice." A
     coil short of gas ices, and the melt is thrown out the louvres in bursts
     — same symptom, and the tray is innocent either way. */
  it("water spat from a wall unit names ice and the gas, not just a dirty fan", () => {
    const { o, best, alts } = all("tray-or-fall");
    expect(o.actions[0]).toMatch(/barrel fan/i);
    expect(o.actions[0]).toMatch(/short of gas/i);
    expect(best).toMatch(/look for frost with it running/i);
    expect(alts[0].fix).toMatch(/weigh the charge in/i);
    expect(alts[0].escalate).toBe(true);
    // and the ice question says to look while it runs, so a late "no ice"
    // doesn't route a gas fault to the tray
    expect(getQuestion("water.ice")!.why).toMatch(/bare ten minutes later/i);
  });

  it("a silent pump is proved to have power before it's replaced", () => {
    const { best } = all("pump-fault");
    expect(best).toMatch(/prove it has power/i);
    expect(best).toMatch(/non-return valve/i);
  });

  /* Error light or code, audited the same way. */
  it("the code is read out of the unit's log, not only off the lamps", () => {
    expect(getQuestion("code.recorded")!.why).toMatch(/fault history/i);
    // and the log survives what the power cycle wipes
    expect(getQuestion("code.persists")!.why).toMatch(/clears the display, not the log/i);
    const { best } = all("record-first");
    expect(best).toMatch(/film the lamps/i);
    expect(best).toMatch(/fault history/i);
    expect(best).toMatch(/condition IS the fault/i);
  });

  it("a live code reads its sensors and works the family before anything is ordered", () => {
    const { o, best, alts } = all("code-persists");
    expect(o.actions[0]).toMatch(/live sensor data in check mode/i);
    expect(best).toMatch(/thermistor out of its clip/i);
    expect(best).toMatch(/two units on one address/i);
    expect(best).toMatch(/ants, water and a half-seated plug/i);
    expect(o.escalate).toBeFalsy();
    expect(alts.find((a) => a.fix === "Replace the sensor")!.escalate).toBeFalsy();
    expect(alts.find((a) => /Board-level/.test(a.fix))!.escalate).toBe(true);
    // it still offers the library, which is the whole point of a coded outcome
    expect(o.library).toBe(true);
  });

  it("a cleared code asks what the weather and the power were doing", () => {
    const { best } = all("code-transient");
    expect(best).toMatch(/weather and the power/i);
    expect(best).toMatch(/counter beats anyone's memory/i);
  });

  /* Not cooling, audited the same way. */
  it("a remote sitting on COOL is not proof the head got the message", () => {
    expect(getQuestion("cool.mode")!.why).toMatch(/what the REMOTE thinks/);
    const { best } = all("settings-cool");
    expect(best).toMatch(/watch the unit answer/i);
    expect(best).toMatch(/second remote, the phone app/i);
    expect(best).toMatch(/lock/i);
  });

  it("a room beating the unit is measured first, and comes with words for the customer", () => {
    const { o, best } = all("load-excess");
    expect(o.actions[0]).toMatch(/return-to-supply split/i);
    expect(best).toMatch(/ceiling fan/i);
    expect(o.customer).toBeTruthy();
    expect(o.customer!.length).toBeGreaterThan(80);
  });

  it("a blocked condenser is read from behind and washed the right way", () => {
    const { o, best, alts } = all("condenser-blocked");
    expect(o.actions[0]).toMatch(/torch from behind/i);
    expect(best).toMatch(/from the inside out/i);
    expect(best).toMatch(/straighten flattened fins/i);
    expect(alts.map((a) => a.fix)).toContain("Chemical clean it");
    expect(alts.every((a) => !a.escalate)).toBe(true);
  });

  it("the gauges come after what a thermometer can answer for free", () => {
    const { o, best } = all("go-pressures");
    expect(o.actions[0]).toMatch(/before a hose goes on/i);
    expect(o.actions[0]).toMatch(/costs a little gas/i);
    expect(best).toMatch(/charge label and the pipe run/i);
  });

  /* Not heating, Won't turn on and the breaker, audited the same way. */
  it("a heat call is given its warm-up before it's called dead", () => {
    const { best } = all("settings");
    expect(best).toMatch(/hold their fan off until the coil is warm/i);
    expect(best).toMatch(/watch the unit answer/i);
    expect(getQuestion("heat.mode")!.why).toMatch(/what the REMOTE thinks/);
    // and a normal defrost gets a number to judge it by
    expect(all("defrost-normal").best).toMatch(/one every half hour to an hour/i);
  });

  it("a heat pump short on capacity counts its defrosts and carries a script", () => {
    const { o, best } = all("heat-capacity");
    expect(best).toMatch(/count the defrosts/i);
    expect(best).toMatch(/run it steadily rather than in bursts/i);
    expect(o.customer).toBeTruthy();
    expect(o.customer!.length).toBeGreaterThan(80);
  });

  it("a restored supply asks what switched it, and checks the clock survived", () => {
    const { best } = all("restore-power");
    expect(best).toMatch(/what happened before it went off/i);
    expect(best).toMatch(/clock and its schedule survived/i);
  });

  it("a schedule holding it off checks the clock before the schedule", () => {
    const { o, best } = all("timer-holding");
    expect(o.actions[0]).toMatch(/clock and day first/i);
    expect(best).toMatch(/demand-response device/i);
  });

  it("a float lockout meters the float before the drain is blamed twice", () => {
    const { best } = all("float-tripped");
    expect(best).toMatch(/meter the float and its plug/i);
    expect(best).toMatch(/power is cycled/i);
  });

  it("phase protection reads the relay's own settings before condemning the supply", () => {
    const { best } = all("phase-protection");
    expect(best).toMatch(/relay's own settings/i);
    expect(best).toMatch(/relay's own terminals/i);
  });

  it("the breaker itself is the last suspect on an instant trip, never the first", () => {
    const short = all("short-earth");
    const alt = short.alts.find((a) => /breaker's type and rating/i.test(a.fix))!;
    expect(alt.escalate).toBe(true);
    expect(alt.when).toMatch(/LAST thing to look at/);
    expect(short.o.escalate).toBe(true); // this one keeps its badge: it is a fault
    // and inverter leakage on a shared safety switch is named on the wet-weather path
    expect(all("rcd-moisture").alts.map((a) => a.fix).join(" ")).toMatch(/safety switch of its own/i);
  });

  it("crossed comms offers the renaming that needs no tools", () => {
    expect(all("vrf-crossed-comms").alts.map((a) => a.fix).join(" ")).toMatch(/rename/i);
  });
});

describe("best fix and other options", () => {
  it("every option says what to do AND when it's the one to pick", () => {
    for (const o of OUTCOMES) {
      for (const alt of o.alternatives ?? []) {
        expect(alt.fix.length).toBeGreaterThan(5);
        expect(alt.when.length).toBeGreaterThan(20);
        // an option restating a step of the best fix isn't an alternative
        expect(o.actions).not.toContain(alt.fix);
      }
      // never an empty list standing in for "no alternatives"
      if (o.alternatives) expect(o.alternatives.length).toBeGreaterThan(0);
    }
  });

  it("the badge sits on the fix that needs it", () => {
    // an outcome whose best fix is routine carries no badge, even when its
    // last resort does — that was the crossed-pipes mistake
    for (const id of ["vrf-crossed-pipes", "vrf-branch", "vrf-creep", "heat-none", "defrost-fault", "bc-valve", "charge-or-valve", "protection-silent", "code-persists"]) {
      const o = getOutcome(id)!;
      expect(o.escalate).toBeFalsy();
      expect(o.alternatives!.some((a) => a.escalate)).toBe(true);
    }
  });
});

describe("three-phase and a compressor that isn't pumping", () => {
  it("asks what the compressor IS before what's wrong with it", () => {
    const running = getQuestion(getSymptom("pumping")!.start)!;
    const type = getQuestion(running.answers.find((a) => a.label.includes("running"))!.next)!;
    expect(type.id).toBe("nop.type");
    expect(type.ask).toMatch(/inverter unit, or fixed-speed/i);
    expect(type.answers).toHaveLength(3);
    // and the why carries the actual reason, not just a fork
    expect(type.why).toMatch(/DC bus/);
    expect(type.why).toMatch(/DOL/);
  });

  it("rotation is only asked on fixed-speed three-phase, with a stop-now warning", () => {
    const type = getQuestion("nop.type")!;
    const dol3 = type.answers.find((a) => a.label === "Fixed-speed, three-phase")!;
    const rotation = getQuestion(dol3.next)!;
    expect(rotation.ask).toMatch(/phase sequence/i);
    expect(rotation.safety).toMatch(/isolate it now/i);
    expect(rotation.safety).toMatch(/licensed/i);
  });

  it("an inverter is never sent chasing rotation — the drive sets it", () => {
    // walk the entire inverter subtree; nop.rotation must be unreachable
    const type = getQuestion("nop.type")!;
    const inv = type.answers.find((a) => a.label === "Inverter")!;
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (isOutcomeRef(id) || seen.has(id)) return;
      seen.add(id);
      for (const a of getQuestion(id)!.answers) walk(a.next);
    };
    walk(inv.next);
    expect(seen.has("nop.rotation")).toBe(false);
    // and it CAN reach the drive outcome
    expect(getQuestion("nop.ramp")!.answers.some((a) => a.next === "out:drive-limited")).toBe(true);
  });

  it("reverse rotation leads with isolating, because it destroys the scroll", () => {
    const out = getOutcome("reverse-rotation")!;
    expect(out.actions[0]).toMatch(/isolate/i);
    expect(out.escalate).toBe(true);
  });

  it("equal pressures with the compressor stopped is called normal, not a fault", () => {
    const q = getQuestion(getSymptom("pumping")!.start)!;
    const stopped = q.answers.find((a) => a.label.includes("stopped"))!;
    const out = getOutcome(outcomeId(stopped.next))!;
    expect(out.confidence).toBe("info");
    expect(out.title).toMatch(/at rest, not a fault/i);
  });

  it("single-phase skips the rotation question and goes to the reversing valve", () => {
    const type = getQuestion("nop.type")!;
    const single = type.answers.find((a) => a.label.includes("single-phase"))!;
    expect(single.next).toBe("nop.valve");
  });

  it("the drive outcome reads the boards instead of guessing from gauges", () => {
    const out = getOutcome("drive-limited")!;
    expect(out.explain).toMatch(/read it out of the boards/i);
    expect(out.actions[0]).toMatch(/service or check mode/i);
    // reading the limit, cleaning a coil or a heat sink is routine; the badge
    // sits on the board and the charge, the options that need it
    expect(out.escalate).toBeFalsy();
    const board = out.alternatives!.find((a) => a.fix === "Replace the drive board")!;
    expect(board.escalate).toBe(true);
    // a tightening compressor current-limits the drive too: prove it first
    expect(board.when).toMatch(/Compressor suspect/);
  });

  it("a three-phase unit that won't start checks phase protection before the board", () => {
    const q = getQuestion("pwr.phase")!;
    expect(q.ask).toMatch(/phase protection relay/i);
    const faulted = q.answers.find((a) => a.label.includes("indicating a fault"))!;
    expect(getOutcome(outcomeId(faulted.next))!.title).toMatch(/phase protection is blocking/i);
    // and it still reaches the board when the supply is fine
    const ok = q.answers.find((a) => a.label.includes("Single-phase"))!;
    expect(outcomeId(ok.next)).toBe("control-board");
  });

  it("overcurrent on the breaker path mentions measuring all three legs", () => {
    expect(getOutcome("compressor-amps")!.actions.join(" ")).toMatch(/all three legs/i);
  });
});

describe("water: how old the fault is", () => {
  it("a drain that never worked is an install fault, not a blockage", () => {
    const q = getQuestion("water.age")!;
    expect(q.ask).toMatch(/always done this|start(ed)? recently/i);
    const [neverRight, wentBad] = q.answers.map((a) => getOutcome(outcomeId(a.next))!);
    expect(neverRight.title).toMatch(/never going to drain/i);
    expect(wentBad.title).toMatch(/blocked condensate drain/i);
  });

  it("the blockage outcome no longer claims slime on a line that never ran", () => {
    // it is only reached once the customer says it drained fine for years
    const out = getOutcome("drain-blocked")!;
    expect(out.explain).toMatch(/drained fine for years/i);
  });

  it("the install outcome checks fall, trap and level rather than clearing it", () => {
    const actions = getOutcome("drain-install")!.actions.join(" ");
    expect(actions).toMatch(/fall/i);
    expect(actions).toMatch(/trap/i);
    expect(actions).toMatch(/level/i);
  });
});

describe("condensation on surfaces", () => {
  it("where it forms is the whole diagnosis", () => {
    const q = getQuestion(getSymptom("condensation")!.start)!;
    expect(q.ask).toMatch(/where is the moisture/i);
    expect(q.answers).toHaveLength(4);
  });

  it("a ring around a diffuser is supply air escaping at the collar", () => {
    const q = getQuestion(getSymptom("condensation")!.start)!;
    const ring = q.answers.find((a) => a.label.includes("ceiling around a diffuser"))!;
    expect(getOutcome(outcomeId(ring.next))!.title).toMatch(/leaking into the ceiling/i);
  });

  it("sweating away from the system is called a building problem, not a fault", () => {
    const q = getQuestion(getSymptom("condensation")!.start)!;
    const walls = q.answers.find((a) => a.label.includes("windows and walls"))!;
    const out = getOutcome(outcomeId(walls.next))!;
    expect(out.confidence).toBe("info");
    expect(out.actions.join(" ")).toMatch(/bigger air conditioner isn't/i);
  });

  it("every grille wet is dew point; one grille wet is that grille", () => {
    const spread = getQuestion("cond.spread")!;
    const all = spread.answers.find((a) => a.label.includes("All of them"))!;
    expect(getOutcome(outcomeId(all.next))!.title).toMatch(/dew point is too high/i);

    const flow = getQuestion(spread.answers[0].next)!;
    expect(flow.id).toBe("cond.flow");
    expect(outcomeId(flow.answers[0].next)).toBe("cond-airflow");
    expect(flow.answers[1].next).toBe("cond.metal");
  });

  it("bare aluminium is its own diagnosis, and names the dew point numbers", () => {
    const metal = getQuestion("cond.metal")!;
    const alu = metal.answers.find((a) => a.label.includes("aluminium"))!;
    const out = getOutcome(outcomeId(alu.next))!;
    expect(out.title).toMatch(/aluminium/i);
    // the explanation has to carry the actual physics, not just "it's cold"
    expect(out.explain).toMatch(/dew point/i);
    expect(out.explain).toMatch(/conducts/i);
  });

  it("names the fan-speed trade-off, so the list isn't read as do-all-of-these", () => {
    const actions = getOutcome("cond-aluminium")!.actions;
    const joined = actions.join(" ");
    // more air warms the face but removes less moisture — the one real
    // tension in the list, and it isn't between fan speed and zoning
    expect(joined).toMatch(/less moisture/i);
    expect(joined).toMatch(/dew point creeps up/i);
    // and zoning is stated as the SAME lever, not a competing one
    expect(joined).toMatch(/same lever as the fan/i);
  });

  it("says plainly that powder coating and anodising do not fix it", () => {
    const out = getOutcome("cond-aluminium")!;
    // the diffuser swap is the permanent fix, offered beside the visit's fix
    // rather than as step nine of eleven
    const swap = out.alternatives!.find((a) => /thermal-break/i.test(a.fix))!;
    expect(swap.when).toMatch(/powder coating and anodising do NOT fix it/i);
    // and leads with the counter-intuitive one that actually works
    expect(out.actions.join(" ")).toMatch(/opposite of what most people expect/i);
    expect(out.actions[0]).toMatch(/raise the fan/i);
  });
});

describe("built for the field, not for a search box", () => {
  it("carries the DC-bus warning wherever board work is the next step", () => {
    for (const id of ["drive-limited", "control-board"]) {
      const out = getOutcome(id)!;
      expect(out.safety).toMatch(/DC bus|capacitors hold/i);
      expect(out.safety).toMatch(/prove them dead|meter/i);
    }
  });

  it("never gives DOL start-component advice as if it were universal", () => {
    // anywhere capacitors or start gear are mentioned, the inverter case
    // must be distinguished in the same breath. The compressor-proving tree
    // used to be exempt on the belief that its type question had settled it —
    // but that question asks single- or three-phase, and an inverter's
    // compressor is three-phase, so "open the contactor" was reaching motors
    // that have no contactor. No exemptions.
    for (const o of OUTCOMES) {
      const lines = [...o.actions, ...(o.alternatives ?? []).map((alt) => `${alt.fix} ${alt.when}`)];
      for (const a of lines) {
        if (/start component|capacitor and/i.test(a)) {
          expect(a).toMatch(/inverter/i);
        }
      }
    }
  });

  it("pressures on an inverter are read against compressor speed", () => {
    expect(getOutcome("go-pressures")!.actions.join(" ")).toMatch(/speed alongside every reading/i);
  });

  it("knows an inverter should ramp down, not stop-start", () => {
    expect(getOutcome("oversized")!.actions.join(" ")).toMatch(/ramp down and cruise/i);
  });

  it("reads the switchboard the Australian way — RCD versus MCB", () => {
    const q = getQuestion("brk.when")!;
    expect(q.why).toMatch(/safety switch \(RCD\)/i);
    expect(q.why).toMatch(/MCB/);
  });

  it("speaks Australian English and Australian weather", () => {
    const text = JSON.stringify({ QUESTIONS, OUTCOMES, SYMPTOMS });
    // the vocabulary a local tech expects
    for (const term of ["switchboard", "isolator", "roof space", "RCD"]) {
      expect(text).toContain(term);
    }
    // and none of the imports
    expect(text).not.toMatch(/attic|furnace|crawl ?space|freon|aluminum|anodized/i);
    // design-day heat is 40, not 95F
    expect(text).toMatch(/40.degree|40°C/);
  });
});

describe("proving a compressor — taught, not assumed", () => {
  const textFields = (): string[] => {
    const out: string[] = [];
    for (const q of QUESTIONS) {
      out.push(q.ask, q.why ?? "", q.safety ?? "");
      for (const a of q.answers) out.push(a.label, a.hint ?? "");
    }
    for (const o of OUTCOMES) {
      out.push(o.title, o.explain, o.customer ?? "", o.safety ?? "", ...o.actions);
      for (const alt of o.alternatives ?? []) out.push(alt.fix, alt.when);
    }
    for (const sy of SYMPTOMS) out.push(sy.label, sy.blurb, sy.safety ?? "");
    return out.filter(Boolean);
  };

  it("opens on setup, and 'not yet' gets the full walk instead of a shrug", () => {
    const gate = getQuestion(getSymptom("compressor")!.start)!;
    expect(gate.id).toBe("comp.iso");
    expect(gate.safety).toMatch(/stand to the side/i);
    const notYet = gate.answers.find((a) => a.label.includes("Not yet"))!;
    const setup = getOutcome(outcomeId(notYet.next))!;
    expect(setup.actions.join(" ")).toMatch(/lock or tag/i);
    expect(setup.actions.join(" ")).toMatch(/photograph the terminal lid/i);
    // discharge advice has to work with what's actually in the van: wait,
    // prove it with the meter everyone carries, and only then reach for a load
    const setupText = setup.actions.join(" ");
    expect(setupText).toMatch(/give the run capacitor a minute/i); // wait first
    expect(setupText).toMatch(/meter on DC volts/i); // prove with what's in hand
    expect(setupText).toMatch(/screwdriver/i); // the habit is named and banned
    expect(setupText).toMatch(/involuntary jerk/i); // and says what the real risk is
    // no tool is assumed to be in the van. A resistor may be SUGGESTED for the
    // kit, but the walk must work end to end without it — and must not lean on
    // props nobody carries (a test lamp was the second wrong guess here)
    expect(setupText).not.toMatch(/test lamp|incandescent|globe/i);
    expect(setupText).toMatch(/worth two dollars in the meter case/i);
    // a cap that won't self-drain is treated as a FINDING, not a puzzle
    expect(setupText).toMatch(/bleed resistor has failed/i);
    expect(setupText).toMatch(/due for replacement/i);
  });

  it("teaches the meter, not just the test", () => {
    const ohms1 = getQuestion("comp.1ph")!;
    // zeroing the leads, expected ranges, and the sum rule
    expect(ohms1.why).toMatch(/touch the leads together|REL/);
    expect(ohms1.why).toMatch(/0\.5–4/);
    expect(ohms1.why).toMatch(/equal the two added together/i);
    // the unmarked-terminal trick
    expect(ohms1.why).toMatch(/highest reading is R–S/i);
    // three-phase: balance over absolute number
    expect(getQuestion("comp.3ph")!.why).toMatch(/balance matters far more/i);
  });

  it("the megger step says what a megger IS, where the leads land, and the volts", () => {
    const earth = getQuestion("comp.earth")!;
    expect(earth.why).toMatch(/megger/i);
    expect(earth.why).toMatch(/500 V/);
    expect(earth.why).toMatch(/never test through a drive or a board/i);
    expect(earth.why).toMatch(/scrape the paint/i);
    // and the vacuum trap
    expect(earth.safety).toMatch(/under vacuum/i);
  });

  it("catches the internal-overload trap before a good motor gets condemned", () => {
    const q = getQuestion("comp.1ph")!;
    const sig = q.answers.find((a) => a.label.includes("R–S still reads"))!;
    const out = getOutcome(outcomeId(sig.next))!;
    expect(out.confidence).toBe("info"); // it is NOT a condemnation
    expect(out.actions[0]).toMatch(/cool/i);
    expect(out.explain).toMatch(/classic expensive mistake/i);
  });

  it("a sound compressor points at the start gear, with the capacitor test taught", () => {
    const sound = getOutcome("comp-sound")!;
    const joined = sound.actions.join(" ");
    expect(joined).toMatch(/prove it's discharged on DC volts first/i);
    expect(joined).toMatch(/take at least one capacitor lead off/i);
    expect(joined).toMatch(/µF/);
    expect(joined).toMatch(/ONE conductor only/);
    expect(joined).toMatch(/pitted or welded contacts/i);
  });

  it("'DC bus' never appears without plain words for what it is", () => {
    for (const t of textFields()) {
      if (t.includes("DC bus")) {
        expect(t).toMatch(/capacitor/i);
      }
    }
  });

  it("the outcomes that used to say 'insulation-test' now point at the walkthrough", () => {
    for (const id of ["short-earth", "rcd-moisture", "not-pumping"]) {
      expect(getOutcome(id)!.actions.join(" ")).toMatch(/Compressor suspect/);
    }
  });
});

describe("reading the oil — the only witness to why it died", () => {
  it("a compressor already off the wall has its own way in", () => {
    const gate = getQuestion(getSymptom("compressor")!.start)!;
    const out = gate.answers.find((a) => a.label.includes("already out"))!;
    expect(out.next).toBe("comp.oil");
    expect(out.hint).toMatch(/before the new one goes in/i);
  });

  it("teaches the acid test: sample, kit, cost, and read THAT kit's chart", () => {
    const q = getQuestion("comp.oil")!;
    expect(q.why).toMatch(/suction stub|drain plug/i); // where the sample comes from
    expect(q.why).toMatch(/wholesaler/i); // where the kit comes from
    expect(q.why).toMatch(/twenty or thirty dollars/i); // and that it's cheap
    expect(q.why).toMatch(/marked line/i); // how much oil
    expect(q.why).toMatch(/shake/i);
    expect(q.why).toMatch(/read THAT kit's chart/); // colours differ between brands
    expect(q.safety).toMatch(/acidic/i);
  });

  it("explains what a megger DOES, not just which setting to use", () => {
    const why = getQuestion("comp.earth")!.why!;
    expect(why).toMatch(/how much current leaks/i);
    expect(why).toMatch(/few volts off a battery/i); // why a multimeter can't
    expect(why).toMatch(/wholesaler/i); // and that one is buyable
  });

  it("metal with a clear acid test is its own diagnosis, not a null result", () => {
    const q = getQuestion("comp.oil")!;
    const metal = q.answers.find((a) => a.label.includes("Metal in it"))!;
    expect(metal.hint).toMatch(/even if the acid test comes back clear/i);
    const out = getOutcome(outcomeId(metal.next))!;
    expect(out.explain).toMatch(/acid test can come back completely clear/i);
    expect(out.explain).toMatch(/oil that stopped coming back/i);
    // the whole point: fix the cause or kill the replacement
    expect(out.actions[0]).toMatch(/BEFORE you quote/);
    expect(out.actions[0]).toMatch(/dies exactly the same way/i);
  });

  it("names the real oil-return culprits, including the inverter one", () => {
    const joined = getOutcome("oil-metal")!.actions.join(" ");
    expect(joined).toMatch(/oversized suction riser/i);
    expect(joined).toMatch(/traps at the foot of risers/i);
    expect(joined).toMatch(/minimum speed/i); // low-speed inverter running
    expect(joined).toMatch(/flush/i); // shavings are downstream now
  });

  it("every oil answer lands somewhere that says what to do about it", () => {
    for (const a of getQuestion("comp.oil")!.answers) {
      const out = getOutcome(outcomeId(a.next))!;
      expect(out.actions.length).toBeGreaterThanOrEqual(4);
    }
    // and clean oil still gets acid-tested, because early burnout hides there
    expect(getOutcome("oil-clean")!.actions[0]).toMatch(/acid test anyway/i);
  });
});

describe("words for the customer", () => {
  it("carries a script wherever explaining it is most of the job", () => {
    for (const id of ["cond-aluminium", "cond-humidity", "cond-building", "defrost-normal", "mode-conflict"]) {
      const out = getOutcome(id)!;
      expect(out.customer).toBeTruthy();
      expect(out.customer!.length).toBeGreaterThan(80);
    }
  });

  it("the script is plain speech, not the technical explanation repeated", () => {
    for (const o of OUTCOMES.filter((x) => x.customer)) {
      expect(o.customer).not.toBe(o.explain);
      // no jargon that would need explaining in turn
      expect(o.customer).not.toMatch(/dew point|superheat|subcool|static pressure|refrigerant circuit/i);
    }
  });

  it("the aluminium script reaches for the cold-drink analogy", () => {
    expect(getOutcome("cond-aluminium")!.customer).toMatch(/cold drink/i);
  });

  it("the water tree hands off here instead of keeping a thinner copy", () => {
    const where = getQuestion(getSymptom("water")!.start)!;
    const away = where.answers.find((a) => a.label.includes("Pipework or ceiling"))!;
    expect(away.next).toBe("cond.where");
    // the outcome it used to point at is gone, not orphaned
    expect(getOutcome("sweating")).toBeUndefined();
    // and the surviving outcome kept what that one knew about drain insulation
    expect(getOutcome("cond-insulation")!.actions.join(" ")).toMatch(/drain line/i);
  });

  it("stays distinct from the water-leak tree — nothing here has overflowed", () => {
    expect(getSymptom("condensation")!.label).not.toMatch(/leak/i);
    expect(getSymptom("water")!.label).toMatch(/leak/i);
  });
});

describe("ducted zoning", () => {
  it("splits on whether it's always the same room — that narrows it fastest", () => {
    const q = getQuestion(getSymptom("zoning")!.start)!;
    expect(q.ask).toMatch(/always the same rooms/i);
    expect(q.answers).toHaveLength(3);
  });

  it("weak everywhere is sent back to the cooling or heating path, not diagnosed here", () => {
    const q = getQuestion(getSymptom("zoning")!.start)!;
    const all = q.answers.find((a) => a.label.includes("Everything's weak"))!;
    const out = getOutcome(outcomeId(all.next))!;
    expect(out.confidence).toBe("info");
    expect(out.title).toMatch(/isn't a zoning problem/i);
    expect(out.actions[0]).toMatch(/not cooling.*not heating/i);
  });

  it("no air splits damper from duct; plenty of air splits return path from load", () => {
    const air = getQuestion("zone.air")!;
    expect(air.answers).toHaveLength(3);

    const none = getQuestion(air.answers[0].next)!;
    expect(none.id).toBe("zone.damper");
    expect(none.answers.map((a) => outcomeId(a.next))).toEqual(["zone-damper", "zone-duct"]);

    const plenty = getQuestion(air.answers[2].next)!;
    expect(plenty.id).toBe("zone.return");
    expect(plenty.answers.map((a) => outcomeId(a.next))).toEqual(["zone-return", "zone-load"]);
  });

  it("the moving problem separates too-few-zones from can't-do-them-all", () => {
    const q = getQuestion("zone.count")!;
    const [few, all] = q.answers.map((a) => getOutcome(outcomeId(a.next))!);
    expect(few.title).toMatch(/too much of the system shut down/i);
    expect(all.title).toMatch(/can't run every zone at once/i);
    expect(all.tool!.href).toContain("heat-load");
  });

  it("stays out of the multi tree's way — this one is ducted", () => {
    const s = getSymptom("zoning")!;
    expect(s.blurb).toMatch(/ducted/i);
    // the multi tree owns "one head out", this one owns "one room out"
    expect(getSymptom("multi")!.blurb).toMatch(/head/i);
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

  it("heating collapses three questions into the same one walk-around", () => {
    // heat.odu + heat.iced + heat.warm were one lap at the outdoor unit
    const state = getQuestion("heat.state")!;
    expect(state.answers).toHaveLength(4);
    for (const gone of ["heat.odu", "heat.iced", "heat.warm"]) {
      expect(getQuestion(gone)).toBeUndefined();
    }
    // every outcome the old chain could reach is still reachable
    const reached = new Set(
      state.answers.filter((a) => isOutcomeRef(a.next)).map((a) => outcomeId(a.next))
    );
    expect(reached).toContain("odu-no-power");
    expect(reached).toContain("defrost-fault");
    expect(reached).toContain("heat-none");
  });

  it("cold air in heat mode skips the filter check, and says why", () => {
    // starved airflow makes weak WARM air, never cold air — so filters were
    // never a candidate on that branch, and the outcome must not claim they
    // were checked
    const cold = getQuestion("heat.state")!.answers.find((a) => a.label.includes("the air is cold"))!;
    expect(outcomeId(cold.next)).toBe("heat-none");
    const out = getOutcome("heat-none")!;
    expect(out.explain).not.toMatch(/clean airflow/i);
    expect(out.explain).toMatch(/never cold air/i);
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
