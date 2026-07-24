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
    // re-piping is a recovery-and-recharge job; re-landing comms isn't
    expect(pipes.escalate).toBe(true);
    expect(comms.escalate).toBeFalsy();
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
    expect(out.escalate).toBe(true);
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
    const actions = getOutcome("cond-aluminium")!.actions.join(" ");
    expect(actions).toMatch(/powder coating and anodising do NOT fix it/i);
    // and leads with the counter-intuitive one that actually works
    expect(actions).toMatch(/opposite of what most people expect/i);
    expect(getOutcome("cond-aluminium")!.actions[0]).toMatch(/raise the fan/i);
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
    // must be distinguished in the same breath — EXCEPT inside the
    // compressor-proving tree, where the type question has already been
    // answered before any of these outcomes can be reached
    for (const o of OUTCOMES) {
      if (o.id.startsWith("comp-")) continue;
      for (const a of o.actions) {
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
    expect(setup.actions.join(" ")).toMatch(/bleed resistor/i);
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
    expect(earth.why).toMatch(/never test through the drive/i);
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
    expect(joined).toMatch(/discharge it first/i);
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
