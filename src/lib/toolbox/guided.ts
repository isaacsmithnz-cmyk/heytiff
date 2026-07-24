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
   universal-table data only enters HeyTiff through uploaded documents, so the
   error-code branch sends you to that unit's service manual instead. */

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
  | "pumping";

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

export interface Outcome {
  id: string;
  title: string;
  /** how sure the tree is at this point */
  confidence: "likely" | "possible" | "info";
  /** the reasoning, in plain language */
  explain: string;
  /** ordered next actions */
  actions: string[];
  /** licensed / specialist work beyond a routine visit */
  escalate?: boolean;
  /** hand-off to another Toolbox tool */
  tool?: { label: string; href: string };
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
];

/* ───────────────────────────── questions ─────────────────────────────
   Ordered roughly by symptom. Ids are namespaced by symptom so a stray
   reference is obvious on sight. */

export const QUESTIONS: Question[] = [
  /* ---------------- not cooling ---------------- */
  {
    id: "cool.mode",
    ask: "Is it set to COOL, with the setpoint below room temperature?",
    why: "Check the remote or wall controller. Auto mode can sit in heating, fan-only and dry won't pull the room down, and a schedule or eco limit can cap how low the setpoint will go. Five seconds, and it's a top-three cause of a no-cool callout.",
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
    why: "Check the remote or wall controller — auto mode can sit in cooling, and a schedule or eco limit can cap the setpoint.",
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
      { label: "No, nothing like that", next: "heat.odu" },
    ],
  },
  {
    id: "heat.odu",
    ask: "Is the outdoor unit running?",
    answers: [
      { label: "Yes, it's running", next: "heat.filters" },
      { label: "No, it's dead", next: "out:odu-no-power" },
    ],
  },
  {
    id: "heat.filters",
    ask: "Are the filters and indoor coil clean?",
    answers: [
      { label: "Dirty or blocked", next: "out:airflow-starved" },
      { label: "Clean", next: "heat.iced" },
    ],
  },
  {
    id: "heat.iced",
    ask: "Is the outdoor coil iced up and staying that way?",
    why: "A bit of frost that clears on defrost is normal. Solid ice that never clears is not.",
    answers: [
      { label: "Yes, iced solid", next: "out:defrost-fault" },
      { label: "No, it's clear", next: "heat.warm" },
    ],
  },
  {
    id: "heat.warm",
    ask: "Is the air from the indoor unit warm at all?",
    answers: [
      { label: "Warm, just not enough", next: "out:heat-capacity" },
      { label: "Cold, or room temperature", next: "out:heat-none" },
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
      { label: "Pipework or ceiling nearby", next: "out:sweating" },
    ],
  },
  {
    id: "water.drain",
    ask: "Is water running out of the drain outlet outside while it's cooling?",
    why: "Find the drain discharge point and watch it. A healthy system produces a steady trickle in humid weather.",
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
      { label: "No, gravity drain", next: "out:drain-blocked" },
    ],
  },
  {
    id: "water.ice",
    ask: "Any ice on the indoor coil?",
    why: "Ice melts in bursts between cycles and overwhelms the tray, which looks like a drain fault but isn't.",
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
    why: "Starved airflow is the most common cause of a frozen coil. Check for crushed flexible duct on a ducted system.",
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
    why: "Which LEDs, how many flashes, and the pause length. Photograph the controller — the pattern is the whole diagnosis and it's lost once you clear it.",
    answers: [
      { label: "Not yet", next: "out:record-first" },
      { label: "Yes, I've got it", next: "code.persists" },
    ],
  },
  {
    id: "code.persists",
    ask: "After one power cycle at the isolator, does the code come back?",
    why: "Isolate for a full minute, restore, and run it under load.",
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
     isn't moving gas. On three-phase that is reverse rotation until proven
     otherwise — which is why the phase question comes before anything
     mechanical, and why it carries a stop-now warning. */
  {
    id: "nop.running",
    ask: "Is the compressor actually running while you're reading that?",
    why: "Equalising is exactly what a system does at rest — leave it off a few minutes and the two gauges always meet. It's only a fault if they stay together while the compressor runs.",
    answers: [
      { label: "No, it's stopped", next: "out:equal-at-rest" },
      { label: "Yes, it's running", next: "nop.phase" },
    ],
  },
  {
    id: "nop.phase",
    ask: "Is it a three-phase unit?",
    why: "Check the data plate and the supply. It matters more here than anywhere else in this tool, because a three-phase scroll only pumps one way round.",
    answers: [
      { label: "Yes, three-phase", next: "nop.rotation" },
      { label: "No, single-phase", next: "nop.valve" },
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
    id: "nop.valve",
    ask: "Is it a heat pump, and will it change over between heating and cooling?",
    why: "A reversing valve stuck part-way sends discharge gas straight back into the suction line. The compressor runs, the current looks reasonable, and the two pressures sit on top of each other.",
    answers: [
      { label: "It won't change over, or it sticks", next: "out:reversing-valve" },
      { label: "Changes over fine, or it's cooling only", next: "out:not-pumping" },
    ],
  },
];

/* ───────────────────────────── outcomes ───────────────────────────── */

const PRESSURES = { label: "Open Running Pressures", href: "/dashboard/toolbox/running-pressures" };
const HEATLOAD = { label: "Open Heat Load", href: "/dashboard/toolbox/heat-load" };

export const OUTCOMES: Outcome[] = [
  /* shared */
  {
    id: "no-power",
    title: "No power reaching the unit",
    confidence: "likely",
    explain:
      "Nothing is responding at all, and the supply checks haven't found an obvious switch off. That points at the supply itself rather than the air conditioner.",
    actions: [
      "Confirm the outdoor isolator and the unit's breaker at the switchboard",
      "Check for a blown fuse in the isolator where one is fitted",
      "If the breaker trips again when reset, stop and treat it as an electrical fault",
      "Hand to electrical fault-finding — testing the supply is licensed work",
    ],
    escalate: true,
  },
  {
    id: "odu-no-power",
    title: "Indoor unit is alive, outdoor unit isn't",
    confidence: "likely",
    explain:
      "The indoor side has power and is asking for cooling, but the outdoor unit isn't answering. That's either its own supply, the interconnecting control wiring, or the outdoor board.",
    actions: [
      "Check the outdoor isolator is on and its fuse (if fitted) is intact",
      "Check the outdoor unit's breaker at the switchboard",
      "Look for damage to the interconnecting cable — UV, rodents, mower strike",
      "If supply is confirmed at the outdoor terminals, hand to board-level diagnosis",
    ],
    escalate: true,
  },
  {
    id: "restore-power",
    title: "Supply was switched off or tripped",
    confidence: "likely",
    explain: "Something was off or tripped. Restore it and see whether it holds.",
    actions: [
      "Switch it back on and run the system",
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
      "Clear the return grille: furniture, curtains, stored boxes",
      "Ducted: check for crushed, kinked or disconnected flexible duct",
      "Set the fan to a normal speed and retest after any ice has melted",
    ],
  },
  {
    id: "icing",
    title: "Coil is icing up",
    confidence: "likely",
    explain:
      "Ice on the coil or suction line means the evaporator is running below freezing — either it isn't getting enough air across it, or it's short of refrigerant. Airflow is the more common of the two and free to check.",
    actions: [
      "Turn it to fan only and let the ice melt fully — never chip it off",
      "Check filters, coil and fan speed first",
      "If airflow is good, measure superheat once it's thawed — high superheat with low suction points at charge",
      "A leak has to be found and repaired, not just topped up",
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
      "Clean the outdoor coil thoroughly — between the fins",
      "Confirm the fan runs at full speed and turns the right way",
      "Restore clearance: fences, plants, stored gear, anything within a few hundred mm",
      "Check discharge air isn't recirculating back into the intake",
    ],
  },
  {
    id: "go-pressures",
    title: "Time to read the gauges",
    confidence: "info",
    explain:
      "Mode, airflow and the condenser are all ruled out, so the remaining candidates are charge, the metering device or the compressor — and pressures are what separate them. Everything checkable by eye is behind you.",
    actions: [
      "Let it stabilise 10–15 minutes at a fixed demand before reading",
      "Take suction and discharge, plus line temperatures for superheat and subcooling",
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
    actions: [
      "Close doors and windows, and shade west-facing glass",
      "Remove or relocate the added heat source where you can",
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
      "Check the room's load against the unit's capacity",
      "Aim the louvres properly — cold air dumps at the outlet if pointed wrong",
      "Ducted: check zone dampers, balance and any closed-off outlets",
      "Look for leaking or disconnected duct in the roof space",
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
      "Put the setpoint several degrees below room temperature",
      "Clear any timer, schedule or eco/away limit",
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
      "Put the setpoint several degrees above room temperature",
      "Clear any timer, schedule or eco/away limit",
      "Point the louvres down — heat stratifies at the ceiling",
    ],
  },
  {
    id: "defrost-normal",
    title: "That's a normal defrost cycle",
    confidence: "info",
    explain:
      "In cold weather the outdoor coil frosts up, and the system briefly reverses to melt it. The indoor fan stops so it doesn't blow cold air, and the outdoor unit steams. It's the system working, not failing.",
    actions: [
      "Explain the cycle to the customer — it's the single most common 'fault' call in winter",
      "Normal heating resumes within about ten minutes",
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
      "Check the outdoor coil and fan are clear once thawed",
      "Confirm the drain base isn't frozen solid, holding meltwater against the coil",
      "Check charge and defrost operation — this usually needs gauges",
    ],
    tool: PRESSURES,
    escalate: true,
  },
  {
    id: "heat-capacity",
    title: "Heating, but short on capacity",
    confidence: "possible",
    explain:
      "It's producing warm air and the basics are right, so the system is working — just not keeping up. Heat pumps lose output as the outdoor temperature drops, and that's often the whole story.",
    actions: [
      "Check the outdoor temperature against the unit's rated heating capacity",
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
      "It's in heat mode, running, with clean airflow, and still blowing cold. That points at the reversing valve not shifting, or the system being short of refrigerant.",
    actions: [
      "Feel the discharge line — it should be hot within a few minutes",
      "Check the reversing valve body temperatures for internal bypass",
      "Read pressures: heating should show a low suction and a high condensing temperature",
      "Valve or charge work from here — gauges required",
    ],
    tool: PRESSURES,
    escalate: true,
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
      "Try a known-good or universal remote to confirm before ordering parts",
    ],
  },
  {
    id: "timer-holding",
    title: "A timer or schedule is holding it off",
    confidence: "likely",
    explain: "The unit is being told not to run. Nothing is broken.",
    actions: [
      "Clear the timer or weekly schedule on the controller",
      "Turn off eco, away or holiday mode",
      "Check any smart-home or BMS integration isn't overriding it",
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
      "Treat the tray to slow the biofilm coming back",
      "Confirm the drain has continuous fall and a correct trap",
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
      "Look for obvious damage — burnt tracks, swollen capacitors, water ingress, insects",
      "Board-level diagnosis and replacement from here",
    ],
    escalate: true,
  },

  /* water */
  {
    id: "sweating",
    title: "Condensation on pipework, not a drain fault",
    confidence: "likely",
    explain:
      "Water away from the unit — on pipes or the ceiling — is usually cold surfaces sweating in humid air, not the drain overflowing.",
    actions: [
      "Check the suction line insulation is continuous, sealed and not perished",
      "Re-insulate any bare pipe, especially at joints and through walls",
      "Check ceiling-space humidity and ventilation",
      "Confirm the drain itself is insulated where it runs through warm roof space",
    ],
  },
  {
    id: "drain-blocked",
    title: "Blocked condensate drain",
    confidence: "likely",
    explain:
      "The unit is producing water but it isn't leaving, so the tray fills and spills. Almost always slime and dust at the tray outlet.",
    actions: [
      "Clear the line — vacuum from the discharge end or nitrogen from the tray side",
      "Flush it through and confirm a steady flow outside",
      "Clean the tray and treat it",
      "Check the run has continuous fall, no sags, and a correct trap",
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
      "Clean the pump reservoir and float; they silt up",
      "Check the discharge line isn't blocked or kinked",
      "Confirm the pump's safety switch stops the unit on failure, so it can't flood next time",
    ],
  },
  {
    id: "tray-or-fall",
    title: "Tray, fall or trap problem",
    confidence: "possible",
    explain:
      "The drain flows and there's no ice, so the water is escaping the tray before it reaches the outlet — a crack, a bad fall, or an air-locking trap.",
    actions: [
      "Sight along the drain run for sags or uphill sections",
      "Check the trap: gurgling heads usually mean it's air-locking or dry",
      "Inspect the tray for cracks, corrosion or a displaced seal",
      "Confirm the indoor unit is level — a tilted head drains to the wrong corner",
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
      "Confirm the unit is rated for low-ambient cooling",
      "Fit head-pressure control (fan speed control or a damper) if year-round cooling is needed",
      "Meanwhile, avoid cooling in cold weather",
      "For a critical room, quote a unit designed for the duty",
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
      "High superheat with low suction points at undercharge or a restriction",
      "Check the expansion valve bulb is tight, insulated and correctly located",
      "Leak-test before adding refrigerant — never just top it up",
    ],
    tool: PRESSURES,
    escalate: true,
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
      "Look it up in that unit's service manual — codes are brand-specific",
      "Clean the condenser and check the fan first; high head causes many of these",
      "Read pressures under load to see which limit it's hitting",
    ],
    tool: PRESSURES,
    escalate: true,
  },
  {
    id: "protection-silent",
    title: "Cutting out without a code",
    confidence: "possible",
    explain:
      "Very short runs with no code still suggest a limit being hit — or a supply problem dropping the unit out.",
    actions: [
      "Measure running current against the nameplate",
      "Check supply voltage under load, including at the outdoor terminals",
      "Clean the condenser and confirm the fan runs the whole time",
      "Watch pressures through a full cycle to catch the moment it trips",
    ],
    tool: PRESSURES,
    escalate: true,
  },
  {
    id: "oversized",
    title: "Satisfying too fast — oversized or over-sensitive",
    confidence: "possible",
    explain:
      "The room hits setpoint in a couple of minutes, so the unit shuts down, the temperature drifts, and it starts again. Hard on the compressor and poor at removing humidity.",
    actions: [
      "Check the unit's capacity against the room's actual load",
      "Widen the controller deadband if it allows it",
      "Raise fan speed to spread the air and slow the pull-down",
      "Long term, correct sizing is the real fix",
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
      "Check the return sensor isn't in the supply air stream",
      "Redirect louvres so supply air doesn't short-circuit to the return",
      "Ducted: check supply and return grilles aren't too close together",
      "Switch to the wall controller's sensor if the unit supports it",
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
      "Check the outdoor unit sits square on its feet or brackets",
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
      "Replace the bearing or motor",
      "Check for water ingress that caused it, so the new one lasts",
    ],
    escalate: true,
  },
  {
    id: "gurgle-normal",
    title: "Normal refrigerant sounds",
    confidence: "info",
    explain:
      "Gurgling and hissing as it starts, stops or defrosts is refrigerant equalising between the high and low sides. Expected.",
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
      "Insulation-test the circuit and the compressor windings",
      "Licensed electrical fault-finding from here",
    ],
    escalate: true,
  },
  {
    id: "head-pressure-amps",
    title: "High head pressure pulling excess current",
    confidence: "likely",
    explain:
      "Running for a while then tripping is an overcurrent story, and a blocked condenser is the usual reason — the compressor works harder and harder until the breaker lets go.",
    actions: [
      "Clean the condenser coil properly and confirm the fan runs",
      "Restore clearance and stop discharge air recirculating",
      "Measure running amps against the nameplate once it's clean",
      "Read head pressure under load to confirm it has come back down",
    ],
    tool: PRESSURES,
    escalate: true,
  },
  {
    id: "compressor-amps",
    title: "Compressor drawing too much current",
    confidence: "possible",
    explain:
      "The condenser is clean, so the high current is coming from the compressor itself — worn, tight, or a failing start component.",
    actions: [
      "Measure running and locked-rotor current against the nameplate",
      "Check the capacitor and any start components",
      "Confirm supply voltage holds up under load — low volts raises current",
      "Three-phase: measure all three legs. A lost or unbalanced phase drives the current up on the ones that are left",
      "Compressor or component replacement from here",
    ],
    escalate: true,
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
      "Dry and reseal, then insulation-test to confirm",
      "Check any crankcase heater circuit, a common culprit",
    ],
    escalate: true,
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
      "Treat the tray and confirm the drain runs freely",
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
      "Repeat offenders may need a coil coating or UV treatment",
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
      "Photograph the controller or the indoor unit's LEDs",
      "Note which LEDs, how many flashes, and the pause length",
      "Record the model and serial from the data plate while you're there",
      "Then come back to this step",
    ],
  },
  {
    id: "code-persists",
    title: "The fault is still present",
    confidence: "likely",
    explain:
      "It survived a power cycle and returns under load, so it's a live fault rather than a one-off glitch. What it means is specific to this brand and model.",
    actions: [
      "Look the code up in that unit's service manual — codes are brand-specific",
      "Call the manufacturer's technical line with model, serial and code",
      "Don't keep power-cycling it; you'll only lose the evidence",
      "Check the obvious physical causes for that family of code first",
    ],
    escalate: true,
  },
  {
    id: "code-transient",
    title: "Cleared — treat it as a warning",
    confidence: "info",
    explain:
      "It hasn't come back, so it was likely a transient — a supply dip, a one-off protection trip, or a sensor glitch. Worth noting rather than forgetting.",
    actions: [
      "Record the code and the date in the job notes",
      "Check the obvious physical causes anyway — filters, condenser, clearance",
      "Tell the customer to note the pattern if it returns",
      "A repeating 'transient' is a real fault building up",
    ],
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
      "Check that head's expansion valve drives fully closed, and its coil sensor reads correctly",
      "Look for debris holding the valve off its seat — the clearances are fine",
      "The fix is at that branch, not at the outdoor unit",
    ],
    escalate: true,
  },
  {
    id: "mode-conflict",
    title: "Mode conflict — it can only do one at a time",
    confidence: "likely",
    explain:
      "A two-pipe multi or VRF shares one refrigerant circuit, so the whole system heats or cools together. Whichever head calls first — or a designated master controller — sets the mode, and the rest wait, drop to fan only, or show a standby indication. Nothing is broken.",
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
      "Check the valve coils energise when the mode is called",
      "Feel the pipes into and out of that port through a changeover",
      "Branch controller work needs the service manual for that system",
    ],
    escalate: true,
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
      "Follow the daisy-chain: if everything downstream is out too, the break is upstream of them all",
      "Confirm the shield is earthed at one end only, and the line isn't run alongside power cable",
    ],
    escalate: true,
  },
  {
    id: "vrf-branch",
    title: "Refrigerant isn't reaching that head",
    confidence: "likely",
    explain:
      "The head runs and asks for it, but its pipes stay at room temperature — so the problem is upstream, in the expansion valve or the branch serving that circuit. The rest of the system being fine is exactly what tells you it's local.",
    actions: [
      "Check the expansion valve for that circuit drives open when the head calls",
      "At a branch box, confirm the port was connected to the head it was meant for — crossed ports are a common commissioning error",
      "Check that head's coil and gas-line sensors; a misread sensor closes the valve on purpose",
      "Confirm the service valves for that branch are fully open",
    ],
    escalate: true,
  },
  {
    id: "vrf-head-airside",
    title: "Refrigerant is arriving — treat this head on its own",
    confidence: "likely",
    explain:
      "Its pipes get cold or hot, so the outdoor unit, the branch and the comms are all doing their job for this circuit. Whatever's wrong is inside this head, and from here it diagnoses exactly like a single split.",
    actions: [
      "Check that head's filters, coil face and fan speed",
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
      "Trace the transmission pairs back to the outdoor unit or branch controller and re-land them to match",
      "Where addressing is set on the indoor boards, correct the switches or settings instead of re-pulling cable",
      "Re-test every head one at a time before you leave — crossings almost always come in pairs",
      "Label both ends while you're in there, so the next visit isn't this visit",
    ],
  },
  {
    id: "vrf-crossed-pipes",
    title: "Pipework crossed at the branch",
    confidence: "likely",
    explain:
      "The right head answers its own controller, so the comms are correct — but the refrigerant reaching it belongs to a different port. The outdoor unit opens the valve for the head it believes is calling, and the gas turns up somewhere else. That's exactly why it only performs when another room calls.",
    actions: [
      "Confirm it: call one head on its own and feel which head's pipes go cold",
      "Trace each liquid and gas pair from the branch box back to the head it actually serves",
      "Re-pipe to match the ports, or re-land the comms to match the pipes — whichever is the smaller job",
      "Every sensor reading has been meaningless until this is fixed, so re-check operation on all heads afterwards",
      "Re-piping means recovery, braze and recharge — plan the visit for it",
    ],
    escalate: true,
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
      "Check the solenoid coil energises, and separate coil from valve by calling a changeover with the coil off",
      "Tap the body gently while calling a changeover; a valve held on debris will sometimes shift",
      "A valve that won't seat needs replacing — recovery, braze and recharge",
    ],
    tool: PRESSURES,
    escalate: true,
  },
  {
    id: "not-pumping",
    title: "Compressor isn't pumping",
    confidence: "likely",
    explain:
      "It runs, the rotation is right and the reversing valve isn't bypassing, so the compressor itself has stopped moving refrigerant — worn scrolls, broken internals, or a failed internal discharge valve. Current usually reads low rather than high, because it isn't doing any work.",
    actions: [
      "Measure running current — well under the nameplate figure supports this",
      "Confirm the service valves are fully open before condemning anything",
      "Check for a failed internal discharge check valve, and for a compressor terminal fault",
      "Compressor replacement from here — find out what killed it before fitting the new one",
    ],
    tool: PRESSURES,
    escalate: true,
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
      "Compare the unbalance against the relay's setting before deciding the relay is faulty",
      "Supply testing and correction is licensed electrical work",
    ],
    escalate: true,
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
