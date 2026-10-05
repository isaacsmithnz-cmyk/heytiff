/* THE SITE CHECKLIST — what Tiff, as supervisor, has to know before a
   proposal can go out.

   Read against the ten sample jobs (2026-09-29), the real proposals left the
   same things vague again and again: the drain went "to a suitable point",
   the unit went on the wall "as discussed", grilles and return air were
   "TBC", the trunking colour was noted after the quote went. So the topics
   are FIXED here, each with its question and its usual answers, and the
   writer only says which apply, what it already knows, and which it has to
   ask. Two drafts of two jobs ask the same question the same way.

   An answer is kept on the draft as it is given (no model call); the next
   change folds the answers into the scope. */

export type ChecklistGroup =
  | "Unit"
  | "Indoor unit"
  | "Outdoor unit"
  | "Pipework"
  | "Drain"
  | "Power"
  | "Grilles and ducting"
  | "Access"
  | "The job";

export type ChecklistTopic = {
  group: ChecklistGroup;
  label: string;
  question: string;
  /** The usual answers, offered as one-press choices. Anything else is typed. */
  choices: readonly string[];
};

export const CHECKLIST = {
  model: { group: "Unit", label: "Model", question: "Which model and size?", choices: [] },
  indoor_type: {
    group: "Indoor unit",
    label: "Type",
    question: "What kind of indoor unit?",
    choices: ["High wall", "Ducted", "Cassette", "Floor console", "Bulkhead"],
  },
  indoor_position: { group: "Indoor unit", label: "Where", question: "Which wall or ceiling, exactly?", choices: [] },
  outdoor_location: {
    group: "Outdoor unit",
    label: "Where and how",
    question: "Where does the outdoor unit go, and on what?",
    choices: ["Wall brackets", "Ground pad", "Balcony", "Roof", "Under the house"],
  },
  pipe_route: { group: "Pipework", label: "Route", question: "Which way do the pipes run?", choices: [] },
  pipe_covering: {
    group: "Pipework",
    label: "Covering outside",
    question: "What covers the pipes where they're seen?",
    choices: ["Colorbond trunking", "Smart duct", "Hidden in the wall"],
  },
  pipe_colour: {
    group: "Pipework",
    label: "Covering colour",
    question: "What colour is the covering?",
    choices: ["Surfmist", "Paperbark", "Monument", "Woodland Grey", "White", "Match the wall"],
  },
  pipe_length: { group: "Pipework", label: "Length", question: "About how many metres of pipe?", choices: [] },
  pipe_reuse: {
    group: "Pipework",
    label: "Existing pipes",
    question: "Reuse the existing pipes?",
    choices: ["Reuse if they pass a pressure test", "New pipes"],
  },
  drain_to: {
    group: "Drain",
    label: "Where to",
    question: "Where does the drain go?",
    choices: ["Downpipe", "Garden or ground", "Tundish"],
  },
  drain_fall: {
    group: "Drain",
    label: "Fall",
    question: "Does it fall on gravity, or need a pump?",
    choices: ["Gravity", "Condensate pump"],
  },
  power_supply: {
    group: "Power",
    label: "Supply",
    question: "New circuit from the switchboard, or an existing one?",
    choices: ["New circuit", "Existing circuit"],
  },
  power_board: {
    group: "Power",
    label: "Switchboard",
    question: "Is there room for a new circuit, and how far is the board?",
    choices: [],
  },
  power_phase: { group: "Power", label: "Phase", question: "Single or three phase?", choices: ["Single phase", "Three phase"] },
  grille_supply: {
    group: "Grilles and ducting",
    label: "Supply grilles",
    question: "What supply grilles?",
    choices: ["Linear bar", "Frameless linear", "Square ceiling", "Round ceiling", "Floor"],
  },
  grille_finish: {
    group: "Grilles and ducting",
    label: "Grille finish",
    question: "What finish on the grilles?",
    choices: ["White, standard", "Powder coated to suit", "Anodised aluminium", "Custom made"],
  },
  return_air: {
    group: "Grilles and ducting",
    label: "Return air",
    question: "Where does the return air go, and in what style?",
    choices: [],
  },
  ductwork: {
    group: "Grilles and ducting",
    label: "Ductwork",
    question: "New ductwork, or connect to the existing?",
    choices: ["New", "Existing", "Some of each"],
  },
  zones: {
    group: "Grilles and ducting",
    label: "Zones and controller",
    question: "How many zones, and which controller?",
    choices: [],
  },
  height: {
    group: "Access",
    label: "Height safety",
    question: "What does the height need?",
    choices: ["Ladder", "Edge protection", "Scaffold", "EWP"],
  },
  ceiling: {
    group: "Access",
    label: "Ceiling and roof space",
    question: "Can we get into the ceiling or roof space, or does it need opening?",
    choices: ["Access is fine", "Needs a hatch", "Ceiling needs opening"],
  },
  make_good: {
    group: "Access",
    label: "Making good",
    question: "Gyprock and painting: excluded, ours, or someone else's?",
    choices: ["Excluded", "Ours, priced", "By others"],
  },
  job_kind: { group: "The job", label: "Home or business", question: "Is this a home or a business?", choices: ["Home", "Business"] },
  approval: {
    group: "The job",
    label: "Strata or committee",
    question: "Does it need strata or committee approval?",
    choices: ["Not needed", "Strata approval", "Committee approval"],
  },
  old_system: { group: "The job", label: "Old system", question: "Is there an old system to remove?", choices: ["None", "Remove and dispose"] },
  labour: { group: "The job", label: "People and time", question: "How many people, and how long?", choices: [] },
} as const satisfies Record<string, ChecklistTopic>;

export type ChecklistKey = keyof typeof CHECKLIST;
export const CHECKLIST_KEYS = Object.keys(CHECKLIST) as ChecklistKey[];

export const GROUP_ORDER: readonly ChecklistGroup[] = [
  "Unit",
  "Indoor unit",
  "Outdoor unit",
  "Pipework",
  "Drain",
  "Power",
  "Grilles and ducting",
  "Access",
  "The job",
];

export type CheckState = "known" | "ask" | "na";

export type CheckItem = {
  key: ChecklistKey;
  state: CheckState;
  /** What is known, in a few words. Empty when it has to be asked. */
  answer: string;
  /** An ask only: the question as Tiff writes it for THIS job — the rooms,
      units or levels it's about, and what the answer changes (Isaac's 2905,
      2026-10-05: "questions are very vague, hard to understand"). Empty on
      an old draft, which then shows the topic's own question. */
  question?: string;
  /** An ask only: two to four short answers to tap. */
  choices?: string[];
  /** An ask only: 1 is the one that changes the price or the install most. */
  rank?: number;
  /** Set when a person answered it on the card, and the scope hasn't been
      rewritten with it yet. */
  fresh?: boolean;
};

/** The checklist in the catalogue's order, so every draft reads the same. */
export function orderChecklist(items: readonly CheckItem[]): CheckItem[] {
  return CHECKLIST_KEYS.map((k) => items.find((i) => i.key === k)).filter((i): i is CheckItem => !!i);
}

/** The asks, the one that matters most first: by Tiff's rank, then the
    catalogue's order. */
export function asksByImpact(items: readonly CheckItem[]): CheckItem[] {
  const at = (i: CheckItem) => CHECKLIST_KEYS.indexOf(i.key);
  return items
    .filter((i) => i.state === "ask")
    .sort((a, b) => (a.rank ?? 100 + at(a)) - (b.rank ?? 100 + at(b)) || at(a) - at(b));
}

/** The most questions a fresh draft asks: the ones that change the price,
    the scope or the install, and no more (Isaac's 2905: 17 of them). */
export const MAX_ASKS = 8;

/** Tiff's asks cut to the ones that matter most. Only ever on Tiff's fresh
    reply, after a person's settled answers are back in place: never on a
    read or a person's save, so an older draft keeps every question. */
export function capAsks(items: readonly CheckItem[]): CheckItem[] {
  const keep = new Set(asksByImpact(items).slice(0, MAX_ASKS).map((i) => i.key));
  return items.filter((i) => i.state !== "ask" || keep.has(i.key));
}

export function checklistCounts(items: readonly CheckItem[]) {
  return {
    known: items.filter((i) => i.state === "known").length,
    ask: items.filter((i) => i.state === "ask").length,
  };
}

/** The checklist after Tiff rewrites a draft: Tiff's topics, but nothing a
    person settled is lost. A topic that was known (or marked not needed)
    stays that way when Tiff drops it or turns it back into an ask; its
    answer is in the scope now, so it is no longer fresh. */
export function keepSettled(before: readonly CheckItem[], after: readonly CheckItem[]): CheckItem[] {
  /* a settled topic keeps the question it was asked with, for its Change */
  const settled = new Map(
    before
      .filter((i) => i.state !== "ask")
      .map((i) => [i.key, { key: i.key, state: i.state, answer: i.answer, ...(i.question ? { question: i.question, choices: i.choices ?? [] } : {}) }] as const)
  );
  const kept = after.map((i) => (i.state === "ask" && settled.has(i.key) ? settled.get(i.key)! : i));
  const dropped = [...settled.values()].filter((s) => !after.some((i) => i.key === s.key));
  return orderChecklist([...kept, ...dropped]);
}
