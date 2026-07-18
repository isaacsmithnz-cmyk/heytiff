/* Fault Finder — symptom → ordered causes data for the Toolbox diagnostic
   tool. Pure data, no React (lib discipline).

   Content is GENERIC split/ducted field knowledge: mode settings, airflow,
   drains, charge symptoms, protection trips. Deliberately NO manufacturer
   fault-code tables — codes vary per brand/model and universal-table data
   only enters HeyTiff through uploaded documents; the error-code symptom
   points at the service manual / helpline instead. */

export type Likelihood = "common" | "possible" | "rare";

export interface Cause {
  /** short cause name */
  title: string;
  likelihood: Likelihood;
  /** what to look at / measure */
  check: string;
  /** what fixes it when confirmed */
  fix: string;
  /** true = licensed / specialist work beyond a routine visit */
  escalate?: boolean;
}

export interface Symptom {
  key: string;
  label: string;
  icon: string; // shell icon.tsx name
  blurb: string;
  /** red banner shown above the causes when present */
  safety?: string;
  causes: Cause[];
}

export const SYMPTOMS: Symptom[] = [
  {
    key: "no-cool",
    label: "Not cooling / poor cooling",
    icon: "thermo",
    blurb: "Runs but the room stays warm",
    causes: [
      {
        title: "Wrong mode or setpoint",
        likelihood: "common",
        check: "Remote set to COOL (not fan/dry/auto), setpoint below room temperature, no schedule or eco limit active.",
        fix: "Correct the settings and demonstrate to the customer.",
      },
      {
        title: "Dirty filters or blocked return air",
        likelihood: "common",
        check: "Pull the filters and sight the indoor coil face. Check the return grille isn't blocked by furniture or curtains.",
        fix: "Clean filters and coil face; set a cleaning interval with the customer.",
      },
      {
        title: "Outdoor unit starved or not running",
        likelihood: "common",
        check: "Is the ODU fan turning? Clearance around the coil, condenser fins clean, discharge air noticeably warm.",
        fix: "Clear obstructions, clean the condenser coil, restore clearances.",
      },
      {
        title: "Low refrigerant charge / leak",
        likelihood: "possible",
        check: "Frost or ice on the suction line, low suction pressure with high superheat (see Running Pressures), oil staining at flares and joints.",
        fix: "Leak search, repair, pressure test, evacuate and re-charge to nameplate by weight.",
        escalate: true,
      },
      {
        title: "Undersized for the load",
        likelihood: "possible",
        check: "Doors/windows open, added heat sources, west glass. Sanity-check the room against the Heat Load calculator.",
        fix: "Manage the load or quote a correctly sized unit.",
      },
      {
        title: "Compressor or valve not pumping",
        likelihood: "rare",
        check: "Compressor 'runs' but high and low pressures stay nearly equal; little or no temperature split across the coils.",
        fix: "Mechanical diagnosis — valves, inverter drive or compressor swap.",
        escalate: true,
      },
    ],
  },
  {
    key: "no-heat",
    label: "Not heating / poor heating",
    icon: "flame",
    blurb: "Heat mode but little warm air",
    causes: [
      {
        title: "Wrong mode or setpoint",
        likelihood: "common",
        check: "Remote on HEAT, setpoint above room temperature, louvres aimed down (heat stratifies at the ceiling).",
        fix: "Correct settings; angle vanes toward the floor.",
      },
      {
        title: "Defrost cycle mistaken for a fault",
        likelihood: "common",
        check: "Indoor fan pauses, outdoor unit steams for a few minutes in cold weather — that's a normal defrost.",
        fix: "None needed. Explain the cycle; airflow resumes within ~10 minutes.",
      },
      {
        title: "Dirty filters or iced outdoor coil",
        likelihood: "common",
        check: "Filters as for cooling. Outdoor coil fully iced over and never clearing means defrost isn't keeping up.",
        fix: "Clean filters. If the ODU stays iced, investigate charge and defrost operation.",
      },
      {
        title: "Low refrigerant charge",
        likelihood: "possible",
        check: "Weak discharge air temperature, low pressures both sides, poor indoor ΔT. Compare against Running Pressures heating windows.",
        fix: "Leak search, repair and re-charge by weight.",
        escalate: true,
      },
      {
        title: "Reversing valve stuck in cooling",
        likelihood: "rare",
        check: "Unit blows cold on HEAT even after several minutes and no defrost is active.",
        fix: "Reversing valve diagnosis / replacement.",
        escalate: true,
      },
    ],
  },
  {
    key: "wont-start",
    label: "Won't turn on",
    icon: "power",
    blurb: "Dead — nothing responds",
    causes: [
      {
        title: "No power to the unit",
        likelihood: "common",
        check: "Outdoor isolator ON, switchboard breaker not tripped, isolator fuse intact (where fitted).",
        fix: "Restore power. If the breaker was tripped, see the 'Breaker trips' symptom before resetting twice.",
      },
      {
        title: "Remote batteries or receiver",
        likelihood: "common",
        check: "Fresh batteries; does the indoor unit beep on a command? Try the unit's manual ON button under the front panel.",
        fix: "Replace batteries; if the manual button works, suspect remote or receiver.",
      },
      {
        title: "Timer / schedule holding it off",
        likelihood: "common",
        check: "Timer icon on the display or wall controller, weekly schedule, or a smart-home integration overriding it.",
        fix: "Clear the timer/schedule and retest.",
      },
      {
        title: "Condensate safety switch tripped",
        likelihood: "possible",
        check: "Ducted/cassette: float switch in a full safe tray blocks starting. Look for a wet tray or blocked drain.",
        fix: "Clear the drain, dry the tray, reset the float.",
      },
      {
        title: "Control board / transformer fault",
        likelihood: "rare",
        check: "Power confirmed at the terminals but no display, no beep, no relay clicks.",
        fix: "Board-level diagnosis.",
        escalate: true,
      },
    ],
  },
  {
    key: "water-leak",
    label: "Water leaking indoors",
    icon: "droplet",
    blurb: "Drips from the head or grille",
    causes: [
      {
        title: "Blocked condensate drain",
        likelihood: "common",
        check: "Slow or no discharge at the drain outlet while cooling; slime/dirt at the tray outlet.",
        fix: "Clear the line (vacuum or nitrogen from the tray side), flush, and treat the tray.",
      },
      {
        title: "Condensate pump failure",
        likelihood: "possible",
        check: "Ducted/cassette with a pump: is it humming/cycling? Lift the float — pump should run.",
        fix: "Clean or replace the pump; verify the float switch stops the unit on failure.",
      },
      {
        title: "Iced coil melting between cycles",
        likelihood: "possible",
        check: "Water arrives in bursts after long run times; see the 'Ice on pipes or coil' symptom.",
        fix: "Fix the icing cause — airflow or charge.",
      },
      {
        title: "Poor drain fall or missing trap",
        likelihood: "possible",
        check: "Sight the drain run: sags, uphill sections, or an air-locked trap (gurgling heads).",
        fix: "Re-grade the drain with continuous fall; fit/correct the trap per the install manual.",
      },
      {
        title: "Cracked or corroded drain tray",
        likelihood: "rare",
        check: "Leak persists with a clear drain; water tracks from the tray body, not the outlet.",
        fix: "Replace the tray.",
        escalate: true,
      },
    ],
  },
  {
    key: "icing",
    label: "Ice on pipes or coil",
    icon: "snowflake",
    blurb: "Frost on the suction line or indoor coil",
    safety:
      "Never chip ice off a coil — fins and tubes damage easily. Melt it with the unit off or fan-only.",
    causes: [
      {
        title: "Airflow starvation",
        likelihood: "common",
        check: "Filthy filters, blocked coil, crushed flexible duct, indoor fan on lowest speed in a hot room.",
        fix: "Clean filters/coil, restore airflow, retest after the ice melts.",
      },
      {
        title: "Low refrigerant charge",
        likelihood: "common",
        check: "After the ice clears: low suction pressure with HIGH superheat (use Running Pressures). Ice usually starts at the coil inlet / suction line.",
        fix: "Leak search, repair, re-charge by weight.",
        escalate: true,
      },
      {
        title: "Cooling at low outdoor ambient",
        likelihood: "possible",
        check: "Server rooms / cool nights: cooling below ~15°C outdoor without low-ambient (head pressure) control ices coils.",
        fix: "Fit low-ambient control or adjust operation.",
      },
      {
        title: "Expansion valve (TXV/EEV) fault",
        likelihood: "rare",
        check: "Airflow and charge verified good but the coil still runs starved (low suction, high superheat).",
        fix: "Valve diagnosis / replacement.",
        escalate: true,
      },
    ],
  },
  {
    key: "short-cycle",
    label: "Short cycling",
    icon: "rotate",
    blurb: "Starts and stops every few minutes",
    causes: [
      {
        title: "Sensor reading supply air",
        likelihood: "common",
        check: "Return sensor placed where conditioned air washes over it (short-circuiting airflow, sensor near the outlet).",
        fix: "Redirect louvres, relocate the sensor/controller, or switch to the wall controller's sensor.",
      },
      {
        title: "Oversized unit",
        likelihood: "common",
        check: "Room reaches setpoint in a couple of minutes then overshoots. Compare capacity to the Heat Load calculator result.",
        fix: "Raise fan/airflow distribution, widen deadband if the controller allows; long-term, correct sizing.",
      },
      {
        title: "Return air short-circuit (ducted)",
        likelihood: "possible",
        check: "Supply and return too close, or door undercuts starving the return path.",
        fix: "Fix the air path — relocate grilles or restore return paths.",
      },
      {
        title: "Protection trips cutting runs short",
        likelihood: "possible",
        check: "Unit stops with a blink pattern / error before restart. High head (dirty condenser) and low charge both trip protection.",
        fix: "Diagnose the specific protection event; clean coils, check charge.",
        escalate: true,
      },
    ],
  },
  {
    key: "noisy",
    label: "Noisy operation",
    icon: "volume",
    blurb: "Rattles, squeals, gurgles",
    causes: [
      {
        title: "Loose panels or screws",
        likelihood: "common",
        check: "Press on panels while it runs — does the rattle stop? Check grille clips and cover screws on both units.",
        fix: "Tighten/seat panels, refit clips.",
      },
      {
        title: "Fan fouling or debris",
        likelihood: "common",
        check: "Ticking in time with fan speed: leaves/debris in the ODU, dirt clumps on the indoor barrel fan.",
        fix: "Remove debris, clean the fan; check blade damage.",
      },
      {
        title: "Refrigerant gurgle",
        likelihood: "possible",
        check: "Soft gurgle/whoosh at start, stop and defrost is normal. Loud continuous gurgling at the head can mean charge/flow issues.",
        fix: "If continuous, investigate charge and flow (Running Pressures).",
      },
      {
        title: "Worn fan bearing or motor",
        likelihood: "possible",
        check: "Squeal or grind that scales with fan speed; play in the shaft with power isolated.",
        fix: "Replace the bearing/motor.",
        escalate: true,
      },
      {
        title: "Compressor mounts / plastic creak",
        likelihood: "rare",
        check: "Thump at start/stop = mounts. Creaks as panels warm/cool = thermal expansion — usually harmless.",
        fix: "Renew mounts if perished; creaks generally need no action.",
      },
    ],
  },
  {
    key: "smell",
    label: "Bad smell",
    icon: "cloud",
    blurb: "Musty, sour or burning odours",
    safety:
      "Electrical burning smell: isolate the unit at the switchboard and do not re-energise until inspected.",
    causes: [
      {
        title: "Mould in the coil / drain tray",
        likelihood: "common",
        check: "Musty smell strongest at start-up; visible growth on the coil face, barrel fan or tray.",
        fix: "Deep-clean coil, fan and tray; treat; advise running FAN after cooling to dry the coil.",
      },
      {
        title: "'Dirty sock' biofilm",
        likelihood: "common",
        check: "Sour-sock smell mainly when heating starts — bacterial film on the coil.",
        fix: "Coil clean and sanitise; repeat offenders may need a coil coating or UV treatment.",
      },
      {
        title: "Dust burn-off at season start",
        likelihood: "possible",
        check: "First heating run of the year, faint dusty-burn smell fading within the hour.",
        fix: "Normal if it clears quickly. Persistent or acrid = isolate and inspect.",
      },
      {
        title: "Drains or pests",
        likelihood: "possible",
        check: "Sewer smell = dry/failed drain trap pulling in air. Decay smell = pest in the duct/ceiling.",
        fix: "Restore the trap seal; locate and remove pests, sanitise duct.",
      },
    ],
  },
  {
    key: "breaker",
    label: "Trips the breaker",
    icon: "zap",
    blurb: "RCD or MCB drops when it runs",
    safety:
      "Repeated tripping is an electrical fault protecting the circuit. Don't hold or repeatedly reset the breaker — electrical fault-finding is licensed work.",
    causes: [
      {
        title: "Trips instantly on start",
        likelihood: "common",
        check: "Hard short or earth fault — compressor windings, damaged cable, water in a junction.",
        fix: "Isolate and hand to electrical fault-finding (megger the circuit and compressor).",
        escalate: true,
      },
      {
        title: "Trips after minutes under load",
        likelihood: "possible",
        check: "Overcurrent: seized/locked compressor, dirty condenser driving head pressure up, or an undersized/aged breaker.",
        fix: "Clean the condenser and verify pressures; measure running amps vs nameplate before condemning parts.",
        escalate: true,
      },
      {
        title: "RCD nuisance trips in wet weather",
        likelihood: "possible",
        check: "Moisture in the ODU terminal box, heater crankcase leakage, perished cable glands.",
        fix: "Dry and reseal terminations; insulation-test to confirm.",
        escalate: true,
      },
    ],
  },
  {
    key: "error-light",
    label: "Error light / code flashing",
    icon: "alert",
    blurb: "Blinking LEDs or a code on the controller",
    causes: [
      {
        title: "Read the pattern before clearing it",
        likelihood: "common",
        check: "Note the exact code or count the blink pattern (which LEDs, how many flashes, pause length). Photograph the controller.",
        fix: "Codes are brand- and model-specific — look the pattern up in that unit's service manual before anything else.",
      },
      {
        title: "One controlled power cycle",
        likelihood: "common",
        check: "Isolate at the outdoor isolator for 60 seconds, restore, and watch whether the code returns under load.",
        fix: "If it returns, stop power-cycling — record the code and diagnose properly.",
      },
      {
        title: "Code persists",
        likelihood: "possible",
        check: "With the code recorded and the fault reproducible.",
        fix: "Follow the service-manual diagnosis for that code, or call the manufacturer technical helpline with model + serial + code.",
        escalate: true,
      },
    ],
  },
];

/** Symptom lookup by key. */
export function findSymptom(key: string): Symptom | undefined {
  return SYMPTOMS.find((s) => s.key === key);
}

export const LIKELIHOOD_LABELS: Record<Likelihood, string> = {
  common: "Common",
  possible: "Possible",
  rare: "Rare",
};

/** Sort weight — data should already be ordered, but the UI enforces it. */
export const LIKELIHOOD_ORDER: Record<Likelihood, number> = {
  common: 0,
  possible: 1,
  rare: 2,
};
