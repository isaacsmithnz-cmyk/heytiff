/* Fault Finder — guided diagnostic trees. Pure data + helpers, no React
   (lib/studio discipline).

   The tool walks a tech through one question at a time, the way you'd walk an
   apprentice through a callout: look at the obvious thing first, and let the
   answer decide what to look at next. That means a decision TREE, not a list
   of causes — each answer either asks the next question or lands on an
   outcome (what it probably is + what to do about it).

   Every question has to earn its place by narrowing the fault. A question
   that branches on what's in the tech's toolbag rather than on what the
   machine is doing belongs in the outcome, not in the tree.

   Content is generic split / ducted / multi / VRF field knowledge. NO
   manufacturer fault-code tables: codes vary per brand and model, and
   universal-table data only enters HeyTiff through uploaded documents.

   THAT IS WHY `library` EXISTS. Refusing to invent a code table is right;
   ending the walk at "read the service manual" was not, because the manuals
   are in the workspace's own library and the tech is standing there holding
   the code. The outcomes that land on a code carry the flag, and the tool
   hands the code to Tiff rather than to the glovebox. */

export type SymptomKey =
  | "cooling"
  | "heating"
  | "power"
  | "water"
  | "ice"
  | "cycling"
  | "noise"
  | "breaker"
  | "smell"
  | "code"
  | "multi"
  | "pumping"
  | "zoning"
  | "condensation"
  | "compressor";

export interface Symptom {
  key: SymptomKey;
  label: string;
  blurb: string;
  /** shell icon.tsx name */
  icon: string;
  /** accent colour for the tile + trail */
  color: string;
  /** first question id */
  start: string;
  /** shown before the first question when the whole area needs care */
  safety?: string;
}

export interface Answer {
  label: string;
  /** optional clarifier under the answer label */
  hint?: string;
  /** next question id, or an outcome id prefixed "out:" */
  next: string;
}

export interface Question {
  id: string;
  /** the question itself — short, answerable by looking */
  ask: string;
  /** how to actually check it, when that isn't obvious */
  why?: string;
  /** safety note specific to this step */
  safety?: string;
  answers: Answer[];
}

/** Another way to fix it, beside the best one. */
export interface Alternative {
  /** the fix itself, said as an instruction */
  fix: string;
  /** when this is the one to pick instead, and what it costs — without this
      a list of fixes reads as do-all-of-these */
  when: string;
  /** licensed / specialist work beyond a routine visit */
  escalate?: boolean;
}

export interface Outcome {
  id: string;
  title: string;
  /** how sure the tree is at this point */
  confidence: "likely" | "possible" | "info";
  /** the reasoning, in plain language */
  explain: string;
  /** ordered next actions. With `alternatives` beside them these are the
      BEST fix: the one a tech should reach for first on this visit, which is
      usually the cheapest thing that actually solves it. Crossed pipework used
      to lead with re-piping — recover, braze, recharge — when moving two
      cables at a terminal block does the same job, and the audit that found it
      found the same shape a dozen more times: a clip-on coil, a closed service
      valve or a slipped sensor sitting behind a Specialist badge. */
  actions: string[];
  /** Other ways to fix it — quicker, cheaper, temporary, or the heavy job for
      when the best fix isn't enough — each saying WHEN it's the one to pick.
      Only where a real alternative exists; never padded to make a pair. */
  alternatives?: Alternative[];
  /** What the steps ARE, which decides what the screen calls them. Required
      wherever there are alternatives, and decided by hand every time:

      "fix"   — the steps are the repair, and the options are other ways to
                do it. Heads as "Best fix" / "Other options". Crossed
                pipework: move the cables; or run the wiring check, or
                re-pipe.
      "check" — the steps rule cheaper look-alikes out, and the options are
                the repairs the findings point to. Heads as "Check first" /
                "Depending on what you find".

      It exists because the label used to default. "Compressor isn't pumping"
      read "Best fix: measure the running current", with "Replace the
      compressor" underneath as an OTHER option — a list of checks wearing
      the fix's heading, on about half the outcomes that have options
      (Isaac, on seeing it: "what on earth?"). */
  plan?: "fix" | "check";
  /** Plain words to say on site, for the outcomes where explaining it IS
      half the job — the "nothing is broken" calls that get argued about
      because the honest answer sounds like an excuse. */
  customer?: string;
  /** safety note specific to acting on this outcome — rendered as the same
      red alert the questions use */
  safety?: string;
  /** licensed / specialist work beyond a routine visit — said of the BEST
      fix. When only a fallback needs it, the alternative carries the flag and
      the outcome doesn't: a badge over a routine fix sends a tech off to book
      a job they could have done standing there. */
  escalate?: boolean;
  /** hand-off to another Toolbox tool */
  tool?: { label: string; href: string };
  /** This diagnosis ends on a code, and a code is the one thing these trees
      cannot answer (see the header). Marks the outcomes that offer to take the
      code straight to the library instead of stopping at "read the manual" —
      the manuals are in there, and the tech is already holding the code. */
  library?: true;
}

/* ───────────────────────────── symptoms ───────────────────────────── */

export const SYMPTOMS: Symptom[] = [
  {
    key: "cooling",
    label: "Not cooling",
    blurb: "Runs but the room stays warm",
    icon: "thermo",
    color: "#2E68FF",
    start: "cool.mode",
  },
  {
    key: "heating",
    label: "Not heating",
    blurb: "Heat mode, little warm air",
    icon: "flame",
    color: "#FF8A00",
    start: "heat.mode",
  },
  {
    key: "power",
    label: "Won't turn on",
    blurb: "Dead — nothing responds",
    icon: "power",
    color: "#6B7280",
    start: "pwr.alive",
  },
  {
    key: "water",
    label: "Water leaking",
    blurb: "Dripping indoors",
    icon: "droplet",
    color: "#38BDF8",
    start: "water.where",
  },
  {
    key: "ice",
    label: "Ice on pipes or coil",
    blurb: "Frost where it shouldn't be",
    icon: "snowflake",
    color: "#22D3EE",
    start: "ice.where",
    safety:
      "Never chip or scrape ice off a coil — the fins and tubes damage easily. Melt it with the system off or on fan only.",
  },
  {
    key: "cycling",
    label: "Short cycling",
    blurb: "Starts and stops constantly",
    icon: "rotate",
    color: "#8A2BE2",
    start: "cyc.howlong",
  },
  {
    key: "noise",
    label: "Noisy",
    blurb: "Rattles, squeals, gurgles",
    icon: "volume",
    color: "#00A389",
    start: "noise.kind",
  },
  {
    key: "breaker",
    label: "Trips the breaker",
    blurb: "RCD or MCB drops out",
    icon: "zap",
    color: "#FF3366",
    start: "brk.when",
    safety:
      "Repeated tripping is protection doing its job. Don't hold or repeatedly reset the breaker — electrical fault-finding is licensed work.",
  },
  {
    key: "smell",
    label: "Bad smell",
    blurb: "Musty, sour or burning",
    icon: "cloud",
    color: "#84CC16",
    start: "smell.kind",
  },
  {
    key: "code",
    label: "Error light or code",
    blurb: "Blinking LEDs or a code",
    icon: "alert",
    color: "#E0244B",
    start: "code.recorded",
  },
  {
    key: "multi",
    label: "Multi or VRF",
    blurb: "One head out, or mode clash",
    icon: "layers",
    color: "#D946EF",
    start: "vrf.scope",
  },
  {
    key: "pumping",
    label: "Pressures won't split",
    blurb: "Suction and discharge equalise",
    icon: "gauge",
    color: "#4F46E5",
    start: "nop.running",
  },
  {
    key: "zoning",
    label: "Some rooms, not others",
    blurb: "Ducted — one room misses out",
    icon: "wind",
    color: "#EAB308",
    start: "zone.which",
  },
  {
    key: "condensation",
    label: "Sweating surfaces",
    blurb: "Damp grilles, ceilings or duct",
    icon: "pipe",
    color: "#0891B2",
    start: "cond.where",
  },
  {
    key: "compressor",
    label: "Compressor suspect",
    blurb: "Prove it before you condemn it",
    icon: "activity",
    color: "#14B8A6",
    start: "comp.iso",
    safety:
      "Compressor testing is done dead: isolated, leads off, capacitors discharged. The first step walks all of that — don't skip it.",
  },
];

/* ───────────────────────────── questions ─────────────────────────────
   Ordered roughly by symptom. Ids are namespaced by symptom so a stray
   reference is obvious on sight. */

export const QUESTIONS: Question[] = [
  /* ---------------- not cooling ---------------- */
  {
    id: "cool.mode",
    ask: "Is it set to COOL, with the setpoint below room temperature?",
    why: "Check the remote or wall controller — and watch the unit answer with its beep or its lamp, because a handheld remote shows what the REMOTE thinks: it can sit on COOL while the head never got the message. Auto mode can sit in heating, fan-only and dry won't pull the room down, and a schedule or eco limit can cap how low the setpoint will go. Five seconds, and it's a top-three cause of a no-cool callout.",
    answers: [
      { label: "No — or I'm not sure", next: "out:settings-cool" },
      { label: "Yes, definitely cooling", next: "cool.state" },
    ],
  },
  {
    /* One walk-around, not two questions. A tech checks the outdoor unit and
       feels the air on the same lap, so asking them separately spent a step
       to learn nothing the first look didn't already give. */
    id: "cool.state",
    ask: "Walk up to it — what's actually happening?",
    why: "Two things in one look. At the outdoor unit the fan should be turning and the compressor humming; give it a few minutes after a start, some units delay. At the indoor unit, hand in front of the outlet — or measure the return-to-supply split, around 8–12 K on a stabilised system with a reasonably dry coil.",
    answers: [
      { label: "The outdoor unit isn't running", next: "cool.indoor" },
      {
        label: "Running, and the air is properly cold",
        hint: "It cools — the room just isn't getting there",
        next: "cool.load",
      },
      { label: "Running, but the air is barely cool", next: "cool.filters" },
    ],
  },
  {
    id: "cool.indoor",
    ask: "Does the indoor unit respond at all?",
    why: "Lights, display, a beep on the remote, or the fan running.",
    answers: [
      { label: "Yes, indoor works", hint: "Only the outdoor unit is dead", next: "out:odu-no-power" },
      { label: "No, nothing at all", next: "out:no-power" },
    ],
  },
  {
    id: "cool.load",
    ask: "Is anything adding heat the system has to fight?",
    why: "Doors or windows open, more people or equipment than usual, big west-facing glass, a roller door, a new server rack.",
    answers: [
      { label: "Yes, there's extra load", next: "out:load-excess" },
      { label: "No, nothing's changed", next: "out:undersized" },
    ],
  },
  {
    id: "cool.filters",
    ask: "Are the filters and indoor coil clean, with the fan on a normal speed?",
    why: "Pull the filters out and look at the coil face behind them. Check the return grille isn't blocked by furniture or curtains — and that the indoor fan is actually moving air at a normal speed. A slow or failing fan reads exactly like a dirty filter at the grille.",
    answers: [
      { label: "Dirty, blocked, or fan on low", next: "out:airflow-starved" },
      { label: "Clean, good airflow", next: "cool.ice" },
    ],
  },
  {
    id: "cool.ice",
    ask: "Any frost or ice on the suction line or the indoor coil?",
    answers: [
      { label: "Yes, there's ice", next: "out:icing" },
      { label: "No ice", next: "cool.coil" },
    ],
  },
  {
    id: "cool.coil",
    ask: "Is the outdoor coil clean, with clear space around it?",
    why: "Check between the fins, not just the face. Look for a fence, plants, a clothesline or a wall recirculating the discharge air back in.",
    answers: [
      { label: "Dirty or blocked in", next: "out:condenser-blocked" },
      { label: "Clean and clear", next: "out:go-pressures" },
    ],
  },

  /* ---------------- not heating ---------------- */
  {
    id: "heat.mode",
    ask: "Is it actually in HEAT mode with the setpoint above room temperature?",
    why: "Check the remote or wall controller, and watch the unit answer with its beep or its lamp — a handheld remote shows what the REMOTE thinks, and can sit on HEAT while the head never got it. Auto mode can sit in cooling, and a schedule or eco limit can cap the setpoint.",
    answers: [
      { label: "No — or I'm not sure", next: "out:settings" },
      { label: "Yes, definitely heating", next: "heat.defrost" },
    ],
  },
  {
    id: "heat.defrost",
    ask: "Is the outdoor unit steaming, or the indoor fan pausing for a few minutes?",
    why: "That's a defrost cycle: the outdoor coil ices in cold weather and the system reverses briefly to clear it. Normal in winter.",
    answers: [
      { label: "Yes, that's happening now", next: "out:defrost-normal" },
      { label: "No, nothing like that", next: "heat.state" },
    ],
  },
  {
    /* Heating lives or dies at the outdoor unit, and you're standing there
       anyway — so running, iced and air temperature are one lap rather than
       three questions. Replaces heat.odu + heat.iced + heat.warm.

       Splitting warm-from-cold here also skips the filter check on the cold
       branch, which is correct: starved airflow makes weak warm air, never
       cold air, so it was never a candidate for that answer. */
    id: "heat.state",
    ask: "Walk up to it — what's actually happening?",
    why: "Three things on one lap. At the outdoor unit: is the fan turning, and is the coil clear? Frost that clears on a defrost is normal — solid ice that never goes is not. Then indoors, hand in front of the outlet. Warm-but-weak and stone-cold are completely different faults, so be honest about which one you've got.",
    answers: [
      { label: "The outdoor unit isn't running", next: "out:odu-no-power" },
      { label: "Running, but the outdoor coil is iced solid", next: "out:defrost-fault" },
      {
        label: "Running and clear, and the air is warm",
        hint: "Warm — just not keeping up",
        next: "heat.filters",
      },
      {
        label: "Running and clear, but the air is cold",
        hint: "Cold, or no better than room temperature",
        next: "out:heat-none",
      },
    ],
  },
  {
    id: "heat.filters",
    ask: "Are the filters and indoor coil clean, with the fan on a normal speed?",
    why: "Same check as the cooling side: pull the filters, look at the coil face behind them, and confirm the indoor fan is actually moving air. In heating it also matters that the louvres point down — warm air stratifies at the ceiling and the room never feels it.",
    answers: [
      { label: "Dirty, blocked, or fan on low", next: "out:airflow-starved" },
      { label: "Clean, good airflow", next: "out:heat-capacity" },
    ],
  },

  /* ---------------- won't turn on ---------------- */
  {
    id: "pwr.alive",
    ask: "Any light, display or beep from the indoor unit?",
    answers: [
      { label: "Nothing at all", next: "pwr.supply" },
      { label: "Yes, it shows signs of life", next: "pwr.manual" },
    ],
  },
  {
    id: "pwr.supply",
    ask: "Check the switchboard and the outdoor isolator — is anything off or tripped?",
    why: "The isolator is usually a small grey switch on the wall near the outdoor unit. Also check the unit's own breaker at the board.",
    answers: [
      { label: "Found something off or tripped", next: "out:restore-power" },
      { label: "All on, nothing tripped", next: "out:no-power" },
    ],
  },
  {
    id: "pwr.manual",
    ask: "Does it respond to the manual ON button under the front panel?",
    why: "Most indoor units have a small emergency/test button behind or under the flap. If that starts it, the unit is fine and the problem is how you're commanding it.",
    answers: [
      { label: "Yes, it starts", next: "out:remote-fault" },
      { label: "No response", next: "pwr.timer" },
    ],
  },
  {
    id: "pwr.timer",
    ask: "Is a timer, schedule, eco or away mode holding it off?",
    why: "Look for a timer icon on the display, a weekly schedule on the wall controller, or a smart-home integration overriding it.",
    answers: [
      { label: "Yes, something's set", next: "out:timer-holding" },
      { label: "No, nothing set", next: "pwr.float" },
    ],
  },
  {
    id: "pwr.float",
    ask: "Ducted or cassette — is the safe tray wet, or the drain blocked?",
    why: "A tripped float switch stops the unit starting to prevent an overflow. Worth ruling out before condemning electronics.",
    answers: [
      { label: "Yes, wet tray or blocked drain", next: "out:float-tripped" },
      { label: "Dry, or it's a wall split", next: "pwr.phase" },
    ],
  },
  {
    id: "pwr.phase",
    ask: "Is it three-phase, with a phase protection relay?",
    why: "Most three-phase units carry a phase failure or phase sequence relay that blocks the start on a lost, reversed or badly unbalanced supply. When that's holding the unit off it's doing its job, and the fault is upstream in the supply rather than in the air conditioner. Worth ruling out before condemning a board.",
    answers: [
      { label: "Yes, and the relay is indicating a fault", next: "out:phase-protection" },
      { label: "Single-phase, or the relay is happy", next: "out:control-board" },
    ],
  },

  /* ---------------- water leaking ---------------- */
  {
    id: "water.where",
    ask: "Where is the water actually coming from?",
    answers: [
      { label: "The indoor unit itself", hint: "Dripping from the head or grille", next: "water.drain" },
      /* Deliberate hand-off across trees: water away from the unit isn't an
         overflow, it's condensation — and the condensation tree already asks
         the right next question. Better than keeping a second, thinner copy
         of those outcomes here. */
      { label: "Pipework or ceiling nearby", next: "cond.where" },
      { label: "Outside, at the outdoor unit", next: "out:outdoor-water" },
    ],
  },
  {
    id: "water.drain",
    ask: "Is water running out of the drain outlet outside while it's cooling?",
    why: "Find the drain discharge point and watch it. A healthy system produces a steady trickle in humid weather — but in dry air it legitimately makes almost none, so check what the room's humidity is doing before you call a dry outlet a blockage.",
    answers: [
      { label: "Nothing, or barely a drip", next: "water.pump" },
      { label: "Yes, flowing normally", next: "water.ice" },
    ],
  },
  {
    id: "water.pump",
    ask: "Does this unit have a condensate pump?",
    why: "Ducted and cassette units often do. Listen for it humming or cycling; lifting the float should start it.",
    answers: [
      { label: "Yes, there's a pump", next: "out:pump-fault" },
      { label: "No, gravity drain", next: "water.age" },
    ],
  },
  {
    /* Age is the cheapest discriminator in the whole water tree and it costs
       nothing to ask: a drain that never had fall, trap or connection right
       has leaked since day one, while a drain that ran for five summers and
       then stopped is silted up. They are not the same job. */
    id: "water.age",
    ask: "Has it always done this, or did it start recently?",
    why: "Ask the customer. It separates an installation fault from a maintenance one before you spend an hour clearing a line that was never going to work.",
    answers: [
      {
        label: "It's new, or has never been right",
        hint: "Since install, or since someone worked on it",
        next: "out:drain-install",
      },
      { label: "It drained fine for years, then started", next: "out:drain-blocked" },
    ],
  },
  {
    id: "water.ice",
    ask: "Any ice on the indoor coil?",
    why: "Look while it's RUNNING, or the moment you stop it. Ice melts in bursts between cycles and overwhelms the tray, which looks like a drain fault but isn't — and a coil that ices on the run can be bare ten minutes later, so a late 'no ice' sends you to the tray for a gas fault.",
    answers: [
      { label: "Yes, there's ice", next: "out:icing" },
      { label: "No ice", next: "out:tray-or-fall" },
    ],
  },

  /* ---------------- ice ---------------- */
  {
    id: "ice.where",
    ask: "Where is the ice?",
    answers: [
      { label: "Indoor coil or suction line", next: "ice.filters" },
      { label: "Outdoor coil, in heating", next: "out:defrost-fault" },
    ],
  },
  {
    id: "ice.filters",
    ask: "Once it's thawed — are the filters and coil clean, with the fan on a normal speed?",
    why: "Starved airflow is the most common cause of a frozen coil. Look past the filters at the fan wheel too — the barrel behind a wall unit's louvres, or a ducted unit's blower — because dust packed on its blades starves the coil with spotless filters. Ducted: check for crushed flexible duct, and how many zones are shut.",
    answers: [
      { label: "Dirty, blocked, or fan on low", next: "out:airflow-starved" },
      { label: "All clean and moving air", next: "ice.ambient" },
    ],
  },
  {
    id: "ice.ambient",
    ask: "Is it being run in cooling when it's cold outside?",
    why: "Below roughly 15°C ambient, cooling without low-ambient (head pressure) control will ice a coil. Common in server rooms.",
    answers: [
      { label: "Yes, cooling in cold weather", next: "out:low-ambient" },
      { label: "No, normal conditions", next: "out:charge-or-valve" },
    ],
  },

  /* ---------------- short cycling ---------------- */
  {
    id: "cyc.howlong",
    ask: "How long does it run before it stops?",
    why: "Time the compressor, not the indoor fan — listen at the outdoor unit. An inverter winding down to a murmur hasn't stopped, and a head that keeps its fan going between runs is cycling normally. Customers report both as switching off.",
    answers: [
      { label: "Under a couple of minutes", next: "cyc.error" },
      { label: "A few minutes to ten", next: "cyc.reaching" },
    ],
  },
  {
    id: "cyc.error",
    ask: "Does it show an error or blink pattern when it stops?",
    why: "Very short runs usually mean a protection device is cutting it out rather than the thermostat being satisfied.",
    answers: [
      { label: "Yes, there's a code or blink", next: "out:protection-coded" },
      { label: "No, it just stops", next: "out:protection-silent" },
    ],
  },
  {
    id: "cyc.reaching",
    ask: "Is the room actually reaching the setpoint before it stops?",
    answers: [
      { label: "Yes, it satisfies quickly", next: "out:oversized" },
      { label: "No, the room is still warm", next: "out:sensor-misread" },
    ],
  },

  /* ---------------- noise ---------------- */
  {
    id: "noise.kind",
    ask: "What kind of noise is it?",
    answers: [
      { label: "Rattle or buzz", next: "noise.panels" },
      { label: "Squeal or grinding", next: "out:bearing-motor" },
      { label: "Gurgle or hiss", next: "noise.gurgle" },
      { label: "Bang or thump on start / stop", next: "out:mounts" },
    ],
  },
  {
    id: "noise.panels",
    ask: "Does pressing on the panels change or stop the noise?",
    answers: [
      { label: "Yes, it changes", next: "out:loose-panels" },
      { label: "No difference", next: "out:fan-debris" },
    ],
  },
  {
    id: "noise.gurgle",
    ask: "Is it only at start-up, shutdown or during defrost?",
    answers: [
      { label: "Yes, only then", next: "out:gurgle-normal" },
      { label: "No, it's constant while running", next: "out:gurgle-charge" },
    ],
  },

  /* ---------------- breaker ---------------- */
  {
    id: "brk.when",
    ask: "When does it trip?",
    why: "And note WHICH device lets go while you're at the board. The safety switch (RCD) tripping points at current leaking to earth; the MCB tripping points at overcurrent. Same dead unit, different fault entirely.",
    answers: [
      { label: "Instantly, the moment it starts", next: "out:short-earth" },
      { label: "After it's been running a while", next: "brk.condenser" },
      { label: "Randomly, mostly in wet weather", next: "out:rcd-moisture" },
    ],
  },
  {
    id: "brk.condenser",
    ask: "Is the outdoor coil clean and the fan running properly?",
    why: "A blocked condenser drives head pressure — and current — up until the breaker lets go.",
    answers: [
      { label: "Dirty coil or fan problem", next: "out:head-pressure-amps" },
      { label: "Clean, fan runs fine", next: "out:compressor-amps" },
    ],
  },

  /* ---------------- smell ---------------- */
  {
    id: "smell.kind",
    ask: "What does it smell like?",
    answers: [
      { label: "Burning or electrical", next: "out:electrical-smell" },
      { label: "Musty or mouldy", next: "out:mould" },
      { label: "Sour, like dirty socks", next: "out:biofilm" },
      { label: "Sewer or something decaying", next: "out:trap-pest" },
    ],
  },

  /* ---------------- error code ---------------- */
  {
    id: "code.recorded",
    ask: "Have you recorded the exact code or blink pattern?",
    why: "Which LEDs, how many flashes, and the pause length. Photograph the controller — the pattern is the whole diagnosis and it's lost once you clear it. Better still, read it out of the unit: most keep a fault history you can call up on a wired controller or in check mode, which beats counting flashes on a ladder.",
    answers: [
      { label: "Not yet", next: "out:record-first" },
      { label: "Yes, I've got it", next: "code.persists" },
    ],
  },
  {
    id: "code.persists",
    ask: "After one power cycle at the isolator, does the code come back?",
    why: "Isolate for a full minute, restore, and run it under load. Read the fault history first where the unit keeps one: the power cycle clears the display, not the log, so you keep the evidence either way.",
    answers: [
      { label: "Yes, it returns", next: "out:code-persists" },
      { label: "No, it's cleared", next: "out:code-transient" },
    ],
  },

  /* ---------------- multi / VRF ----------------
     These systems fail in ways a single split can't: one head out of many,
     heads disagreeing about mode, a shared outdoor unit that was never
     sized to run everything at once. Scope is the question that narrows it
     fastest, so it goes first. */
  {
    id: "vrf.scope",
    ask: "How much of the system is affected?",
    why: "This narrows a multi or VRF further than anything else you can ask. One head points at that branch; everything points at the outdoor unit, the charge or the design; heads disagreeing about mode usually isn't a fault at all.",
    answers: [
      { label: "One indoor unit", hint: "The others are working normally", next: "vrf.one" },
      { label: "Everything on this outdoor unit", next: "vrf.all" },
      { label: "Some heads heat while others want cool", next: "vrf.mode" },
      { label: "A head is warm or cold when it's off", next: "out:vrf-creep" },
      {
        label: "The wrong room responds",
        hint: "One head's controller runs another head",
        next: "vrf.crossed",
      },
    ],
  },
  {
    id: "vrf.one",
    ask: "Does that head respond to its own controller?",
    why: "Lights, a beep, the fan running, the louvre moving. You're separating a dead head from a running head that just isn't conditioning.",
    answers: [
      { label: "No, it's dead", next: "vrf.one.power" },
      { label: "Yes, it runs — but no heating or cooling", next: "vrf.one.flow" },
    ],
  },
  {
    id: "vrf.one.power",
    ask: "Does that head have its own supply, and is it on?",
    why: "Most multi and VRF indoor units are fed locally, with the transmission line carrying only comms. A dead head sitting beside live ones is usually its own breaker, or the comms line that reaches it.",
    answers: [
      { label: "Found its supply off or tripped", next: "out:restore-power" },
      { label: "Supply is present at the head", next: "out:vrf-comms" },
    ],
  },
  {
    id: "vrf.one.flow",
    ask: "With that head calling, do its pipes change temperature?",
    why: "Feel the liquid and gas lines at the head, or at the branch box if you can reach it. You're asking one thing: is refrigerant arriving at this circuit at all?",
    answers: [
      { label: "No, they stay at room temperature", next: "out:vrf-branch" },
      { label: "Yes, they get cold or hot", next: "out:vrf-head-airside" },
    ],
  },
  {
    id: "vrf.mode",
    ask: "Is this a two-pipe system, or three-pipe heat recovery?",
    why: "A two-pipe multi or VRF shares one circuit and can only run one mode at a time — the first head to call, or a designated master, sets it. Three-pipe heat recovery, with branch controllers, can genuinely heat and cool at once. Count the pipes at the outdoor unit if the paperwork is missing.",
    answers: [
      { label: "Two-pipe, or not sure", next: "out:mode-conflict" },
      { label: "Three-pipe heat recovery", next: "vrf.mode.bc" },
    ],
  },
  {
    id: "vrf.mode.bc",
    ask: "Does the affected head change over once the others are switched off?",
    why: "If it only misbehaves while the rest of the system is calling the other way, it's being held by mode priority. If it won't change over even on its own, the valve set serving it isn't shifting.",
    answers: [
      { label: "Yes, it works on its own", next: "out:mode-priority" },
      { label: "No, it still won't change over", next: "out:bc-valve" },
    ],
  },
  {
    id: "vrf.all",
    ask: "Is the outdoor unit running?",
    answers: [
      { label: "No, it's dead", next: "out:odu-no-power" },
      { label: "Yes, it's running", next: "vrf.all.calling" },
    ],
  },
  {
    id: "vrf.all.calling",
    ask: "Is every head calling at once, on a hot or cold day?",
    why: "Multi and VRF outdoor units are deliberately sized below the total of the heads connected to them — a connection ratio over 100% is normal design, not a mistake. With everything calling on a design day, no head gets its full nameplate.",
    answers: [
      { label: "Yes, the whole system is calling", next: "out:vrf-diversity" },
      { label: "No, only one or two are on", next: "vrf.all.charge" },
    ],
  },
  {
    id: "vrf.all.charge",
    ask: "Was extra refrigerant weighed in for the pipe run at commissioning?",
    why: "These systems ship with enough charge for a nominal run and need a calculated top-up per additional metre. Check the commissioning sheet, or the charge label inside the outdoor unit's cover.",
    answers: [
      { label: "No record, or clearly not", next: "out:vrf-charge" },
      { label: "Yes, it's documented", next: "out:vrf-monitor" },
    ],
  },
  {
    id: "vrf.crossed",
    ask: "Shut it all down, then start one head on its own — what happens?",
    why: "The definitive test for a crossed install. Turn everything off, start a single head from its own controller, then go and stand in that room. Pipework and comms are run separately on a multi, so they can be crossed independently — and the two faults look nothing alike.",
    answers: [
      { label: "A different head starts up", next: "out:vrf-crossed-comms" },
      {
        label: "The right head runs, but only gets cold when another head calls",
        next: "out:vrf-crossed-pipes",
      },
    ],
  },

  /* ---------------- pressures won't split ----------------
     Suction and discharge sitting on top of each other means the compressor
     isn't moving gas. What can even be wrong depends on the compressor:
     a fixed-speed (DOL) three-phase scroll runs whichever way the supply
     turns it, so reverse rotation comes first there and carries a stop-now
     warning. An inverter builds its own three phases from a DC bus — the
     drive sets the rotation, swapped supply phases can't run it backwards,
     and the question becomes whether the drive is letting it ramp at all. */
  {
    id: "nop.running",
    ask: "Is the compressor actually running while you're reading that?",
    why: "Equalising is exactly what a system does at rest — leave it off a few minutes and the two gauges always meet. It's only a fault if they stay together while the compressor runs. And check both valves on your gauge manifold are shut: an open one joins the two sides through the gauge set, and a perfectly good compressor reads equal.",
    answers: [
      { label: "No, it's stopped", next: "out:equal-at-rest" },
      { label: "Yes, it's running", next: "nop.type" },
    ],
  },
  {
    id: "nop.type",
    ask: "Is it an inverter unit, or fixed-speed?",
    why: "Check the data plate — this decides what can even be wrong. A fixed-speed (DOL) three-phase scroll runs whichever way the supply spins it, so swapped phases make it pump nothing. An inverter rectifies the supply onto a bank of big storage capacitors — that bank is called the DC bus — and builds its own three phases from it, so the drive sets the rotation and swapped supply phases can't run it backwards. Most splits and VRF on the wall today are inverter; DOL three-phase is alive and well in plant rooms and cool rooms.",
    answers: [
      { label: "Fixed-speed, three-phase", next: "nop.rotation" },
      { label: "Fixed-speed, single-phase", next: "nop.valve" },
      { label: "Inverter", hint: "Variable speed — most modern splits and VRF", next: "nop.ramp" },
    ],
  },
  {
    id: "nop.rotation",
    ask: "Is the phase sequence at the unit correct?",
    why: "Swap any two phases and a scroll turns backwards. It still energises and still draws current, but it moves nothing — so the gauges never separate — and it runs noticeably louder than normal. Confirm with a rotation meter at the supply terminals.",
    safety:
      "Reverse rotation wrecks a scroll in minutes. Isolate it now rather than leaving it running while you work this out. Testing and correcting phase sequence is licensed electrical work.",
    answers: [
      { label: "Reversed, or I can't confirm it", next: "out:reverse-rotation" },
      { label: "Sequence is correct", next: "nop.valve" },
    ],
  },
  {
    id: "nop.ramp",
    ask: "Watch a restart — does the compressor actually ramp up?",
    why: "Isolate, wait out the restart delay, then start it with a call for full demand. An inverter creeps for the first minute or two and then climbs — you'll hear it, and the discharge line will warm under your hand. One that starts and stays at a murmur, or winds back every time it tries to climb, isn't failing to pump — the drive is holding it.",
    answers: [
      { label: "It holds at a crawl, or keeps winding back", next: "out:drive-limited" },
      { label: "It ramps up hard, pressures still won't split", next: "nop.valve" },
    ],
  },
  {
    id: "nop.valve",
    ask: "Is it a heat pump, and will it change over between heating and cooling?",
    why: "A reversing valve stuck part-way sends discharge gas straight back into the suction line. The compressor runs, the current looks reasonable, and the two pressures sit on top of each other.",
    answers: [
      { label: "It won't change over, or it sticks", next: "out:reversing-valve" },
      { label: "Changes over fine, or it's cooling only", next: "out:not-pumping" },
    ],
  },

  /* ---------------- ducted zoning ----------------
     Deliberately ducted-only: "some rooms fine, others not" on a multi is
     the multi tree's job, where it means a branch or a crossed head. Here
     it means the air is being shared out wrongly, which is a different
     conversation entirely.

     Whether the bad room is always the SAME room is what splits it — a
     constant offender has something wrong with it, a problem that moves
     with whichever zones are running is system-level. */
  {
    id: "zone.which",
    ask: "Is it always the same rooms, or does it move around?",
    why: "Ask the customer rather than guessing — they know. A room that's always the worst has something wrong with that room. A problem that follows whichever zones happen to be running is about how much of the duct is open.",
    answers: [
      { label: "Always the same room or rooms", next: "zone.air" },
      { label: "It moves — depends which zones are on", next: "zone.count" },
      {
        label: "Everything's weak, all the time",
        hint: "No room is really getting there",
        next: "out:zone-not-zoning",
      },
    ],
  },
  {
    id: "zone.air",
    ask: "With that zone calling, what's coming out of its outlets?",
    why: "Hand at the diffuser, and compare it against a room that works. You're separating three different jobs: air that never arrives, air that arrives short, and air that arrives fine and still doesn't do anything.",
    answers: [
      { label: "Nothing, or barely a trickle", next: "zone.damper" },
      { label: "Some air, but clearly less than the good rooms", next: "zone.balance" },
      {
        label: "Plenty of air, the room still won't get there",
        next: "zone.return",
      },
    ],
  },
  {
    id: "zone.damper",
    ask: "Does that zone's damper actually move when you call the zone?",
    why: "Before you get into the ceiling, confirm the zone is enabled at the controller and isn't switched off or held by a schedule. Then have someone toggle it while you listen or feel at the damper — a motorised damper is audible.",
    answers: [
      { label: "No, it never moves", next: "out:zone-damper" },
      { label: "Yes, it opens", next: "out:zone-duct" },
    ],
  },
  {
    id: "zone.balance",
    ask: "Is that room the far end of the system, or on a long or bent run?",
    why: "Pull the ceiling access and look at the run itself. Long flex, extra bends, a length squashed over a truss or left draped in a sag all cost air — and the far room pays first on a system that was never balanced.",
    answers: [
      { label: "Yes, it's the far end or a long, bent run", next: "out:zone-balance" },
      { label: "No, it's a short straight run", next: "out:zone-outlet" },
    ],
  },
  {
    id: "zone.return",
    ask: "With the door shut, can the air get back out of the room?",
    why: "A room needs a return path or it pressurises and simply stops accepting supply air. Look for a relief grille, a transfer duct, or a genuine undercut on the door — then shut the door and see whether the airflow at the diffuser falls away.",
    answers: [
      { label: "No obvious way back out", next: "out:zone-return" },
      { label: "There's a relief grille or transfer duct", next: "out:zone-load" },
    ],
  },
  {
    id: "zone.count",
    ask: "Is it worse when only one or two zones are open?",
    why: "A ducted system needs a minimum amount of duct open to work at all. Shut too much down and static pressure climbs, the bypass dumps supply air straight back to the return, and even the open zones stop getting a useful share.",
    answers: [
      { label: "Yes, worse with only a few zones open", next: "out:zone-minimum" },
      { label: "No, it's worse with everything open", next: "out:zone-capacity" },
    ],
  },

  /* ---------------- condensation on surfaces ----------------
     Distinct from "Water leaking": nothing has overflowed and nothing is
     blocked. A surface has simply dropped below the dew point of the air
     touching it. WHERE it forms is the whole diagnosis — a sweating grille
     face, a damp ring in the ceiling around it, and wet duct in the roof
     are three different faults that look identical from the floor. */
  {
    id: "cond.where",
    ask: "Where is the moisture actually forming?",
    why: "Get up close and look, because from the floor these all read as 'water near the vent'. You're after the coldest surface — that's where condensation starts, and it tells you which fault you've got.",
    answers: [
      { label: "On the face of a grille or the indoor unit", next: "cond.spread" },
      {
        label: "On the ceiling around a diffuser",
        hint: "A damp ring or a stain spreading outwards",
        next: "out:cond-leak",
      },
      { label: "On duct or pipework in the roof space", next: "out:cond-insulation" },
      {
        label: "On windows and walls generally",
        hint: "Not only near the system",
        next: "out:cond-building",
      },
    ],
  },
  {
    id: "cond.spread",
    ask: "Is it just one or two grilles, or every one of them?",
    why: "If every grille in the place is wet, the grilles aren't the problem — they're just the coldest thing in a room that's too humid. One wet grille among dry ones is a fault at that grille.",
    answers: [
      { label: "Just one or two", next: "cond.flow" },
      { label: "All of them", next: "out:cond-humidity" },
    ],
  },
  {
    id: "cond.flow",
    ask: "Is the airflow at that grille weaker than the others?",
    why: "Less air over the same coil comes out colder, and a colder grille face finds the dew point sooner. Compare by hand against a grille that stays dry.",
    answers: [
      { label: "Yes, noticeably weaker", next: "out:cond-airflow" },
      { label: "No, airflow looks the same", next: "cond.metal" },
    ],
  },
  {
    id: "cond.metal",
    ask: "What's the grille made of?",
    why: "Look at the face and the back of it. Aluminium conducts heat about a thousand times better than plastic, so a bare aluminium grille sitting in the supply airstream settles within a degree or two of the air passing through it — which makes it comfortably the coldest surface in the room. A plastic face, or an insulated pad bonded to the back, behaves completely differently.",
    answers: [
      { label: "Bare aluminium", hint: "Painted or anodised still counts", next: "out:cond-aluminium" },
      { label: "Plastic face, or insulated on the back", next: "out:cond-grille-place" },
    ],
  },

  /* ---------------- compressor suspect ----------------
     A proving workflow, not a symptom: everything points at the compressor,
     now make the meter say so before anyone pays for one. Written for the
     apprentice who has never done it — every step says what to set, where
     the leads land, and what the number should be. The answers ARE the
     meter readings, which is exactly what this tree shape is for. */
  {
    id: "comp.iso",
    ask: "Locked off, leads off, and capacitors dealt with?",
    why: "Isolate at the local isolator AND the switchboard, and lock or tag what you switched. Photograph the terminal lid and the wiring before a single lead comes off — the lid diagram is your map back. Then pull the leads off the compressor terminals, because testing through the board or the drive tests the wrong thing and can wreck it. Then the stored charge. Single-phase: leave the run capacitor a minute — most have a bleed resistor built across them and drain on their own — then prove it with the meter on DC volts across its two terminals. Inverter: the drive stores power in big capacitors (the DC bus), so wait the time printed on the panel and prove those dead the same way. Proving beats assuming, and the meter is already in your hand.",
    safety:
      "Damaged or corroded terminals on a pressurised system can blow out of the shell. Keep the terminal cover on until power is dealt with, glasses on, and stand to the side of the terminal box — never square in front of it.",
    answers: [
      { label: "All done — meter in hand", next: "comp.type" },
      { label: "Not yet — walk me through it", next: "out:comp-setup" },
      {
        label: "It's already out — reading the oil",
        hint: "Work out what killed it before the new one goes in",
        next: "comp.oil",
      },
    ],
  },
  {
    id: "comp.type",
    ask: "Single-phase or three-phase compressor?",
    why: "The data plate says — 230 V single-phase or 400 V three-phase. So does the terminal block: single-phase has C, R and S on the lid diagram (common, run, start); three-phase has three identical terminals marked U, V, W or T1, T2, T3. Lid diagram missing? The resistance readings on the next step will identify the terminals for you.",
    answers: [
      { label: "Single-phase", hint: "C, R and S terminals", next: "comp.1ph" },
      { label: "Three-phase", hint: "U, V, W — or T1, T2, T3", next: "comp.3ph" },
    ],
  },
  {
    id: "comp.1ph",
    ask: "Meter on Ω — what do the three pairs read?",
    why: "Set the meter to ohms (Ω, auto-range is fine) and touch the leads together first — whatever it shows, usually 0.2 to 0.5, is the leads themselves; subtract it or press REL to zero it out. Then measure all three pairs. Expect the run winding C–R lowest (roughly 0.5–4 Ω), the start winding C–S higher (roughly 2–15 Ω), and R–S to equal the two added together — that sum is the real health check. No lid diagram? The pair with the highest reading is R–S, so the terminal NOT in that pair is C; from C, the higher reading is Start, the lower is Run.",
    answers: [
      { label: "All three read, and C–R plus C–S equals R–S", next: "comp.earth" },
      {
        label: "C to anything reads OL, but R–S still reads",
        hint: "That's the internal overload, not a dead motor",
        next: "out:comp-overload",
      },
      { label: "A pair reads OL even stone cold", next: "out:comp-open" },
      { label: "Far below normal — nearly a dead short", next: "out:comp-short" },
    ],
  },
  {
    id: "comp.3ph",
    ask: "Meter on Ω — what do U–V, V–W and W–U read?",
    why: "Zero the leads first — big three-phase windings read well under an ohm, so lead resistance lies. All three pairs should be low and near identical: 0.3–3 Ω is typical, and the balance matters far more than the number. More than about ten percent between the highest and lowest pair is a winding in trouble.",
    answers: [
      { label: "All three low and near identical", next: "comp.earth" },
      {
        label: "One pair reads OL",
        hint: "Cool it and retest before condemning — some carry an internal overload too",
        next: "out:comp-open",
      },
      { label: "One pair reads clearly different from the others", next: "out:comp-unbalanced" },
    ],
  },
  {
    id: "comp.earth",
    ask: "Insulation test to earth — what do the windings read?",
    why: "This one needs an insulation tester — a megger. It pushes a known high voltage through the insulation between the windings and the steel shell, measures how much current leaks across, and reports that as resistance in megohms. That is why a multimeter can't do it: yours pushes a few volts off a battery, so weak insulation reads perfect right up until 400 V of running voltage finds the hole. On the meter it's the setting marked MΩ with a test voltage beside it — set 500 V. Standalone testers start a couple of hundred dollars at any refrigeration or electrical wholesaler and plenty of mid-range multimeters have it built in. Leads still disconnected at the compressor — never test through a drive or a board, it destroys them. Clip one lead to clean bare metal on the compressor body or pipework (scrape the paint back), touch the other to each terminal in turn, and hold the test button until the number stops moving.",
    safety:
      "Never insulation-test a system that's under vacuum — the windings can arc through the thin gas and finish off a motor that was still alive. Test before evacuation or after charging, never during.",
    answers: [
      { label: "Hundreds of MΩ, or OL, on every terminal", next: "out:comp-sound" },
      { label: "Low megohms — roughly 1 to 20", next: "out:comp-damp" },
      { label: "Under 1 MΩ, or the tester howls", next: "out:comp-earthed" },
    ],
  },
  {
    id: "comp.oil",
    ask: "What does the oil look and smell like?",
    why: "Getting a sample: on one you've already pulled, tip oil out of the suction stub into the vial — cleanest sample you'll get. Still fitted, take it from the drain plug or the oil trap. An acid test kit is a small vial of indicator fluid from any refrigeration wholesaler, twenty or thirty dollars, single use: add oil to the marked line, cap it, shake it, then compare against the chart on the pack. Colours differ between brands, so read THAT kit's chart rather than the last one you used. And look at the oil itself while you're there — colour, smell and whatever is floating in it tell you more than the acid result on its own.",
    safety:
      "Used refrigeration oil from a failed compressor can be acidic. Gloves and glasses, and keep it off your skin — a burnout will find every cut on your hands.",
    answers: [
      { label: "Clear to light straw, no smell", next: "out:oil-clean" },
      { label: "Dark, with a sharp acrid smell", next: "out:oil-burnout" },
      {
        label: "Metal in it — glitter, grit or shavings",
        hint: "Even if the acid test comes back clear",
        next: "out:oil-metal",
      },
      { label: "Cloudy or milky", next: "out:oil-moisture" },
    ],
  },
];

/* ───────────────────────────── outcomes ───────────────────────────── */

const PRESSURES = { label: "Open Running Pressures", href: "/dashboard/toolbox/running-pressures" };
const HEATLOAD = { label: "Open Heat Load", href: "/dashboard/toolbox/heat-load" };

/* Every outcome that sends a hand to a board. The fuses on an inverter's
   outdoor board sit beside the capacitors that bite, so checking a fuse is
   board work too. */
const DC_BUS =
  "On inverter equipment the big storage capacitors — the DC bus — hold hundreds of volts after the isolator is off. Wait the time printed on the panel, then prove them dead with a meter on DC volts before touching any board.";

export const OUTCOMES: Outcome[] = [
  /* shared */
  {
    id: "no-power",
    title: "No power reaching the unit",
    confidence: "likely",
    explain:
      "Nothing is responding at all, and the supply checks haven't found an obvious switch off. That points at the supply itself — or at what it passes through on the way in, because on many splits the indoor unit is fed through the outdoor one.",
    actions: [
      "Confirm the outdoor isolator and the unit's breaker at the switchboard",
      "Check for volts into and out of the outdoor isolator, and its fuse where one is fitted — a burnt isolator, or one that's let water in, can sit in the on position and pass nothing",
      "Volts through the isolator: open the unit's terminal block for a loose or burnt terminal, then check the fuses on the outdoor board — where the indoor is fed through the outdoor, a break there leaves both dead",
      "Replace a blown fuse only once you've found what blew it",
      "If the breaker trips again when reset, stop and treat it as an electrical fault",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the isolator, or repair the circuit feeding it",
        when: "Volts reach the isolator and don't leave it, or never reach it at all. That's the building's wiring, and it's licensed electrical work.",
        escalate: true,
      },
    ],
    safety: DC_BUS,
  },
  {
    id: "odu-no-power",
    title: "Indoor unit is alive, outdoor unit isn't",
    confidence: "likely",
    explain:
      "The indoor side has power and is calling, but the outdoor unit isn't answering. That's either its own supply, the interconnecting cable, or the outdoor board.",
    actions: [
      "Give it a few minutes after any start or power-up — most outdoor units sit out a restart delay before they'll run",
      "Check the outdoor isolator is on and its fuse (if fitted) is intact",
      "Check the outdoor unit's breaker at the switchboard",
      "Open both terminal blocks for a loose or burnt terminal on the interconnect, and check the cable for damage — UV, rodents, mower strike",
      "Check the fuses on the outdoor board — a cheap part, but find what blew one before fitting another",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the outdoor board",
        when: "Supply at its terminals, fuses and connections good, and it still won't answer the indoor unit — the board is what's left.",
        escalate: true,
      },
    ],
    safety: DC_BUS,
  },
  {
    id: "restore-power",
    title: "Supply was switched off or tripped",
    confidence: "likely",
    explain: "Something was off or tripped. Restore it and see whether it holds.",
    actions: [
      "Switch it back on and run the system",
      "Give it a few minutes before judging it — most outdoor units sit out a restart delay after any power interruption",
      "Ask what happened before it went off: a storm, work in the roof, a new appliance on the circuit. Something switched it, and 'it just tripped' is rarely the whole story",
      "Check the controller's clock and its schedule survived — a long outage resets both on plenty of units, and that turns up a week later as 'it runs at the wrong times'",
      "If it trips again immediately, stop — don't keep resetting it",
      "A breaker that re-trips is a real electrical fault; use the 'Trips the breaker' path",
    ],
  },
  {
    id: "airflow-starved",
    title: "Airflow starvation",
    confidence: "likely",
    explain:
      "The coil can't move enough air across it, so capacity drops and the coil runs colder and colder — which is also how coils ice up. Cheapest and most common fault there is.",
    actions: [
      "Clean or replace the return-air filters",
      "Clean the indoor coil face — check between the fins, not just the surface",
      "Clean the fan wheel — the barrel behind a wall unit's louvres, or a ducted unit's blower. Dust and mould packed on its blades starve the coil with spotless filters",
      "Clear the return grille: furniture, curtains, stored boxes",
      "Ducted: check for crushed, kinked or disconnected flexible duct, and open more zones — too many shut starves the coil the same way",
      "Set the fan to a normal speed and retest after any ice has melted",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Replace the indoor fan's capacitor",
        when: "The fan runs slow on its highest setting, on a fixed-speed motor. Test the capacitor before the motor — it's the cheap part. A DC fan motor has none (most inverter heads run one), so there it's the motor or the board driving it.",
      },
      {
        fix: "Replace the indoor fan motor",
        when: "The capacitor tests good, or it's a DC motor, and the fan still runs slow on its highest setting.",
      },
    ],
  },
  {
    id: "icing",
    title: "Coil is icing up",
    confidence: "likely",
    explain:
      "Ice on the coil or suction line means the evaporator is running below freezing — either it isn't getting enough air across it, or it's short of refrigerant. Airflow is the more common of the two and free to check.",
    actions: [
      "Turn it to fan only and let the ice melt fully — never chip it off. On a heat pump a few minutes in heat mode clears it far quicker; watch the tray, because the meltwater comes all at once",
      "Check filters, coil, the fan wheel and fan speed first — and on a ducted system, how many zones are shut",
      "Cold outside, or a comfort unit left cooling through a cold night? That ices a healthy system — the 'Ice on pipes or coil' path covers it",
      "Service valves fully open — a liquid valve left part-shut after a pump-down starves the coil exactly like a short charge",
      "If airflow is good, measure superheat once it's thawed — high superheat with low suction points at charge",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "Airflow good, valves open, and superheat high with low suction. Never just top it up.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "condenser-blocked",
    title: "Condenser can't reject its heat",
    confidence: "likely",
    explain:
      "The outdoor coil is how the heat actually leaves the building. Blocked fins, a failing fan or no clearance and head pressure climbs — capacity falls away and the unit may cut out on protection.",
    actions: [
      "Look at it with a torch from behind first — the dust is on the face the air enters, so a coil that looks clean from the front can be packed solid on the inside",
      "Wash it from the inside out wherever you can get behind it. Hosing it from the front drives the dirt further in",
      "Straighten flattened fins with a comb — a bent panel chokes it as surely as dirt does",
      "Confirm the fan runs at full speed and turns the right way",
      "Restore clearance: fences, plants, stored gear, anything within a few hundred mm",
      "Check discharge air isn't recirculating back into the intake",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Chemical clean it",
        when: "Years of dust and grease that a hose won't shift — coil cleaner, and on a wall-hung unit that often means taking it off its bracket to get behind the coil.",
      },
      {
        fix: "Replace the fan's capacitor",
        when: "The fan runs slow, or needs a flick to start, on a fixed-speed unit. The cheap part before the motor. A DC fan has none, so there it's the motor or the board driving it.",
      },
      {
        fix: "Replace the fan motor",
        when: "The capacitor tests good, or it's a DC motor, and the fan still runs slow, stalls or stops once it's hot.",
      },
    ],
  },
  {
    id: "go-pressures",
    title: "Time to read the gauges",
    confidence: "info",
    explain:
      "Mode, airflow and the condenser are all ruled out, so the remaining candidates are charge, the metering device or the compressor — and pressures are what separate them. Everything checkable by eye is behind you.",
    actions: [
      "Before a hose goes on, take what a clamp thermometer will tell you: the return-to-supply split, and the suction line at the outdoor unit. Every connection costs a little gas, and the temperatures alone rule plenty in and out",
      "Check the charge label and the pipe run while you're there — a long run that never had its extra charge weighed in reads short for the rest of its life",
      "Let it stabilise 10–15 minutes at a fixed demand before reading",
      "Take suction and discharge, plus line temperatures for superheat and subcooling",
      "Inverter systems: note compressor speed alongside every reading — pressures at an unknown speed prove nothing, and the unit reports its speed in check mode",
      "Compare against the expected pressures for this refrigerant and ambient",
      "No gauges today? Note the ambient and indoor conditions now for comparison, leave the airflow clear, and book a return with gauges and a scale",
      "Don't add refrigerant speculatively — weigh it in against the nameplate",
    ],
    tool: PRESSURES,
  },
  {
    id: "load-excess",
    title: "The system is fighting extra heat",
    confidence: "likely",
    explain:
      "It's cooling correctly — the air coming out is cold — but the room is gaining heat as fast as the unit removes it. The machine isn't at fault.",
    customer:
      "The unit itself is fine — we've measured what's coming out of it, and it's making cold air the way it should. What's beating it is the heat coming into the room: the sun on that glass, the door standing open, the gear running in here. Shut the room up and shade the window and it will hold the temperature; leave it open and no air conditioner this size would ever catch up.",
    actions: [
      "Measure the return-to-supply split before you blame the room — around 8–12 K on a stabilised system says the machine is doing its job, and it ends the argument on the spot",
      "Close doors and windows, and shade west-facing glass",
      "Remove or relocate the added heat source where you can",
      "A ceiling fan makes a room feel two or three degrees cooler for the price of a fan — worth saying before anyone quotes a bigger unit",
      "Let it run 20–30 minutes with the space closed and re-measure",
      "If the load is permanent, check the unit is still the right size for the room",
    ],
    tool: HEATLOAD,
  },
  {
    id: "undersized",
    title: "Undersized, or the air isn't reaching the room",
    confidence: "possible",
    explain:
      "The unit makes cold air but can't pull the space down. Either it's too small for the room, or the cold air isn't getting where it's needed.",
    actions: [
      "Aim the louvres properly — cold air dumps at the outlet if pointed wrong",
      "Ducted: check zone dampers, balance and any closed-off outlets",
      "Look for leaking or disconnected duct in the roof space",
      "Then check the room's load against the unit's capacity",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Cut the load",
        when: "It nearly keeps up: shade the west glass, close off rooms it was never meant to cool, and start it earlier in the day. Cheaper than any new unit.",
      },
      {
        fix: "Add a unit for the room that loses",
        when: "One room or area drags the rest down. A split of its own there usually costs less than replacing the whole system.",
      },
      {
        fix: "Replace it with a unit sized to the load",
        when: "The load really is past what it can make. That's a quote, not a repair.",
      },
    ],
    tool: HEATLOAD,
  },

  {
    id: "settings-cool",
    title: "Mode or setpoint isn't calling for cooling",
    confidence: "likely",
    explain:
      "Auto mode can sit in heating, fan-only and dry modes won't pull a room down, and schedules or eco limits can cap the setpoint. Worth being certain before walking outside to the condenser.",
    actions: [
      "Set the controller explicitly to COOL, not AUTO or DRY",
      "Watch the unit answer — a beep, a lamp, the louvre moving. A handheld remote sends the whole state at once, so with weak batteries or a bad angle it sits on COOL while the head stays in fan",
      "Put the setpoint several degrees below room temperature",
      "Clear any timer, schedule, sleep, eco or away limit",
      "Check nothing else is commanding it: a second remote, the phone app, a wall controller in another room, or a building system",
      "Check for a lock — plenty of controllers can be held to one mode, or to a range of setpoints, and the button just beeps at you",
      "Check the fan isn't stuck on its lowest speed",
      "Give it 15 minutes running before judging it",
    ],
  },

  /* heating */
  {
    id: "settings",
    title: "Mode or setpoint isn't calling for heat",
    confidence: "likely",
    explain:
      "Auto mode can sit in cooling, and schedules or eco limits can cap the setpoint. Worth being certain before chasing anything mechanical.",
    actions: [
      "Set the controller explicitly to HEAT, not AUTO",
      "Watch the unit answer — a beep, a lamp, the louvre moving. A handheld remote sends the whole state at once, so with weak batteries or a bad angle it sits on HEAT while the head stays in fan",
      "Give it a few minutes before judging it: most heads hold their fan off until the coil is warm, so the start of a heat call is silent by design and gets reported as nothing happening",
      "Put the setpoint several degrees above room temperature",
      "Clear any timer, schedule, sleep, eco or away limit",
      "Check nothing else is commanding it: a second remote, the phone app, a wall controller in another room, or a building system",
      "Point the louvres down — heat stratifies at the ceiling",
    ],
  },
  {
    id: "defrost-normal",
    title: "That's a normal defrost cycle",
    confidence: "info",
    explain:
      "In cold weather the outdoor coil frosts up, and the system briefly reverses to melt it. The indoor fan stops so it doesn't blow cold air, and the outdoor unit steams. It's the system working, not failing.",
    customer:
      "In cold weather ice builds up on the outside unit, so every so often the system runs backwards for a few minutes to melt it off. That's the steam you can see out there, and it's why the indoor fan goes quiet — it's holding off rather than blowing cold air at you. Normal heating comes back within about ten minutes.",
    actions: [
      "Explain the cycle to the customer — it's the single most common 'fault' call in winter",
      "Normal heating resumes within about ten minutes",
      "Count them before you judge it: one every half hour to an hour in cold, damp weather is the system working. One every ten minutes is not",
      "If it defrosts constantly or never clears the ice, that is a real fault",
    ],
  },
  {
    id: "defrost-fault",
    title: "Outdoor coil is iced and defrost isn't clearing it",
    confidence: "likely",
    explain:
      "Frost is expected in heating; solid ice that never clears is not. Either defrost isn't initiating or completing, or the system is short of charge and running colder than it should.",
    actions: [
      "Melt the ice completely before testing — never chip it off",
      "Check the outdoor coil sensor is clipped tight to its pipe and insulated. One that's slipped off reads the air instead of the coil, so the unit never sees the ice it's meant to clear",
      "Meter that sensor against its resistance chart at the coil's actual temperature — a drifted one is a cheap part, and no refrigerant work",
      "Force a defrost from the board or check mode and watch it: the reversing valve should shift with a whoosh and the outdoor fan stop. No whoosh? Check the valve's coil gets its volts — a clip-on part — before the valve",
      "Check its defrost field setting — some units carry a heavier defrost for cold, wet climates that was never switched on",
      "Check the outdoor coil and fan are clear once thawed",
      "Confirm the drain base isn't frozen solid, holding meltwater against the coil",
      "Sensor good and it still ices: read pressures — it's charge or the defrost control from here, and gauges decide which",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Lift the unit higher, or fit a base heater where the unit takes one",
        when: "Meltwater refreezing in the base is what holds the ice. It needs somewhere to drain before it freezes again.",
      },
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "Low suction in heating with a good sensor: a short system runs its coil colder than a defrost can clear.",
        escalate: true,
      },
      {
        fix: "Replace the reversing valve",
        when: "Volts reach a good coil and it still won't shift into defrost. Recovery, brazing and a recharge.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "heat-capacity",
    title: "Heating, but short on capacity",
    confidence: "possible",
    explain:
      "It's producing warm air and the basics are right, so the system is working — just not keeping up. Heat pumps lose output as the outdoor temperature drops, and that's often the whole story.",
    customer:
      "A heat pump doesn't make heat, it moves it in from outside — so the colder it gets out there, the less there is to move, and the less it can deliver. It hasn't broken; it's at the edge of what it can do on a morning like this. Running it steadily instead of in bursts is what gets a house like this up, and keeps it there.",
    actions: [
      "Check the outdoor temperature against the unit's rated heating capacity",
      "Count the defrosts: in cold, damp weather they can eat a third of the running hour, and that is output the room never sees",
      "Find where the heat is going before deciding it's undersized — an extraction fan left running, an open fireplace, a gappy ceiling hatch",
      "Tell them to run it steadily rather than in bursts: a heat pump recovering a cold house takes hours, and a setback that deep costs more than it saves",
      "Confirm the room isn't losing heat faster than the unit adds it",
      "Point louvres down and run the fan higher to break up stratification",
      "Compare the room's heat load against the installed capacity",
    ],
    tool: HEATLOAD,
  },
  {
    id: "heat-none",
    title: "No heat being produced",
    confidence: "likely",
    explain:
      "It's in heat mode, the outdoor unit is running with a clear coil, and it's still blowing cold. Airflow isn't a candidate here — starved airflow makes weak warm air, never cold air. That points at the reversing valve not shifting — the valve itself, or the valve's coil and the volts that move it — or the system being short of refrigerant.",
    actions: [
      "Feel the discharge line — it should be hot within a few minutes",
      "Measure the volts at the reversing valve's coil in heat, then in cool: they should change when the mode does. If they don't, it's the board or its wiring, not the valve",
      "Volts changing and the valve won't move? Meter the coil itself, unplugged — an open coil is a clip-on part, no refrigerant work",
      "Coil good: change modes a few times with it running, tapping the valve body gently as each change is called — a sticky valve will often shift with pressure behind it",
      "It shifts and still won't heat: read pressures — heating should show a low suction and a high condensing temperature, and a short charge shows here",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the reversing valve",
        when: "Volts arrive, the coil is good, and it still won't shift, or its four pipes all sit at much the same temperature because it's bypassing inside. Recovery, brazing and a recharge.",
        escalate: true,
      },
      {
        fix: "Repair the board output that drives the coil",
        when: "No volts at the coil in the mode that needs them, with the wiring good. That's board work: on an inverter, prove its big capacitors dead before touching it.",
        escalate: true,
      },
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "The valve shifts and the pressures read short. Never just top it up.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },

  /* power */
  {
    id: "remote-fault",
    title: "The unit is fine — the remote or receiver isn't",
    confidence: "likely",
    explain:
      "It starts from the manual button, so the unit, its power and its controls are healthy. The problem is the command not arriving.",
    actions: [
      "Fresh batteries in the remote, correct way round",
      "Point it straight at the receiver from close up",
      "Check the receiver window isn't blocked or sun-washed",
      "Check the remote hasn't been switched to a different address — heads sharing a room can be set apart, and a remote on the other address is ignored",
      "Try a known-good or universal remote to confirm before ordering parts",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the remote",
        when: "A known-good remote works the unit. Order the matching one rather than leaving the customer on a universal.",
      },
      {
        fix: "Replace the receiver board",
        when: "A known-good remote does nothing either. On most heads the receiver is a small board of its own, far cheaper than the main one.",
      },
    ],
  },
  {
    id: "timer-holding",
    title: "A timer or schedule is holding it off",
    confidence: "likely",
    explain: "The unit is being told not to run. Nothing is broken.",
    actions: [
      "Check the controller's clock and day first — after a power cut it can be hours or a whole day out, and the schedule then runs at the wrong time. That is what 'it turns itself off' usually is",
      "Clear the timer or weekly schedule on the controller",
      "Turn off eco, away or holiday mode",
      "Check any smart-home or BMS integration isn't overriding it",
      "Goes off in the afternoon and comes back later? Look for a demand-response device on the supply — the network can be capping or dropping it during a peak, exactly as it was installed to",
      "Show the customer where the setting lives so it doesn't recur",
    ],
  },
  {
    id: "float-tripped",
    title: "Condensate float switch has cut it out",
    confidence: "likely",
    explain:
      "The float has tripped to stop an overflow, which locks the unit out until the water clears. It's a symptom — the real fault is the drain.",
    actions: [
      "Clear the drain line and flush it through",
      "Dry the safe tray and check the float moves freely",
      "Dry tray and it's still locked out? Meter the float and its plug — a broken wire or a connector half out holds the unit off with nothing in the tray",
      "Treat the tray to slow the biofilm coming back",
      "Confirm the drain has continuous fall and a correct trap",
      "Some units hold the lockout until the power is cycled, so restore it properly before deciding the float is still open",
    ],
  },
  {
    id: "control-board",
    title: "Control board or transformer",
    confidence: "possible",
    explain:
      "Power is present, the drain safety is clear, and it still won't respond to anything. That points inside the electronics.",
    actions: [
      "Confirm supply voltage right at the indoor terminals",
      "Check the transformer output and any onboard fuse",
      "Reseat every plug on the board — a corroded or half-seated connector looks exactly like a dead board",
      "Look for obvious damage — burnt tracks, swollen capacitors, water ingress, insects",
      "Ants or moisture but nothing burnt? Clean it out with a dry brush and contact cleaner, let it dry and try again before ordering anything",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the board",
        when: "Supply and transformer output are good at its terminals, the fuse is intact, every plug is seated and nothing is living in it. Model-specific, and often a lead time.",
        escalate: true,
      },
    ],
    safety: DC_BUS,
  },

  /* water */
  {
    id: "drain-blocked",
    title: "Blocked condensate drain",
    confidence: "likely",
    explain:
      "It drained fine for years and now it doesn't, so something has closed a path that used to be open. The unit is still producing water, the tray fills, and it spills. Almost always slime and dust at the tray outlet or in the line.",
    actions: [
      "Start where it almost always is: pull the union apart at the head and clear the tray outlet and the first bend. A minute with a bottle brush beats an hour on the line",
      "Clear the rest by pulling from the discharge end — a wet vacuum outside. Pushing from the tray side finds the weakest joint in the ceiling instead, and that's where the next leak is",
      "Flush it through and confirm a steady flow outside",
      "Clean the tray and treat it",
      "Check the run has continuous fall, no sags, and a correct trap",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Fit a capped access tee at the head",
        when: "This drain is a repeat customer. A cleaning point turns the next visit into a two-minute job.",
      },
      {
        fix: "Fit a float switch in the tray or the line",
        when: "The ceiling has already paid for one overflow. The switch stops the unit before the next one, for the price of a part.",
      },
    ],
  },
  {
    id: "pump-fault",
    title: "Condensate pump isn't lifting the water",
    confidence: "likely",
    explain:
      "The unit makes water, there's a pump, and nothing is coming out the other end. Either the pump has failed or its float isn't telling it to run.",
    actions: [
      "Lift the float by hand — the pump should run",
      "No sound at all? Prove it has power with the float up. Most are fed off the indoor board, so a blown fuse or a plug half out stops it silently",
      "Clean the pump reservoir and float; they silt up",
      "Check the discharge line isn't blocked or kinked, and the non-return valve isn't stuck or fitted the wrong way round",
      "Running but not lifting: measure the height it's being asked to lift against what the pump is rated for",
      "Confirm the pump's safety switch stops the unit on failure, so it can't flood next time",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the pump",
        when: "It has power and won't run with the float lifted, even clean.",
      },
      {
        fix: "Re-run the drain to gravity and take the pump out",
        when: "There's fall to be had after all. The pump is the one part of a drain that fails; without it there's nothing left to fail.",
      },
    ],
  },
  {
    id: "tray-or-fall",
    title: "Tray, fall or trap problem",
    confidence: "possible",
    explain:
      "The drain flows and there's no ice, so the water is escaping the tray before it reaches the outlet — a crack, a bad fall, or an air-locking trap.",
    actions: [
      "Spitting or spraying rather than dripping? Two causes, and neither of them is the tray. A barrel fan caked in dust and mould throws water off its blades and out through the louvres. And a coil that ices — short of gas, or starved of air — throws the melt out in bursts as it lets go, which is why that spitting comes and goes",
      "So look for frost with it running, not after: any on the coil or the suction line and the ice is the fault, not the drain. Work it on the 'Ice on pipes or coil' path — and with the airflow good, short of gas is where that lands",
      "Sight along the drain run for sags or uphill sections",
      "Check the trap: gurgling heads usually mean it's air-locking or dry",
      "Inspect the tray for cracks, corrosion or a displaced seal, and the grommet where the drain leaves it",
      "Confirm the indoor unit is level — a tilted head drains to the wrong corner",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "It frosts while it runs with the filters, the fan wheel and the airflow all good. The spitting is melt thrown off that ice, so the gas is the fault and the tray never was.",
        escalate: true,
      },
    ],
  },
  /* Water at the OUTDOOR unit had nowhere to go in this tree: the only other
     answer sent it to the condensation tree, which reads it as sweating
     pipework in the roof. In heating it is the defrost doing its job, and in
     cooling it is usually the indoor unit's own drain, run down beside it. */
  {
    id: "outdoor-water",
    title: "Water at the outdoor unit is usually meant to be there",
    confidence: "info",
    explain:
      "In heating the outdoor coil frosts, and every defrost sends that meltwater out of the base — litres of it on a cold morning, steaming as it goes. In cooling the outdoor unit makes no condensate of its own, but plenty of installs run the indoor unit's drain down to discharge beside it. Neither is a fault.",
    customer:
      "In winter the outdoor unit ices up, and every so often it melts that ice off — the water on the ground is where it goes, and the steam you've seen is the same thing happening. In summer, water out there is usually the drain from the indoor unit, which has to come out somewhere. Neither one is the system leaking.",
    actions: [
      "Work out which mode it was in: meltwater in heating, drain water in cooling",
      "Follow it to its source — out of the base of the unit, or off the end of a drain hose run down beside it",
      "Heating: check the base's drain holes are clear and the unit stands high enough for the water to get away, or it refreezes into the coil",
      "Cooling: if it isn't the drain hose, and the pipework up there is wet, that's sweating insulation — work the 'Sweating surfaces' path",
      "Water pooling against a wall or across a path is a fair complaint even with the unit working: run it away with a hose or a drain kit",
    ],
  },

  /* ice */
  {
    id: "low-ambient",
    title: "Cooling in low ambient without head-pressure control",
    confidence: "likely",
    explain:
      "Below about 15°C outside, condensing pressure falls so far that the evaporator runs below freezing and ices. Standard comfort units aren't built for it — server rooms hit this constantly.",
    actions: [
      "Find out why it's cooling at all: a comfort unit left in cool or dry through a cold night, or auto set too low, only needs its setting changed",
      "Confirm the lowest outdoor temperature the unit is rated to cool at",
      "Check whether its maker offers a low-ambient field setting or a bolt-on wind baffle for that model — where one exists, it's the cheapest fix there is",
      "Meanwhile, avoid cooling in cold weather",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Let the outside air do it",
        when: "A comms room or cupboard that only needs cooling because it's shut in. On a cold day a filtered exhaust fan, or an economiser, cools it for the cost of a fan.",
      },
      {
        fix: "Fit head-pressure control — fan speed control or a damper",
        when: "No setting or kit exists for it, and it has to cool year-round.",
        escalate: true,
      },
      {
        fix: "Quote a unit designed for the duty",
        when: "A critical room. A server room can't be left to a comfort unit's limits.",
      },
    ],
  },
  {
    id: "charge-or-valve",
    title: "Charge or metering device",
    confidence: "possible",
    explain:
      "Airflow is good and conditions are normal, so the coil is running cold because refrigerant flow is wrong — short of gas, or a metering device that isn't feeding properly.",
    actions: [
      "Let the ice melt completely, then read superheat",
      "Service valves fully open — a liquid valve left part-shut after a pump-down starves the coil exactly like a short charge",
      "Look where the frost starts: a filter-drier or strainer that's cold or frosted on its outlet, or a kinked line at a bend or the wall hole, is a restriction you can see — not a charge problem",
      "High superheat with low suction points at undercharge or a restriction",
      "Check the expansion valve bulb is tight, insulated and correctly located",
      "Electronic valve: power-cycle at the isolator to re-home it, check the valve's coil is pushed fully onto the valve body, and check the indoor coil's sensors read right — a misread sensor starves the evaporator on purpose. None of it needs the system opened",
      "Leak-test before adding refrigerant — never just top it up",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "Valves open, no restriction, the valve feeding properly, and superheat still high with low suction.",
        escalate: true,
      },
      {
        fix: "Replace the filter-drier or strainer",
        when: "It's the restriction: a temperature drop across it you can feel, or frost on its outlet.",
        escalate: true,
      },
      {
        fix: "Replace the expansion valve",
        when: "Bulb right, or the coil good after a power cycle, and it still starves the coil.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },

  /* cycling */
  {
    id: "protection-coded",
    title: "Protection is cutting it out",
    confidence: "likely",
    explain:
      "Runs of a minute or two with a code mean a protection device is stopping it — high pressure, low pressure, current or temperature — rather than the room being satisfied.",
    actions: [
      "Record the exact code or blink pattern and photograph it",
      "Codes are brand-specific — read it against this unit's own manual",
      "Clean the condenser and the filters, and check both fans, first — high head causes many of these, and a starved indoor coil trips its freeze protection",
      "Read pressures under load to see which limit it's hitting",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Board-level or refrigerant work, once the code is understood",
        when: "The code's family points there and the cheap physical causes are ruled out: a drive, a power module, a valve or the charge.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
    library: true,
  },
  {
    id: "protection-silent",
    title: "Cutting out without a code",
    confidence: "possible",
    explain:
      "Very short runs with no code still suggest a limit being hit — or a supply problem dropping the unit out.",
    actions: [
      "Clean the filters and check the indoor fan wheel — a starved indoor coil gets cold enough to trip its freeze protection, stops, warms, and starts again, and many units show no code for it",
      "Ducted or cassette: check the drain and the float switch — a tray that's nearly full lifts the float, cuts it out, drains a little and lets it start again",
      "Clean the condenser and confirm the fan runs the whole time — a fan that stops mid-cycle trips it on head pressure",
      "Measure running current against the nameplate",
      "Fixed-speed: test the run capacitor — a weak one leaves the compressor labouring on its overload within seconds of starting. An inverter has none; read its check mode instead",
      "Check supply voltage under load, including at the outdoor terminals",
      "Watch pressures through a full cycle to catch the moment it trips",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "It trips on low pressure, with high superheat and the airflow good. Never just top it up.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "oversized",
    title: "Satisfying too fast — oversized or over-sensitive",
    confidence: "possible",
    explain:
      "The room hits setpoint in a couple of minutes, so the unit shuts down, the temperature drifts, and it starts again. Hard on the compressor and poor at removing humidity.",
    actions: [
      "Check the unit's capacity against the room's actual load",
      "Inverter: it should ramp down and cruise, not stop — one that stop-starts can't turn down far enough for the load, which is the same oversizing story told a different way",
      "Widen the controller deadband if it allows it",
      "Drop the fan a speed: less air over the coil means less sensible capacity, so it runs longer — and pulls more moisture out while it does. Watch the coil doesn't ice",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Give it more of the house",
        when: "Ducted, or a head that can serve the room next door: more load to work against lets it run instead of stopping.",
      },
      {
        fix: "Replace it with a unit sized to the load",
        when: "The settings can't hold it and the cycling is costing comfort or the compressor. It's the real fix, and it's a quote, not a repair.",
      },
    ],
    tool: HEATLOAD,
  },
  {
    id: "sensor-misread",
    title: "The sensor isn't reading the room",
    confidence: "likely",
    explain:
      "It stops while the room is still warm, so whatever it's measuring isn't representative — usually conditioned air washing straight back over the return sensor.",
    actions: [
      "Check no sleep or eco mode is on — both lift the setpoint as they go, and the room is left warm on purpose",
      "Check the return sensor isn't in the supply air stream",
      "Redirect louvres so supply air doesn't short-circuit to the return",
      "Ducted: check supply and return grilles aren't too close together",
      "Meter the room sensor against its resistance chart at the room's temperature — a drifted one is a cheap part",
      "Switch to the wall controller's sensor if the unit supports it — and if it's already the sensor, check it isn't in the supply air's path, in sun, or on a cold outside wall",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Fit a remote sensor where people actually sit",
        when: "Neither the unit's sensor nor the controller can be put anywhere that reads the room. Plenty of units take one as an accessory.",
      },
    ],
  },

  /* noise */
  {
    id: "loose-panels",
    title: "Loose panel or fastening",
    confidence: "likely",
    explain: "If pressing on it changes the noise, it's a panel vibrating rather than anything internal.",
    actions: [
      "Tighten the cover screws on both indoor and outdoor units",
      "Re-seat grille clips and any snap-fit trim",
      "Find where the pipework touches: a copper line resting on the bracket, or hard against the wall where it passes through, turns the whole wall into a speaker. Pack it and the noise goes",
      "Check the outdoor unit sits square on its feet or brackets, and that the fan guard is tight",
      "Add anti-vibration mounts if the frame transmits into the building",
    ],
  },
  {
    id: "fan-debris",
    title: "Something in the fan",
    confidence: "likely",
    explain:
      "A tick or slap that follows fan speed usually means the fan is hitting something, or a blade is fouled or damaged.",
    actions: [
      "Isolate power before putting hands anywhere near a fan",
      "Clear leaves, twigs and debris from the outdoor unit",
      "Check the indoor barrel fan for dirt clumps that unbalance it",
      "Check the blade is tight on its shaft — a backed-off grub screw ticks once per turn, and it eats the motor if it's left",
      "Inspect the blades for damage and the shroud for contact",
    ],
  },
  {
    id: "bearing-motor",
    title: "Fan bearing or motor wearing out",
    confidence: "likely",
    explain:
      "A squeal or grind that scales with fan speed is mechanical wear, and it doesn't recover on its own.",
    actions: [
      "Isolate power, then check for play or roughness in the shaft by hand",
      "Identify which fan — indoor or outdoor — the noise comes from",
      "Clean the wheel before you condemn anything: a barrel fan packed unevenly with dust whirrs and rumbles exactly like a tired bearing, and it costs nothing to rule out",
      "Check the motor's own rubbers and mounts — a perished mount hums through the case and reads as bearing noise",
      "Check for water ingress, so whatever goes in next lasts",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the bearing or the motor",
        when: "The shaft has play or roughness in it by hand, with the wheel clean and the mounts good. It doesn't recover on its own.",
        escalate: true,
      },
    ],
  },
  {
    id: "gurgle-normal",
    title: "Normal refrigerant sounds",
    confidence: "info",
    explain:
      "Gurgling and hissing as it starts, stops or defrosts is refrigerant equalising between the high and low sides. Expected.",
    customer:
      "That gurgle is the refrigerant moving inside the pipes as the system starts and stops — the same sound a kettle makes settling down. It runs around a sealed loop, so hearing it move doesn't mean any of it is escaping. If it ever turns into a constant hiss while it's running, that's worth a call; the odd gurgle isn't.",
    actions: [
      "Reassure the customer — it's the system settling, not a leak",
      "If it becomes constant while running, that's worth investigating",
    ],
  },
  {
    id: "gurgle-charge",
    title: "Constant gurgling — flow or charge",
    confidence: "possible",
    explain:
      "Continuous gurgling while running can mean liquid and vapour moving together where there should be one or the other — often a low charge or a metering device not feeding cleanly.",
    actions: [
      "Started after someone worked on it? Check the service valves are fully open first — a valve left part-shut flashes gas at the restriction and gurgles for the life of the job",
      "Read pressures and superheat under a steady load",
      "Check for a sight-glass flashing, where one is fitted",
      "Leak-test before adjusting charge",
    ],
    tool: PRESSURES,
  },
  {
    id: "mounts",
    title: "Mounts or thermal movement",
    confidence: "possible",
    explain:
      "A thump at start or stop is usually compressor torque through tired mounts. Creaks as it warms or cools are plastics expanding — normally harmless.",
    actions: [
      "Check the compressor mounting grommets aren't perished or over-tightened",
      "Check the outdoor unit is level and firmly fixed",
      "A wall bracket makes the building the sounding board. Isolators between bracket and wall, or a move to the ground on pads, fixes what no amount of tightening will",
      "Add anti-vibration pads if it transmits into the structure",
      "Thermal creaks generally need no action beyond explaining them",
    ],
  },

  /* breaker */
  {
    id: "short-earth",
    title: "Hard short or earth fault",
    confidence: "likely",
    explain:
      "Tripping the instant it energises means a direct fault — compressor windings down to earth, a damaged cable, or water in a connection. This is not a nuisance trip.",
    actions: [
      "Isolate and leave it isolated",
      "Do not keep resetting the breaker",
      "Insulation-test the circuit and the compressor windings — the 'Compressor suspect' tile in this tool walks that test terminal by terminal, meter settings included",
      "Test everything else on mains to earth as well: the crankcase heater, the fan motors, the reversing valve coil and any base heater. Any one of them trips exactly like a dead compressor, and they're all cheaper parts",
      "Leave the expansion valve's coil off that list — on most splits it runs on low voltage from the board, so it can't trip the switchboard. A fault there shows up as a code or a starved coil instead",
      "Licensed electrical fault-finding from here",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Have the breaker's type and rating checked against the unit",
        when: "Every insulation reading comes back good and it still lets go the moment it starts. A breaker on the wrong curve or too small for the inrush trips on a healthy unit — licensed electrical work, and it is the LAST thing to look at, not the first.",
        escalate: true,
      },
    ],
    escalate: true,
  },
  {
    id: "head-pressure-amps",
    title: "High head pressure pulling excess current",
    confidence: "likely",
    explain:
      "Running for a while then tripping is an overcurrent story, and a blocked condenser is the usual reason — the compressor works harder and harder until the breaker lets go. An Australian summer gives it nowhere to hide: at 40 degrees ambient a blocked coil has no margin left at all.",
    actions: [
      "Clean the condenser coil properly and confirm the fan runs",
      "Restore clearance and stop discharge air recirculating",
      "Measure running amps against the nameplate once it's clean",
      "Read head pressure under load to confirm it has come back down",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Replace the fan's capacitor",
        when: "The fan runs slow, or needs a flick to start, on a fixed-speed unit. Test the capacitor before the motor — it's the cheap part. An inverter's fan has none, so there it's the motor or the board driving it.",
      },
      {
        fix: "Replace the fan motor",
        when: "The capacitor tests good and the fan still runs slow, stalls, or stops once it's hot.",
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "compressor-amps",
    title: "Compressor drawing too much current",
    confidence: "possible",
    explain:
      "The condenser is clean, so the high current is coming from the compressor or from what it's being made to pump — worn, tight, a failing start component, or liquid coming back to it past an expansion valve stuck open.",
    actions: [
      "Measure running and locked-rotor current against the nameplate — clamp around ONE conductor only; around the whole cable the fields cancel and it reads zero",
      "Fixed-speed: check the capacitor and any start components, and replace what's weak on the spot. Inverter: it has neither — high current is the drive working against something, so read target versus actual speed in check mode",
      "Confirm supply voltage holds up under load — low volts raises current",
      "Three-phase: measure all three legs. A lost or unbalanced phase drives the current up on the ones that are left",
      "Read suction, head and superheat before the compressor takes the blame. Superheat near zero means liquid is reaching it — an expansion valve stuck open, or an overcharge, loads a healthy compressor exactly like a tight one",
      "Valve with a bulb: check the bulb is clamped to the suction line and insulated — one that's come loose reads warm and drives the valve wide open. Electronic valve: power-cycle at the isolator to re-home it, and check the valve's coil is pushed fully onto the valve body",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Correct the supply",
        when: "The volts sag under load or a phase is missing. The compressor is only the victim, and the fix is licensed electrical work.",
        escalate: true,
      },
      {
        fix: "Replace the expansion valve",
        when: "It still floods with the bulb right, or after a power cycle with a good coil. Recovery, brazing and a recharge.",
        escalate: true,
      },
      {
        fix: "Recover the charge and weigh it back in",
        when: "High head with a clean coil, or low superheat with the valve working: it's overcharged, or there's air in it. Weigh it in to the nameplate — never trim it on pressures.",
        escalate: true,
      },
      {
        fix: "Replace the compressor",
        when: "Current stays high with good volts, good start gear, a clean coil and normal superheat. Prove the motor first — the 'Compressor suspect' tile walks it.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "rcd-moisture",
    title: "Moisture causing RCD trips",
    confidence: "possible",
    explain:
      "Trips that follow the weather point at water finding its way into a connection and leaking current to earth.",
    actions: [
      "Inspect the outdoor terminal box for water ingress and corrosion",
      "Check cable glands, entries and the weatherproofing above them",
      "Dry and reseal, then insulation-test to confirm — and if the box and glands come up dry, test the compressor windings to earth: the 'Compressor suspect' tile walks it step by step",
      "Check the crankcase heater, the reversing valve coil and any base heater — all on mains, all outside in the weather, all common culprits",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the crankcase heater, base heater or valve coil that reads low",
        when: "One of them reads low to earth on the insulation tester. Cheap parts, and each one trips a safety switch exactly like a wet compressor.",
      },
      {
        fix: "Give it a safety switch of its own",
        when: "Every insulation reading is good and the trips follow load rather than water. Inverter units leak a little to earth by design, and several sharing one safety switch can add up past its threshold. Licensed electrical work.",
        escalate: true,
      },
      {
        fix: "Replace the compressor",
        when: "Everything around it is dry and the windings still read low to earth.",
        escalate: true,
      },
    ],
  },

  /* smell */
  {
    id: "electrical-smell",
    title: "Burning smell — isolate it now",
    confidence: "likely",
    explain:
      "An acrid or electrical burning smell means something is overheating. This is the one symptom where you stop before diagnosing.",
    actions: [
      "Isolate the unit at the switchboard now",
      "Do not run it again until it has been inspected",
      "Look for burnt terminals, discoloured insulation or a failed capacitor",
      "Licensed electrical inspection before it goes back on",
    ],
    escalate: true,
  },
  {
    id: "mould",
    title: "Mould in the coil or tray",
    confidence: "likely",
    explain:
      "A musty smell strongest at start-up is growth on the coil, barrel fan or drain tray — damp surfaces plus dust.",
    actions: [
      "Deep-clean the coil, barrel fan and drain tray",
      "Treat the tray and confirm the drain runs freely — a tray that never empties is why it came back",
      "Turn on the unit's own dry or self-clean setting where it has one: it runs the fan on after every cooling cycle, which is the same advice without anyone having to remember it",
      "Advise running fan-only for a while after cooling to dry the coil",
      "Set a realistic cleaning interval with the customer",
    ],
  },
  {
    id: "biofilm",
    title: "Bacterial film on the coil",
    confidence: "likely",
    explain:
      "The 'dirty sock' smell, usually worst when heating starts, is a bacterial film on the coil rather than loose dirt.",
    actions: [
      "Clean and sanitise the coil properly — a rinse won't shift it",
      "Confirm the tray drains fully, so it isn't sitting wet",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Coat the coil, or fit UV treatment",
        when: "It keeps coming back after a proper clean. It slows the film down; it doesn't replace the clean.",
      },
    ],
  },
  {
    id: "trap-pest",
    title: "Drain trap or a pest",
    confidence: "possible",
    explain:
      "A sewer smell usually means a dry or failed trap letting drain air back through. A decay smell usually means something has died in the duct or ceiling.",
    actions: [
      "Check the drain trap holds a water seal and is correctly formed",
      "Pour water through to re-seal a dried trap",
      "Look at where the drain discharges: run into a gully or a waste pipe without an air gap and the line breathes sewer air straight back into the room, however good the trap is",
      "Inspect duct and ceiling space for pests or entry points",
      "Remove and sanitise, then seal the way in",
    ],
  },

  /* code */
  {
    id: "record-first",
    title: "Record the pattern before you clear it",
    confidence: "info",
    explain:
      "The code is the diagnosis, and power-cycling erases it. Capture it properly before touching anything.",
    actions: [
      "Film the lamps on your phone rather than counting on a ladder — a long pattern counts easily on the replay, and the video is the record",
      "Photograph the controller or the indoor unit's LEDs",
      "Note which LEDs, how many flashes, and the pause length",
      "Call up the fault history where the unit keeps one — on a wired controller or in check mode. It names the code, often how many times it has happened, and it survives the power cycle",
      "Write down what it was doing when it tripped: mode, how long it had run, the weather. Half of these codes are protection, and the condition IS the fault",
      "Record the model and serial from the data plate while you're there",
      "Then press Back and carry on with the code in hand",
    ],
  },
  {
    id: "code-persists",
    title: "The fault is still present",
    confidence: "likely",
    explain:
      "It survived a power cycle and returns under load, so it's a live fault rather than a one-off glitch. What it means is specific to this brand and model.",
    actions: [
      "Read the live sensor data in check mode before you order anything: one reading at an impossible number — far below zero, or up near boiling — names an open or shorted sensor, and that's the cheapest part on the machine",
      "Codes are brand-specific — read it against this unit's own manual",
      "Then work the family it belongs to, cheapest first. A sensor code is usually a thermistor out of its clip, a chafed lead or a plug half out. A comms code is a loose terminal, a reversed pair or two units on one address. A protection code is a dirty coil, a stopped fan, or the charge",
      "Open the control box and look: ants, water and a half-seated plug throw codes that no manual will ever name",
      "Don't keep power-cycling it; you'll only lose the evidence. Where something else on the machine needs a cycle — an expansion valve re-homing, a comms line re-addressing — read the history first and you keep both",
      "If the manual doesn't cover it, call the manufacturer's technical line with model, serial and code",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the sensor",
        when: "Its reading is impossible, or it's open or shorted against its chart. A clip and a plug — no refrigerant work, and the cheapest end of a code.",
      },
      {
        fix: "Board-level or refrigerant work, once the code is understood",
        when: "The family points there and the cheap causes are ruled out: a drive, a power module, a valve or the charge.",
        escalate: true,
      },
    ],
    library: true,
  },
  {
    id: "code-transient",
    title: "Cleared — treat it as a warning",
    confidence: "info",
    explain:
      "It hasn't come back, so it was likely a transient — a supply dip, a one-off protection trip, or a sensor glitch. Worth noting rather than forgetting.",
    actions: [
      "Record the code and the date in the job notes",
      "Ask what the weather and the power were doing: a 40-degree afternoon or a supply dip throws a protection code that clears and never comes back",
      "Check the fault history for how many times it has happened — a counter beats anyone's memory of 'once or twice'",
      "Look up what it was warning about — a cleared code still names the circuit",
      "Check the obvious physical causes anyway — filters, condenser, clearance",
      "Tell the customer to note the pattern if it returns",
      "A repeating 'transient' is a real fault building up",
    ],
    library: true,
  },

  /* multi / VRF */
  {
    id: "vrf-creep",
    title: "Refrigerant creeping through a valve that should be shut",
    confidence: "likely",
    explain:
      "A head that quietly warms or cools while it's switched off is being fed refrigerant it shouldn't be getting: its expansion valve isn't closing fully, so a trickle passes whenever the system runs for somebody else. Common on multi systems, and usually reported as a haunted room rather than a fault.",
    actions: [
      "Confirm it's the head — check with the whole system off, then with a neighbouring head running",
      "Rule out sunlight, a nearby duct or a leaking damper before condemning a valve",
      "Power-cycle at the isolator for a full minute. On start-up the board drives every valve hard shut and counts open from there, which re-seats one that's lost its place",
      "Find that head's valve — inside the outdoor unit on a multi with ports, in the head or its branch box on VRF — and check the valve's coil is pushed fully onto the valve body and the head's coil sensor reads right. A coil that's slipped can't drive the valve shut",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the valve's coil",
        when: "The coil reads open or shorted on the meter. It lifts off the valve body, so there's no refrigerant work.",
      },
      {
        fix: "Replace the valve",
        when: "It still creeps after a power cycle, with a good coil and good sensors: debris on the seat, or a worn one — it takes very little to hold a valve open. Recovery, brazing and a recharge.",
        escalate: true,
      },
    ],
  },
  {
    id: "mode-conflict",
    title: "Mode conflict — it can only do one at a time",
    confidence: "likely",
    explain:
      "A two-pipe multi or VRF shares one refrigerant circuit, so the whole system heats or cools together. Whichever head calls first — or a designated master controller — sets the mode, and the rest wait, drop to fan only, or show a standby indication. Nothing is broken.",
    customer:
      "All the indoor units share one outdoor unit and one set of pipes, so the whole system has to be either heating or cooling — it can't do both at the same time. Whichever room asks first sets it, and the others wait or run their fan until it changes. That's how the system was designed rather than something that's failed.",
    actions: [
      "Check which head or controller holds mode priority",
      "Set the disagreeing heads to the same mode, or to fan only",
      "Explain the limitation to the customer — it's how the system was specified, not a fault to chase",
      "If both modes are genuinely needed at once, that's three-pipe heat recovery or a separate system, and it's a quoting conversation",
    ],
  },
  {
    id: "mode-priority",
    title: "Mode priority is holding that head",
    confidence: "likely",
    explain:
      "It changes over happily on its own, so the head and its branch are both fine. A priority setting or a master controller is making it follow the rest of the system instead of running the mode it's asking for.",
    actions: [
      "Find which controller or head is set as master",
      "Check whether it's set to a fixed master or to first-come: switching that one setting is often the whole fix",
      "Check the priority setting on the branch controller and on any central controller",
      "Re-assign priority to match how the building is actually used",
      "Confirm the change by calling opposite modes on two heads again",
    ],
  },
  {
    id: "bc-valve",
    title: "Changeover valve at the branch controller",
    confidence: "possible",
    explain:
      "It won't change over even with the rest of the system off, so the branch controller isn't routing hot gas or liquid to that circuit. That points at the valve set serving this head rather than anything at the head itself.",
    actions: [
      "Identify which branch controller port serves that head",
      "Check the valve coils get their volts when the mode is called, then meter each coil itself, unplugged",
      "Feel the pipes into and out of that port through a changeover",
      "Branch controller work needs the service manual for that system",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the valve's coil",
        when: "Volts arrive and the coil reads open or shorted. It lifts off the valve, so there's no refrigerant work.",
      },
      {
        fix: "Replace the valve",
        when: "Volts arrive, the coil is good, and the valve still won't shift. Recovery, brazing and a recharge.",
        escalate: true,
      },
    ],
  },
  {
    id: "vrf-comms",
    title: "Transmission line or addressing",
    confidence: "likely",
    explain:
      "It has power, but the system isn't talking to it. On multi and VRF the transmission line daisy-chains every indoor unit, so a break, a reversed pair, a duplicated address or a shield earthed at both ends takes out one head — or everything past it.",
    actions: [
      "Check the transmission terminals at that head for a loose or reversed conductor",
      "Confirm its address or dip-switch setting isn't duplicated with another head",
      "Check the terminating resistance is set on ONE board only, the way that system wants it — two of them, or none, and the line reads noisy or dead with every wire perfect",
      "Follow the daisy-chain: if everything downstream is out too, the break is upstream of them all",
      "Confirm the shield is earthed at one end only, and the line isn't run alongside power cable",
      "Power the whole system down for a minute and let it re-address on the way back up — plenty of comms faults are a handshake that never finished",
    ],
  },
  {
    id: "vrf-branch",
    title: "Refrigerant isn't reaching that head",
    confidence: "likely",
    explain:
      "The head runs and asks for it, but its pipes stay at room temperature — so the problem is upstream, in the expansion valve or the branch serving that circuit. The rest of the system being fine is exactly what tells you it's local.",
    actions: [
      "Confirm the service valves for that circuit are fully open — one left shut after the install or a pump-down starves exactly one head",
      "Find that head's expansion valve — inside the outdoor unit on a multi with ports, in the head or its branch box on VRF — and check the valve's coil is pushed fully onto the valve body and plugged into that circuit's socket on the board. Coils get knocked off, and plugs get swapped when a board is changed",
      "Check that head's coil and gas-line sensors; a misread sensor closes the valve on purpose",
      "Power-cycle at the isolator for a full minute. On start-up the board drives every valve shut and counts open from there, which re-seats one that's lost its place",
      "Pipes go cold only when another head runs? That's crossed ports — start again on 'The wrong room responds'",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the valve's coil",
        when: "The coil reads open or shorted on the meter. It lifts off the valve body, so there's no refrigerant work.",
      },
      {
        fix: "Replace the valve",
        when: "Service valves open, coil, plug and sensors good, and a power cycle didn't shift it. Recovery, brazing and a recharge.",
        escalate: true,
      },
    ],
  },
  {
    id: "vrf-head-airside",
    title: "Refrigerant is arriving — treat this head on its own",
    confidence: "likely",
    explain:
      "Its pipes get cold or hot, so the outdoor unit, the branch and the comms are all doing their job for this circuit. Whatever's wrong is inside this head, and from here it diagnoses exactly like a single split.",
    actions: [
      "Check that head's filters, coil face and fan speed — and its fan wheel, because dust packed on the blades starves a head with spotless filters",
      "Ducted head: check for crushed or disconnected flexible duct on that run",
      "Confirm its louvres and any zone damper are actually open",
      "Compare its supply-air split against a head that's working properly",
    ],
  },
  {
    id: "vrf-diversity",
    title: "Everything calling at once — that's diversity, not a fault",
    confidence: "info",
    explain:
      "Multi and VRF outdoor units are deliberately sized below the sum of the heads connected to them, because in a real building they don't all run flat out together. On a design day with every head calling, each one gets less than its nameplate and the whole building drifts.",
    customer:
      "One outdoor unit feeds all of these heads, and it was sized on the assumption the whole building never runs flat out at the same moment — which is how every system like this is specified. On a day like today everything is calling at once, so each room gets a share rather than everything it could have. Turn off the rooms nobody is in and the rest come back.",
    actions: [
      "Check the connection ratio: total indoor capacity against the outdoor unit's rating",
      "Watch whether it recovers as heads satisfy and drop out",
      "Stagger start times, or set back the rooms nobody is using",
      "If every head genuinely runs together every day, the system was specified on the wrong assumption",
    ],
    tool: HEATLOAD,
  },
  {
    id: "vrf-charge",
    title: "Additional charge was probably never weighed in",
    confidence: "likely",
    explain:
      "These systems carry enough refrigerant for a nominal pipe run and need a calculated top-up for every metre beyond it. Miss that at commissioning and the whole system underperforms quietly for years — which is exactly what everything-is-a-bit-weak looks like.",
    actions: [
      "Measure the actual pipe runs and calculate the additional charge required",
      "Check the outdoor unit's charge label — it should record what was added and when",
      "Leak-test before adding anything: a missing top-up and a slow leak look identical from here",
      "Weigh the charge in against the calculation — never trim it in on pressure",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Find the leak and repair it before anything is weighed in",
        when: "The label says the extra charge WAS weighed in at commissioning and it still reads short. Then it has gone somewhere, and topping it up just buys the same callout next year.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
    escalate: true,
  },
  {
    id: "vrf-monitor",
    title: "Read it from the service monitor, not just the gauges",
    confidence: "info",
    explain:
      "The charge is documented and only part of the system is calling, so the next step is data. On an inverter multi or VRF the gauge ports tell you far less than the unit already knows — it is metering every valve, every sensor and the compressor speed itself.",
    actions: [
      "Put the outdoor unit into its service or check mode and read the live sensor data",
      "Record compressor speed, discharge temperature and each indoor unit's valve position",
      "Compare the heads against each other — the outlier is the circuit to chase",
      "Take gauge readings alongside it so the two can be cross-checked",
    ],
    tool: PRESSURES,
  },
  {
    id: "vrf-crossed-comms",
    title: "Control wiring crossed between heads",
    confidence: "likely",
    explain:
      "One room's controller is commanding another room's unit, so the transmission pairs — or the addresses set on the indoor boards — were swapped at install. The refrigerant side may well be perfectly correct.",
    actions: [
      "Map it properly: run each head alone and write down which room actually responds",
      "Correct it where it's cheapest: where addressing is set on the indoor boards, change the switches or settings; otherwise trace the transmission pairs back to the outdoor unit or branch controller and re-land them to match",
      "Re-test every head one at a time before you leave — crossings almost always come in pairs",
      "Label both ends while you're in there, so the next visit isn't this visit",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Rename the rooms on the central controller or app",
        when: "The heads are right and only the names are wrong — one room's name sits on another room's head. A setting, and nothing unscrewed.",
      },
      {
        fix: "Give one head and its remote a second address",
        when: "Two heads in one open space on handheld remotes, both answering the same remote. Nothing is crossed at all.",
      },
    ],
  },
  {
    id: "vrf-crossed-pipes",
    title: "Pipework crossed at the branch",
    confidence: "likely",
    explain:
      "The right head answers its own controller, but its pipes and its cable land on different ports. Each port has its own expansion valve, and the unit opens the valve for the port the calling head is wired to — so the refrigerant goes to whichever head is piped there. That's exactly why it only performs when another room calls. Nothing is broken: the pipes and the wiring just disagree, and the wiring is the side that's cheap to move.",
    actions: [
      "Map it: call each head on its own and write down whose pipes go cold — that's which port really feeds which room",
      "Move the cables, not the pipes: land each head's cable on the terminals of the port its pipes are on — no recovery, no braze, no recharge",
      "Re-test every head on its own afterwards — until the two matched, each valve was being driven off another room's sensors",
      "Label each port with the room it serves while you're in there, so the next visit isn't this visit",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Run the outdoor board's wiring-check mode",
        when: "The board has one. Some multis find the mismatch and correct it themselves, with nothing unscrewed — but the terminals still won't match the pipes, so label them anyway.",
      },
      {
        fix: "Set each head's address to the port its pipes are on",
        when: "The system matches a head to its port by address rather than by terminal. The cable stays put; check any central controller still names the rooms right afterwards.",
      },
      {
        fix: "Re-pipe at the ports to match the wiring",
        when: "Only if the pipework is coming apart anyway. It's recovery, brazing and a recharge for what the cables give you in minutes.",
        escalate: true,
      },
    ],
    safety:
      "Isolate the outdoor unit before any cable comes off a terminal — on many multis those terminals carry mains to the heads, not just the signal.",
  },

  /* pressures won't split */
  {
    id: "equal-at-rest",
    title: "That's a system at rest, not a fault",
    confidence: "info",
    explain:
      "With the compressor stopped, the high and low sides bleed together until they meet — usually within a few minutes. Equal pressures only tell you anything while it's running under load.",
    actions: [
      "Get it running and stabilised for 10–15 minutes at a fixed demand, then read again",
      "If it won't run at all, work the 'Won't turn on' path instead",
      "If it starts and stops within a minute or two, work 'Short cycling' — protection is cutting it out",
    ],
  },
  {
    id: "reverse-rotation",
    title: "Scroll is running backwards",
    confidence: "likely",
    explain:
      "A three-phase scroll compresses in one direction only. With two phases swapped it still energises and still draws current, but it moves no gas — so suction and discharge never separate. It runs distinctly louder than normal, and it destroys itself if it's left that way.",
    actions: [
      "Isolate it now — every minute of reverse running costs the compressor",
      "Confirm the sequence with a phase rotation meter at the supply terminals",
      "Correct it by swapping any two phases at the isolator, never inside the compressor",
      "Restart and confirm the pressures split within a minute and the noise has gone",
      "New install or recent switchboard work? Check the rest of the site — anything else three-phase will be reversed too",
    ],
    safety:
      "Every minute of reverse running costs the compressor, so isolate before anything else. Testing and correcting phase sequence is licensed electrical work — the warning on the question is still true here.",
    escalate: true,
  },
  {
    id: "reversing-valve",
    title: "Reversing valve is bypassing",
    confidence: "likely",
    explain:
      "A valve stuck between positions lets discharge gas run straight back into the suction line. The compressor works, the pressures equalise, and the system makes neither heat nor cold.",
    actions: [
      "Feel the four pipes at the valve body — when it's bypassing they sit at much the same temperature",
      "Measure the volts at its coil through a changeover, then meter the coil itself, unplugged — a dead coil is a clip-on part, no refrigerant work",
      "Coil good: raise the head first — cover part of the condensing coil for a minute, because the slide needs a pressure difference to move and a bypassing valve has thrown most of it away. Then call a few changeovers, tapping the body gently each time — a valve held on debris will often shift",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the reversing valve",
        when: "Volts arrive, the coil is good, and it still won't seat. Recovery, brazing and a recharge.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "not-pumping",
    title: "Compressor isn't pumping",
    confidence: "likely",
    explain:
      "It runs, the rotation is right and the reversing valve isn't bypassing, so the compressor itself has stopped moving refrigerant — worn scrolls, broken internals, or a failed internal discharge valve. Current usually reads low rather than high, because it isn't doing any work.",
    actions: [
      "Before condemning anything: service valves fully open, and both valves on the gauge manifold shut — an open one joins high and low through the gauge set, and they read the same",
      "Measure running current — well under the nameplate figure supports this",
      "Scroll: many carry an internal relief valve that opens on a big pressure difference and stays open while it runs. Stop it, let the pressures meet, fix whatever drove the head up — a dead condenser fan, a blocked coil — and restart before you condemn it",
      "Check for a failed internal discharge check valve, and for a compressor terminal fault — the 'Compressor suspect' tile walks the electrical proof of the motor itself",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the compressor",
        when: "Valves right, the relief valve given its reset, current still low and the pressures still won't split. Find out what killed it before the new one goes on — the 'already out' path on the 'Compressor suspect' tile reads the oil.",
        escalate: true,
      },
    ],
    tool: PRESSURES,
  },
  {
    id: "drive-limited",
    title: "The drive is holding it back",
    confidence: "likely",
    explain:
      "An inverter compressor only does what the drive lets it. Starting and then sitting at minimum speed — or winding back every time it tries to climb — is the drive protecting something: current, discharge temperature, a power module running hot, or a condenser that can't reject heat pulling it into current limit. The pressures never split because the compressor never really gets going. The unit knows exactly which limit it's sitting on — read it out of the boards instead of guessing from the gauges.",
    actions: [
      "Put it in service or check mode and read the live data: target versus actual speed, current, discharge temperature — the drive names the limit it's riding. If it shows a fault code instead of a limit, that's the 'Error light or code' path's job",
      "Check nothing is telling it to hold back: quiet, night or econo modes, a demand limit set in the controller, or a demand-response device limiting it for the power network all cap the compressor on purpose",
      "Clean the condenser and confirm the fan before blaming electronics — on a 40-degree afternoon a dirty coil will current-limit a perfectly healthy compressor",
      "Riding the power module's temperature limit? Clean its heat sink — the fins sit in the same airflow and clog with the same dust",
      "Riding the discharge-temperature limit? That's the refrigerant side, not the drive: a short charge, or an expansion valve stuck shut, runs the compressor hot. Work the charge and the valve before the board",
      "Check supply voltage under load at the outdoor terminals; a sagging supply pulls current up and the drive winds back to survive it",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Find the leak, repair it and weigh the charge in",
        when: "It rides the discharge-temperature limit with high superheat and the valve working: it's short. Never just top it up.",
        escalate: true,
      },
      {
        fix: "Replace the drive board",
        when: "The drive flags its power module, or won't run the compressor at any speed, with the heat sink clean and the supply good. Prove the compressor first with the 'Compressor suspect' tile — a motor that's tightening drags the drive into current limit too.",
        escalate: true,
      },
    ],
    safety:
      "An inverter drive stores power in big capacitors — the DC bus — and they hold hundreds of volts long after the isolator is off. Isolate, wait the time printed on the panel, then prove them dead with a meter on DC volts before fingers or probes go anywhere near the board.",
    tool: PRESSURES,
  },
  {
    id: "phase-protection",
    title: "Phase protection is blocking the start",
    confidence: "likely",
    explain:
      "The relay is holding the contactor out because it doesn't like what it sees on the supply — a lost phase, a reversed sequence, or voltage unbalance beyond its setting. Resetting it without fixing the supply just single-phases the compressor.",
    actions: [
      "Measure all three phases at the unit's terminals, phase to phase and phase to neutral",
      "A missing phase is usually a blown fuse, a dropped connection or a utility fault — not the unit",
      "Check the sequence if the site has had switchboard work or a new supply",
      "Read the relay's own settings before you condemn the supply — an unbalance or under-voltage setting screwed down too tight trips on a supply the unit is perfectly happy with",
      "Check the relay's own terminals while you're there: a loose connection under one of them reads as the missing phase it's reporting",
      "Compare the unbalance against the relay's setting before deciding the relay is faulty",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the relay",
        when: "The supply measures good on all three, the sequence is right, and it still holds the contactor out with its own settings where they should be.",
      },
      {
        fix: "Have the supply repaired",
        when: "A phase is missing, the sequence is wrong, or the unbalance is real. Testing and correcting it is licensed electrical work, and resetting the relay without it just single-phases the compressor.",
        escalate: true,
      },
    ],
  },

  /* ducted zoning */
  {
    id: "zone-not-zoning",
    title: "That isn't a zoning problem",
    confidence: "info",
    explain:
      "Every room weak all the time, whatever's open, means the system isn't producing or moving enough in the first place. Zoning only decides how the air gets shared out — it can't hand out air that was never there.",
    actions: [
      "Work the 'Not cooling' or 'Not heating' path instead",
      "Start with the return-air filter — on a ducted system that's one big grille, and it's the most forgotten filter in the trade",
      "Then the outdoor coil and the indoor fan speed",
      "Come back here if it turns out one room really is worse than the rest",
    ],
  },
  {
    id: "zone-damper",
    title: "Zone damper isn't opening",
    confidence: "likely",
    explain:
      "The zone calls and the damper serving it never moves, so that branch of the duct stays shut no matter what the controller thinks it's doing. It's the damper motor, its wiring, or the controller output driving it.",
    actions: [
      "Swap the plug with a zone that works — if the fault follows the damper it's the motor, if it stays put it's the wiring or the board",
      "Check the blade hasn't jammed on insulation, a stray screw or a sagging flex",
      "Confirm the controller is calling that zone and hasn't had it disabled in the setup",
      "Check the damper is wired to the zone everyone thinks it is — mislabelled zones are common",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the damper motor",
        when: "The fault follows the damper when you swap the plugs.",
      },
      {
        fix: "Repair the wiring, or the controller's output for that zone",
        when: "The fault stays with the zone when you swap the plugs: the damper is fine, and what drives it isn't.",
      },
      {
        fix: "Fix the blade open by hand",
        when: "A stopgap while a motor is on order. Most damper motors come off the blade shaft, so turn the blade open and fix it there — the room gets air today, it just can't be zoned off.",
      },
    ],
  },
  {
    id: "zone-duct",
    title: "Duct is off, crushed or kinked",
    confidence: "likely",
    explain:
      "The damper opens, so the controller and the motor are both doing their job — the air simply isn't arriving. Somewhere between that damper and the outlet the flexible duct has pulled off, been crushed, or been bent hard enough to choke it.",
    actions: [
      "Follow that run in the ceiling from the damper right through to the outlet",
      "Look for a flex pulled off its spigot — a disconnected run air-conditions the roof space instead of the room",
      "Check where the run crosses a truss or a downlight for crushing, and look for the knee-print: the commonest crush is where somebody knelt or walked",
      "Check nobody has cable-tied it to a truss hard enough to choke it — a tie pulled tight does as much as a crush",
      "Re-clamp and tape properly, and support long runs so they can't sag into a trap",
    ],
  },
  {
    id: "zone-balance",
    title: "Never balanced, and the far room pays",
    confidence: "likely",
    explain:
      "Air takes the easy path. With nothing set, the short straight runs nearest the indoor unit take more than their share and whatever sits at the end of the longest run lives on the leftovers. Extremely common on systems installed and never commissioned.",
    actions: [
      "Balance it properly: partly close the takeoffs on the rooms that are over-served rather than only opening the poor one",
      "Balance it with the zones the customer actually runs open, not with the whole house open — otherwise it's right once and wrong every evening",
      "Measure at the diffusers instead of judging by hand",
      "Mark what you set, on the damper or in the notes, so the next person doesn't undo an afternoon's work in five minutes",
      "Straighten, shorten and support that long run while you're up there — every bend costs air",
      "Check the flex size on that run matches what the outlet actually needs",
    ],
  },
  {
    id: "zone-outlet",
    title: "Outlet or takeoff is the restriction",
    confidence: "possible",
    explain:
      "Short straight run, damper open, and still short of air — so the restriction is at one end or the other. Either the takeoff off the plenum is undersized, its balancing damper is partly shut, or the diffuser can't pass what the room needs.",
    actions: [
      "Check the balancing damper at the takeoff is genuinely open",
      "Compare the flex and spigot size against the rooms that work",
      "Check the diffuser isn't a smaller size or a more restrictive pattern than the others",
      "Look for insulation or debris pulled into the spigot",
    ],
  },
  {
    id: "zone-return",
    title: "The room can't get its air back out",
    confidence: "likely",
    explain:
      "Supply air has to leave the room or it pressurises and stops accepting any more. With the door shut and nowhere to go, a room can have a perfectly good outlet and still never get there.",
    actions: [
      "Shut the door and check the diffuser again — a clear drop in airflow confirms it",
      "Fit a relief grille through to the hallway",
      "Check the main return grille isn't blocked by furniture while you're at it",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Run a transfer duct through the ceiling instead",
        when: "Bedrooms and offices, where a grille in the wall or door would carry sound and light through with the air.",
      },
      {
        fix: "Undercut the door",
        when: "The shortfall is small. It helps, but rarely does the job on its own.",
      },
    ],
  },
  {
    id: "zone-load",
    title: "That room needs more than its share",
    confidence: "possible",
    explain:
      "Plenty of air arrives, it can get back out, and the room still won't hold temperature — so the outlet was sized on floor area rather than on what the room actually does. West glass, a skylight, a wall of windows or a room full of equipment all beat a nominal share of air.",
    actions: [
      "Work that room's load out properly instead of by area",
      "Compare it against what that outlet can actually deliver",
      "Cut the load where it's cheap: shade the west glass and the skylight — usually cheaper than re-ducting",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Add an outlet, or up-size the run",
        when: "The load is real and can't be cut. It's a duct job, and the extra air comes out of the other rooms' share, so re-balance the rest after.",
      },
    ],
    tool: HEATLOAD,
  },
  {
    id: "zone-minimum",
    title: "Too much of the system shut down",
    confidence: "likely",
    explain:
      "A ducted system needs a minimum amount of duct open to work. Close too many zones and static pressure climbs, the bypass dumps supply air straight back into the return, and even the zones that are open stop getting a useful share — or the unit cuts out on protection.",
    actions: [
      "Find how many zones this system needs open, and whether a constant zone was ever set up",
      "Set it in the controller rather than in the customer's habits: most zone controllers can be told a minimum number of zones, or which one to hold open as the spill, and then it looks after itself",
      "Leave a constant or dump zone open — a hallway is the usual choice",
      "Set the bypass so it holds static without dumping most of the air",
      "Watch the supply-air temperature: bypassed air returning to the coil drags it back towards room temperature",
    ],
  },
  {
    id: "zone-capacity",
    title: "It can't run every zone at once",
    confidence: "possible",
    explain:
      "Worse with everything open means the indoor unit is being asked for more than it was sized to give. Ducted systems are routinely specified on the assumption that the whole house never calls together — which is fine right up until it does.",
    actions: [
      "Add up the load of all the zones and compare it against the unit's capacity",
      "Check what diversity the system was designed on, if anyone wrote it down",
      "Stagger zones by time of day rather than running the lot — and set that in the controller's schedule, where it will still be happening next summer",
      "Check what the dampers actually do: ones that only open or shut hand everything to whoever is open, while modulating dampers share what there is",
      "If every zone genuinely has to run together, it was specified on the wrong assumption",
    ],
    tool: HEATLOAD,
  },

  {
    id: "drain-install",
    title: "It was never going to drain",
    confidence: "likely",
    explain:
      "A drain that has never worked, or that stopped the day someone worked on it, isn't blocked — it was built wrong. No fall, an uphill section, a trap that can't hold a seal, or a line that was never connected to anything at all.",
    actions: [
      "Sight the whole run for continuous fall — one uphill section holds water and stops everything behind it",
      "Confirm the line actually terminates somewhere sensible and wasn't just left in the ceiling",
      "Check the trap suits the unit's fan pressure: too shallow and it blows dry, too deep and it never clears",
      "Confirm the indoor unit is level, or sitting very slightly down towards its drain outlet",
      "Re-run the bad section rather than trying to clear a line that was never right",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Fit a condensate pump",
        when: "Only where fall genuinely can't be had. A pump is one more part that fails, and fall never does.",
      },
    ],
  },

  /* condensation on surfaces */
  {
    id: "cond-leak",
    title: "Supply air is leaking into the ceiling",
    confidence: "likely",
    explain:
      "A damp ring in the plasterboard around a diffuser is cold supply air escaping at the collar instead of going through it. It chills the ceiling from above, humid room air condenses on the cold patch, and the mark spreads outwards in a ring.",
    actions: [
      "Get above it and check the flex is clamped and taped onto the diffuser collar properly",
      "Seal the collar to the plasterboard — the gap around the cut-out is where it escapes",
      "Pull the insulation right down over the collar and tape it, leaving no bare metal in the roof space",
      "Check every other diffuser for the same thing; one bad collar is usually a habit, not an accident",
      "Replace stained plasterboard once it's dried out, or it will ghost back through the paint",
    ],
  },
  {
    id: "cond-insulation",
    title: "Bare or failed insulation in the roof",
    confidence: "likely",
    explain:
      "Cold duct or pipe sitting in warm humid roof air sweats wherever it isn't covered. The water then runs along the outside and drops somewhere else entirely, which is why this usually gets reported as a leak from a completely unrelated spot.",
    actions: [
      "Follow the run and find where insulation is missing, split, compressed or unsealed",
      "Look hardest at joints, bends and anywhere it passes through a frame — that's where it gets left open",
      "Check the vapour barrier is continuous and taped; insulation without a sealed barrier just sweats on the inside instead",
      "Check the suction line and the drain line too — both run cold through warm roof space and both get left bare",
      "Check whether the roof space itself is unusually humid or poorly ventilated — and whether the vents it does have are blocked by insulation, which is the cheapest fix on this list",
      "Trace where the water actually lands, so nobody chases the wrong ceiling next visit",
    ],
  },
  {
    id: "cond-building",
    title: "That's building humidity, not the system",
    confidence: "info",
    explain:
      "Condensation on windows, external walls and in corners well away from the air conditioning is a building problem — moisture being made indoors faster than it's being removed, meeting cold surfaces. The system can help with it, but it didn't cause it.",
    customer:
      "This is moisture being made inside the house faster than it's getting out — showers, cooking, washing dried indoors — meeting cold glass and cold walls. The air conditioner will pull some of it out while it's running, but it isn't what caused it, and a bigger one wouldn't fix it. Getting the moist air out of the building is what fixes it.",
    actions: [
      "Look for the sources: washing dried indoors, unflued gas heating, long showers, a damp subfloor",
      "Check bathroom and kitchen fans actually run, and discharge outside rather than into the roof space",
      "Running cooling or dry mode will pull humidity down while it runs",
      "Persistent mould alongside the condensation is a health conversation, not just a comfort one",
      "Where the building needs ventilation, that's the fix — a bigger air conditioner isn't",
    ],
  },
  {
    id: "cond-humidity",
    title: "The room's dew point is too high",
    confidence: "likely",
    explain:
      "Every grille sweating means the air in the room is humid enough that anything cold will collect water. The grilles aren't faulty — they're just the coldest surfaces in the room, so they go first.",
    customer:
      "The grilles aren't the problem — they're the coldest things in the room, so they're where the moisture shows up first. The air in here is holding more water than it can keep hold of once it touches something cold. Bring the humidity down and the sweating stops on its own.",
    actions: [
      "Measure room temperature and humidity, work out the dew point, and compare it against the supply air temperature",
      "Find the moisture source: doors open to humid air, a wet process, a room full of people",
      "Check it runs long enough to dehumidify — short cycles cool the air without drying it",
      "Try dry mode, or drop the fan a speed, to take more moisture out per pass",
      "An oversized system satisfies before it dehumidifies; check capacity against the room",
    ],
    tool: HEATLOAD,
  },
  {
    id: "cond-airflow",
    title: "Low airflow is making that grille cold",
    confidence: "likely",
    explain:
      "Less air over the same coil leaves colder, so the grille face runs colder too — and once it drops below the room's dew point it sweats. Same starved-airflow story that ices coils, just caught earlier.",
    actions: [
      "Check the return filter and the indoor coil first",
      "Raise the fan a speed and see whether the sweating stops",
      "Check that grille's own run for crushed or kinked flex",
      "Check the balancing damper at its takeoff isn't mostly shut",
      "Make sure too many zones aren't closed down at once",
    ],
  },
  {
    id: "cond-aluminium",
    title: "Aluminium grille sitting below the room's dew point",
    confidence: "likely",
    explain:
      "Aluminium conducts heat roughly a thousand times better than plastic, so a bare aluminium grille in the supply airstream ends up within a degree or two of the air going through it — about 10–14°C on a system in cooling. A room at 24°C and 60% humidity has a dew point near 16°C; at 70% it's over 18°C. The face is sitting several degrees below that, so the moisture in the room air condenses onto it. Nothing is leaking and nothing has failed — it's simply the coldest surface in the room, so it collects water first.",
    customer:
      "It's the same thing a cold drink does on a summer day: the glass isn't leaking, the air is dropping its moisture onto a cold surface. Aluminium carries cold better than almost anything else in the room, so the grilles end up the coldest thing you've got and the water turns up there first. We fix it by making the air less humid, making the grille less cold, or a bit of both.",
    actions: [
      "Raise the fan a speed. More air over the coil leaves warmer, which lifts the grille face temperature — fastest fix there is, and the opposite of what most people expect",
      "Lift the setpoint a degree or two; it moves the face temperature more than it sounds like it should",
      "Clean the return filter and the coil — anything starving airflow drives the supply air colder",
      "Open more zones, or set up a constant zone. Same lever as the fan, not a competing one: it drops the static so the fan actually moves more air, and it stops the bypass dumping cold supply air back into the return where it drags the coil colder still",
      "Know the trade-off before you lean on fan speed: more air means less moisture pulled out, so it warms the face while the room's dew point creeps up behind you. Over a short visit the face wins easily. In a genuinely humid room it's a band-aid, and the fix flips — drop the fan or use dry mode to get the moisture out, and solve the grille itself instead of the air",
      "Insulate the back of the grille and its neck right up to the face, and check the flex insulation is pulled over the collar and taped",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Change to a thermal-break or plastic-faced diffuser",
        when: "It keeps coming back once the air side is right — this is the permanent fix. Powder coating and anodising do NOT fix it: the coating is microns thick and the metal underneath still conducts.",
      },
      {
        fix: "Dry the room instead of warming the grille",
        when: "The room itself is humid. Shut doors and windows to humid air, make sure wet-area extraction runs and discharges outside, stop washing being dried indoors — and let it run longer and steadier, because short cycles cool without drying.",
      },
      {
        fix: "Fit a closed-cell gasket between the frame and the ceiling",
        when: "The plasterboard around the grille sweats too: the frame is cold-bridging into it.",
      },
      {
        fix: "Check the system isn't oversized",
        when: "It persists everywhere. A system that satisfies too fast never gets around to dehumidifying.",
      },
    ],
    tool: HEATLOAD,
  },
  {
    id: "cond-grille-place",
    title: "Where it sits, or where the air goes",
    confidence: "possible",
    explain:
      "It isn't bare aluminium and the airflow is normal, so the face isn't cold for either of the usual reasons. What's left is position and throw — a jet curling back across the face, a grille bridging to a cold surface, or a dead corner where humid air sits still against it.",
    actions: [
      "Watch the throw: cold air washing back over the face keeps it cold and keeps feeding it humid room air",
      "Adjust the blades or vanes so the jet leaves cleanly instead of hugging the ceiling straight back to the grille",
      "Check it isn't hard against a cold wall, a bulkhead or an uninsulated surface it can bridge to",
      "Look for a dead corner with no air movement — still humid air against any cool surface will condense",
      "Check the back of the grille and its neck are insulated whatever the face is made of",
    ],
  },

  /* compressor suspect */
  {
    id: "comp-setup",
    title: "Set up the test before the test",
    confidence: "info",
    explain:
      "Ten minutes of setup is what makes the readings mean anything — and keeps the meter, the drive and your hands out of trouble. Compressor testing is done dead, disconnected and discharged, every single time.",
    actions: [
      "Isolate at the local isolator and the switchboard, and lock or tag what you switched off",
      "Photograph the terminal lid and the wiring exactly as found — the lid diagram is your map back when it's time to reconnect",
      "Pull the leads off the compressor terminals; testing through the board or the drive tests the wrong thing, and a megger through electronics kills them",
      "Single-phase: give the run capacitor a minute after isolating — most drain themselves through a bleed resistor built across the terminals — then meter on DC volts across it to prove it, rather than trusting it",
      "Still reading volts after a few minutes? Its bleed resistor has failed — that's a finding, not an obstacle. The capacitor is due for replacement anyway, so treat it as live, get it out with insulated tools and bin it rather than trying to make it safe in place",
      "Don't bridge a charged one with a screwdriver. It welds the tip and pits the terminals, and the real risk isn't the shock — it's the involuntary jerk, up a ladder or over an open board",
      "Worth two dollars in the meter case: a 20 kΩ resistor with a pair of clip leads. It drains a run capacitor in seconds and it's the only tool for the job that fits in a pocket",
      "Inverter: the drive stores power in big capacitors (the DC bus) after the power is off — wait the time printed on the panel, then prove them dead with the meter on DC volts across the marked points",
      "Then come back and walk the test",
    ],
    safety:
      "Damaged or corroded terminals on a pressurised system can blow out of the shell. Terminal cover on until power is dealt with, glasses on, stand to the side.",
  },
  {
    id: "comp-overload",
    title: "The internal overload is open — the motor may be fine",
    confidence: "info",
    explain:
      "Single-phase hermetics carry a thermal overload inside the shell, in series with the common terminal. When it opens, C to anything reads open — but R to S still reads, because that path doesn't go through it. That exact signature is a protector doing its job, not a dead compressor — and condemning one on a hot afternoon is the classic expensive mistake.",
    actions: [
      "Let it cool and retest — half an hour for a small unit, hours for a big scroll that's been baking in the sun",
      "When C–R and C–S come back, the motor is intact — now find what overheated it",
      "Check the condenser, the charge, the supply voltage and the run capacitor: overloads trip for a reason",
      "If it never comes back once it's genuinely stone cold, then it really is an open winding",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Cool the shell to reset it sooner",
        when: "You can't wait hours on a big one. Still isolated, terminal cover on: a wet rag or a gentle hose on the shell, kept off the terminal box and the electrics, brings the protector back far sooner.",
      },
    ],
  },
  {
    id: "comp-open",
    title: "Open winding",
    confidence: "likely",
    explain:
      "A winding that reads open circuit on a stone-cold compressor is broken inside the shell, and there's no repair on a hermetic — the fix is a compressor. Prove it properly first, because two cheaper faults read exactly the same from the wrong spot.",
    actions: [
      "Measure at the compressor terminals themselves, not the ends of the leads — a corroded spade or a broken lead reads identical",
      "Make sure it's actually cold: internal overloads can take hours to reset on a big machine, and three-phase units can carry them too",
      "Check the terminal posts — a burnt or loose post reads open at the same spot",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the lead or its spade",
        when: "The winding reads at the posts but not through the lead. The compressor is fine, and it's a part from the van.",
      },
      {
        fix: "Replace the compressor",
        when: "It reads open at the posts themselves, stone cold. Then read the oil out of the old one before the new one goes on — start this tile again and pick 'It's already out': the oil is the only witness to why it died.",
        escalate: true,
      },
    ],
    escalate: true,
  },
  {
    id: "comp-short",
    title: "Shorted winding",
    confidence: "likely",
    explain:
      "A reading far below what the winding should be means turns have welded together inside. It pulls big current, trips protection, and it often takes the capacitor or the start gear down with it on the way out.",
    actions: [
      "Prove it with the leads off, at the compressor's own posts — measured through a drive, a shorted power module reads exactly like shorted turns",
      "Compare against the winding spec if you can get one — 'low' only means something against a number",
      "Insulation-test to earth as well; shorted turns and earthed windings usually travel together",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the drive board",
        when: "Inverter: the short reads through the drive but not at the compressor's own posts. It's the power module, not the motor — prove the big capacitors dead before the board comes out.",
        escalate: true,
      },
      {
        fix: "Replace the compressor",
        when: "Shorted at its own posts with the leads off. Recovery, braze, driers, evacuation — and before the new one goes in, test the run capacitor and start gear on a fixed-speed unit, or have the drive checked on an inverter, since a motor that shorted can take the power module with it. Otherwise the new compressor inherits the same death.",
        escalate: true,
      },
    ],
    escalate: true,
  },
  {
    id: "comp-unbalanced",
    title: "One winding out of balance",
    confidence: "possible",
    explain:
      "Three-phase windings are identical by construction, so the pairs should read the same. One pair sitting clearly away from the others is a winding partly gone — shorted turns starting, or a joint on the way out — and it doesn't get better.",
    actions: [
      "Zero the leads and measure again — at these resistances the leads themselves can invent an imbalance",
      "Clean the terminal posts back to bright metal and measure again — a corroded post or a tired spade adds resistance and reads exactly like a winding going",
      "Insulation-test all three to earth while you're connected",
      "Under load, compare the three phase currents — the sick winding shows there too",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Replace the spades or leads",
        when: "The imbalance goes away with bright posts and fresh connections. It was the connection, not the winding.",
      },
      {
        fix: "Plan the compressor replacement",
        when: "The imbalance is real with zeroed leads and bright posts. Partial winding failures finish the job without warning, so book it rather than wait for it.",
        escalate: true,
      },
    ],
    escalate: true,
  },
  {
    id: "comp-damp",
    title: "Insulation is breaking down",
    confidence: "possible",
    explain:
      "Low megohms isn't dead — it's dying. Moisture in the system, acid from an old burnout, or years of heat all drag insulation down, and the number you just took is one point on a curve heading the wrong way.",
    actions: [
      "Dry and clean the terminal box and retest first — a wet plug reads exactly like a sick motor",
      "Sat idle and cold? Liquid refrigerant settles in the shell and drags the reading down just like failing insulation. Reconnect it, power the unit up but leave it off at the controller for a few hours so the crankcase heater or the drive's own preheat can warm it, then isolate and test again",
      "Record the reading, the date and the ambient: the trend is the diagnosis, not the single number",
      "Acid-test the oil if there's any burnout history on this system — the 'already out' path on this tile walks the test and what the oil is telling you",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Change the liquid-line drier and pull a deep vacuum",
        when: "It still reads low warm and dry: moisture in the system is doing it. Retest after a good run — still falling means the windings are finished.",
        escalate: true,
      },
      {
        fix: "Plan the compressor",
        when: "The trend keeps falling after the drier. Better booked than found dead on a hot afternoon.",
        escalate: true,
      },
    ],
  },
  {
    id: "comp-earthed",
    title: "Windings down to earth",
    confidence: "likely",
    explain:
      "The insulation between the windings and the shell has failed, and current is leaking straight to earth — this is the compressor that keeps taking out the safety switch. Every reset pushes fault current through a dying motor.",
    actions: [
      "Stop resetting the RCD on it — each reset does more damage",
      "Double-check the finding before condemning: dry the terminal box, leads off, clean earth point, test again",
      "Cold and idle a while? Reconnect it and power the unit up, left off at the controller. If the safety switch holds, give the crankcase heater or the drive's preheat a few hours to boil liquid refrigerant out of the shell, then test again — a flooded compressor can read under a megohm and come good. One that trips on power-up alone has answered the question",
      "Treat it as a burnout until proven otherwise — read the oil out of the old compressor once it's off, via the 'already out' path on this tile, and plan driers and a flush",
      "Burnt oil is acidic — gloves on when the system gets opened",
    ],
    escalate: true,
  },
  {
    id: "comp-sound",
    title: "The compressor is electrically sound — look at what feeds it",
    confidence: "likely",
    explain:
      "Windings intact and balanced, nothing to earth: the motor is healthy. A healthy compressor that still won't run is being failed by what's around it — the start gear, the switching, or the supply.",
    actions: [
      "Single-phase: test the run capacitor. Prove it's discharged on DC volts first, then switch to the capacitance setting — marked µF — and expect the printed rating within about ten percent",
      "Take at least one capacitor lead off before you measure it: left in circuit you're reading the motor windings in parallel with it, and the number means nothing",
      "Bulged, weeping or well off its rating means replace it — and a bulged one is a fair bet for why the compressor was struggling",
      "Single-phase: check the start relay or PTC starter — burnt contacts, or a rattle when you shake it",
      "Fixed-speed three-phase: open the contactor and look at the contacts — pitted or welded contacts single-phase the motor",
      "Measure voltage at the compressor terminals during a start attempt, not at rest — a sagging supply, or a burnt spade on a post, only shows itself under load",
      "Clamp meter on for the start: around ONE conductor only — around the whole cable the fields cancel and it reads zero",
      "Inverter: there's no capacitor, relay or contactor — the drive starts it. Read the fault it has logged in check mode, and check the three leads and their plug at the board. What it logs is a code, so take it to the 'Error light or code' path rather than reading it twice here",
      "If it runs but pumps nothing, that's the 'Pressures won't split' path from here",
    ],
    plan: "check",
    alternatives: [
      {
        fix: "Add a restart delay",
        when: "It only fails on a quick restart: the pressures haven't equalised, and a fixed-speed compressor can't start against them. A time-delay relay, or the controller's own restart delay, gives them the few minutes they need.",
      },
      {
        fix: "Fit a hard-start kit",
        when: "Fixed-speed single-phase that hums and trips at start with a good run capacitor and full volts. A start capacitor and relay get a sound compressor going; they won't save a worn one. Never on an inverter.",
      },
      {
        fix: "Replace the drive board",
        when: "Inverter compressor sound, leads and plug good, and the drive still won't run it. Board work — prove the big capacitors dead before it comes out.",
        escalate: true,
      },
    ],
  },

  /* reading the oil — what killed it */
  {
    id: "oil-metal",
    title: "Metal in the oil — it wore out, and something starved it",
    confidence: "likely",
    explain:
      "Glitter, grit or shavings mean metal has been running on metal inside the shell: bearings, scrolls or vanes turning without a film of oil between them. The acid test can come back completely clear on one of these, because the motor never burned — the mechanical end simply wore itself out, usually getting noisy for a while first. The wear is the symptom. The cause is nearly always oil that stopped coming back to the compressor.",
    actions: [
      "Work out why the oil wasn't returning BEFORE you quote the new compressor, or the new one dies exactly the same way",
      "Check suction line sizing and pitch — gas velocity is what carries oil home, and an oversized suction riser is the classic offender",
      "Check there are traps at the foot of risers, and that long horizontal runs fall back towards the compressor",
      "Inverter systems: months of cruising at minimum speed drops velocity right off, so oil never gets swept back — check what speed it actually lives at, not what it can do",
      "Rule out flood-back and migration too: oil diluted with liquid refrigerant isn't lubricating either",
      "Flush the system before the new one goes on — those shavings are downstream now. New liquid-line drier, and consider a suction filter for the first run",
      "Match oil type and charge to the new compressor, and check the level once it's run: POE and mineral don't mix",
    ],
    escalate: true,
  },
  {
    id: "oil-burnout",
    title: "Motor burnout — the system is contaminated",
    confidence: "likely",
    explain:
      "Dark oil with a sharp acrid smell is a burnout. The windings cooked, and the breakdown products — acid, sludge and moisture — are now spread through everything the oil reached. Left in there, that acid starts on the new compressor's windings from the first hour it runs.",
    actions: [
      "Acid-test to confirm it and to gauge how far gone it is",
      "Recover the charge separately and don't reuse it",
      "A mild one cleans up on driers: fit an oversized liquid-line drier, add a suction-line drier for the clean-up run, then re-test acid after a few hours running and change them again",
      "Keep re-testing until it comes back clean; that's the whole job, not an optional extra",
      "Tell the customer plainly this is a clean-up as well as a compressor — it's why the quote isn't just a part and an hour",
    ],
    plan: "fix",
    alternatives: [
      {
        fix: "Flush the lines",
        when: "A bad burnout, or acid that won't clear after two sets of driers. Driers won't get sludge out of the pipework.",
        escalate: true,
      },
      {
        fix: "Replace the lines",
        when: "Severe, and the pipework can be got at. New pipe is a surer clean than a flush on a long, trapped run.",
        escalate: true,
      },
    ],
    safety:
      "Burnt refrigeration oil is acidic. Gloves and glasses, ventilate the space, and don't breathe the vapour when the system comes apart.",
    escalate: true,
  },
  {
    id: "oil-moisture",
    title: "Moisture in the oil",
    confidence: "likely",
    explain:
      "Cloudy or milky oil means water has got in — a low-side leak drawing it in every cycle, a system left open on the bench, or POE oil doing what POE does, which is pull moisture out of the air fast and refuse to give it back. Water plus refrigerant plus heat makes acid, so an untreated wet system becomes a burnout eventually.",
    actions: [
      "Acid-test as well — moisture and acid usually turn up together",
      "Find how the water got in before you charge anything: a leak on the low side pulls air and moisture in continuously",
      "New liquid-line drier, and pull a proper deep vacuum to a micron gauge rather than to the clock",
      "Triple-evacuate with dry nitrogen breaks on a genuinely wet system — one pull-down will not get it out",
      "Cap the compressor stubs and don't leave POE open to atmosphere any longer than you have to",
    ],
    escalate: true,
  },
  {
    id: "oil-clean",
    title: "Oil is clean — now keep it that way",
    confidence: "info",
    explain:
      "Clear to light straw, no smell, nothing floating in it. The oil isn't accusing the motor or the mechanical end, and the system isn't contaminated — which is the best result you can get on a change-out, and it makes the clean-up simple.",
    actions: [
      "Run the acid test anyway and write the result on the job — clean-looking oil with acid present is an early burnout you'd otherwise hand straight to the new compressor",
      "Change the liquid-line drier regardless: cheapest insurance on the whole job",
      "Check oil type and charge against what the new compressor wants",
      "If it failed mechanically but the oil is clean, look harder at oil return and short cycling before you blame the part",
    ],
  },
];

/* ───────────────────────────── helpers ───────────────────────────── */

const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const OUTCOME_BY_ID = new Map(OUTCOMES.map((o) => [o.id, o]));

/** True when an answer's `next` points at an outcome rather than a question. */
export function isOutcomeRef(next: string): boolean {
  return next.startsWith("out:");
}

/** Strip the "out:" prefix. */
export function outcomeId(next: string): string {
  return next.slice(4);
}

export function getQuestion(id: string): Question | undefined {
  return QUESTION_BY_ID.get(id);
}

export function getOutcome(id: string): Outcome | undefined {
  return OUTCOME_BY_ID.get(id);
}

export function getSymptom(key: string): Symptom | undefined {
  return SYMPTOMS.find((s) => s.key === key);
}

/** One answered step, for the trail the UI shows above the current question. */
export interface TrailStep {
  questionId: string;
  ask: string;
  answer: string;
}

/** Every id an answer can point at — used by the integrity tests. */
export function allReferences(): string[] {
  return QUESTIONS.flatMap((q) => q.answers.map((a) => a.next));
}

const REMAINING = new Map<string, { min: number; max: number }>();

/** How many questions still lie ahead AFTER the one at `id`, best case to
    worst case.

    A bare "Question 5" with no denominator reads as endless, which is the
    real reason a long branch feels long — the tech can't tell whether
    they're one answer from the end or five. The trees know the answer, so
    the header can say. Safe to call on every render: the shape is static,
    so each id is computed once. */
export function stepsRemaining(id: string): { min: number; max: number } {
  const cached = REMAINING.get(id);
  if (cached) return cached;

  const q = QUESTION_BY_ID.get(id);
  if (!q) return { min: 0, max: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const a of q.answers) {
    let lo = 0;
    let hi = 0;
    if (!isOutcomeRef(a.next)) {
      const d = stepsRemaining(a.next);
      lo = 1 + d.min;
      hi = 1 + d.max;
    }
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }

  const out = { min: Number.isFinite(min) ? min : 0, max };
  REMAINING.set(id, out);
  return out;
}

/** The header's "how much further" line, or null when there's nothing
    useful to say. */
export function remainingLabel(id: string): string | null {
  const { min, max } = stepsRemaining(id);
  if (max === 0) return "Last question";
  if (min === 0) return `up to ${max} more`;
  if (min === max) return min === 1 ? "1 more" : `${min} more`;
  return `${min}–${max} more`;
}
