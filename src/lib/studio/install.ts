/* Design Studio — the install questions and the equipment list (the "Zones
   and systems" flow, its Install section).

   After a system's units are on the plan, a short run of questions asks how
   the system goes in, and every answer puts its parts on the system's
   equipment list as it is given. The questions ask only what the plan and the
   pack cannot answer: the plan says where each unit is, the pack sizes the
   isolator and names the joint pipe a port needs, the drawn runs say whether
   the copper is coil or hard drawn. What is left is the house's walls, where
   the outdoor sits and what it stands on, whether its water is piped away,
   who supplies the isolator, how the heads are controlled and how they drain.

   Every question takes more than one answer. Where only one can happen in the
   end (the question is EXCLUSIVE), two ticks mean make provisions for both:
   every ticked option's parts go on the list flagged for the day, and the
   list carries a note for the installer. Where both can happen (the
   controls), two ticks mean both are fitted. An option can ask a follow-up,
   which is only asked while the option is ticked and inherits the flag.

   The house's answers are asked once and kept on the design
   (`doc.settings.install`); a system's are kept on the system
   (`sys.settings.install`). Both are question id → the option ids ticked.
   Nothing waits on an answer: an unanswered question is a waiting row on the
   list, never a block on Done.

   The parts the pack has (a drain socket, a wired controller and its
   interface, a Wi-Fi adapter, a drain pump kit, a joint pipe) are read off
   its accessories by model compatibility. The rest (brackets, feet, pads,
   frames, fixings, a third-party pump) come from a small catalogue here, to
   be replaced by what the customer stocks; the isolator comes from the
   Components catalogue, sized by the pack. */

import type { DesignDocument, DesignSystem } from "./document";
import type { Accessory, DataPack, IndoorUnit, OutdoorUnit } from "./packs/schema";
import { allocationsOf, type Allocation } from "./allocations";
import {
  COMPONENT_CHOICES,
  componentChoices,
  defaultIsolatorId,
  hardDrawnLengthM,
  type ComponentChoiceOption,
} from "./components";
import { buildSystemGraph, totalPipeLengthM } from "./graph";

/* ─────────────────────────── shapes ─────────────────────────── */

export type InstallScope = "house" | "system";

export type InstallGroup = "The house" | "Outdoor" | "Indoor units";

export interface InstallOption {
  id: string;
  label: string;
  /** a second line under the label: what the pack found for it, or what
      comes with the unit */
  sub?: string;
  /** asked only while this option is ticked */
  followUps?: InstallQuestion[];
}

export interface InstallQuestion {
  id: string;
  scope: InstallScope;
  group: InstallGroup;
  text: string;
  /** only one option can happen in the end: two ticks mean provisions for
      both, flagged for the day */
  exclusive: boolean;
  /** what the plan or the pack already knows, shown beside the question */
  hint?: string;
  options: InstallOption[];
}

export type EquipmentGroup = "Units" | "Mounting" | "Controls" | "Electrical" | "Pipework";

export interface EquipmentRow {
  group: EquipmentGroup;
  name: string;
  /** the pack's model, when the row is a unit or one of the pack's accessories */
  model?: string;
  qty?: number;
  /** the figure shown in place of a bare count: "1 set", "12.4 m", "Not drawn" */
  value?: string;
  /** where the row came from, when its name does not say */
  why?: string;
  /** a provision: fitted only if the day decides that way */
  onTheDay?: boolean;
  /** stands in for a question with no answer yet */
  waiting?: boolean;
}

export interface EquipmentList {
  /** in group order: Units, Mounting, Controls, Electrical, Pipework */
  rows: EquipmentRow[];
  /** the installer's notes, one per question answered two ways */
  notes: string[];
  /** questions with a tick, of those asked (follow-ups count once asked) */
  answered: number;
  total: number;
  /** rows flagged onTheDay */
  onTheDay: number;
  complete: boolean;
}

export type InstallState = "not-asked" | "open" | "complete";

/* ─────────────────────────── the catalogue ───────────────────────────
   Placeholders until the customer lists what they stock: one small const
   each, easy to replace. Nothing here is sized; the pack sizes what it can. */

interface CatalogueLine {
  name: string;
  qty: number;
  value?: string;
}

/** head fixings by the inside wall they go into, one set per indoor unit */
const HEAD_FIXINGS: Record<string, string> = {
  "plasterboard-timber": "Head fixings, timber stud",
  "plasterboard-steel": "Head fixings, steel stud",
  brick: "Head fixings, masonry",
};

const THIRD_PARTY_PUMP = "Condensate pump, third party";

/** the interfaces a wired controller needs on some heads, by model; the
    pack's compatibility says which heads */
const WIRED_INTERFACES = ["MAC-334IF-E"];

/* ─────────────────────────── the questions ─────────────────────────── */

interface OptionSpec {
  id: string;
  label: string;
  sub?: string;
  /** how the on-the-day note names this option; the label, lowercased,
      when absent */
  fragment?: string;
  /** catalogue parts, all under Mounting */
  parts?: CatalogueLine[];
  followUps?: QuestionSpec[];
}

interface QuestionSpec {
  id: string;
  scope: InstallScope;
  group: InstallGroup;
  text: string;
  exclusive: boolean;
  /** the note's opening, after "Confirm on the day"; the ticked options
      follow it when `listOptions` is set */
  confirm?: string;
  listOptions?: boolean;
  /** the waiting row an unanswered question shows */
  decides: { group: EquipmentGroup; name: string };
  options: OptionSpec[];
}

const HOUSE: QuestionSpec[] = [
  {
    id: "outside-walls",
    scope: "house",
    group: "The house",
    text: "What are the outside walls?",
    exclusive: false,
    decides: { group: "Mounting", name: "Outside walls" },
    options: [
      { id: "brick-veneer", label: "Brick veneer" },
      { id: "double-brick", label: "Double brick" },
      { id: "timber", label: "Timber" },
      { id: "blockwork", label: "Blockwork" },
    ],
  },
  {
    id: "inside-walls",
    scope: "house",
    group: "The house",
    text: "What are the inside walls?",
    exclusive: false,
    decides: { group: "Mounting", name: "Head fixings" },
    options: [
      { id: "plasterboard-timber", label: "Plasterboard on timber" },
      { id: "plasterboard-steel", label: "Plasterboard on steel" },
      { id: "brick", label: "Brick" },
    ],
  },
];

const OUTDOOR: QuestionSpec[] = [
  {
    id: "outdoor-sits",
    scope: "system",
    group: "Outdoor",
    text: "Where does it sit?",
    exclusive: true,
    confirm: "whether the outdoor goes",
    listOptions: true,
    decides: { group: "Mounting", name: "Outdoor base" },
    options: [
      {
        id: "ground",
        label: "On the ground",
        followUps: [
          {
            id: "ground-base",
            scope: "system",
            group: "Outdoor",
            text: "What does it stand on?",
            exclusive: true,
            confirm: "whether the outdoor stands on",
            listOptions: true,
            decides: { group: "Mounting", name: "Ground base" },
            options: [
              {
                id: "rubber-feet",
                label: "Rubber isolation feet",
                parts: [{ name: "Rubber isolation feet", qty: 1, value: "1 set" }],
              },
              {
                id: "ground-pad",
                label: "Ground pad",
                sub: "Composite, anti-vib feet",
                fragment: "a ground pad",
                parts: [{ name: "Ground pad", qty: 1 }],
              },
            ],
          },
        ],
      },
      {
        id: "wall",
        label: "On a wall",
        followUps: [
          {
            id: "wall-bracket",
            scope: "system",
            group: "Outdoor",
            text: "Which wall bracket?",
            exclusive: true,
            confirm: "whether the outdoor takes the",
            listOptions: true,
            decides: { group: "Mounting", name: "Wall bracket" },
            options: [
              {
                id: "wall-bracket",
                label: "Wall bracket",
                sub: "Galv. steel, anti-vib feet",
                parts: [{ name: "Wall bracket", qty: 1, value: "1 set" }],
              },
              {
                id: "heavy-bracket",
                label: "Heavy-duty bracket",
                sub: "Galv. steel",
                parts: [{ name: "Heavy-duty bracket", qty: 1, value: "1 set" }],
              },
            ],
          },
        ],
      },
      {
        id: "roof",
        label: "On the roof",
        followUps: [
          {
            id: "roof-frame",
            scope: "system",
            group: "Outdoor",
            text: "Which roof frame?",
            exclusive: true,
            confirm: "which roof frame goes on",
            decides: { group: "Mounting", name: "Roof frame" },
            options: [
              {
                id: "roof-frame",
                label: "Roof frame",
                sub: "Galv. steel, spring feet",
                parts: [{ name: "Roof frame", qty: 1, value: "1 set" }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "outdoor-drain",
    scope: "system",
    group: "Outdoor",
    text: "Does its water need piping away?",
    exclusive: true,
    confirm: "whether its water needs piping away",
    decides: { group: "Mounting", name: "Outdoor drain" },
    options: [
      { id: "no", label: "No" },
      { id: "yes", label: "Yes" },
    ],
  },
  {
    id: "isolator-supply",
    scope: "system",
    group: "Outdoor",
    text: "Who supplies the isolator?",
    exclusive: true,
    confirm: "who supplies the isolator",
    decides: { group: "Electrical", name: "Isolator" },
    options: [
      { id: "we-do", label: "We do" },
      { id: "electrician", label: "The electrician" },
    ],
  },
];

const INDOOR: QuestionSpec[] = [
  {
    id: "controls",
    scope: "system",
    group: "Indoor units",
    text: "How are they controlled?",
    exclusive: false,
    decides: { group: "Controls", name: "Controls" },
    options: [
      { id: "wireless", label: "Wireless remote", sub: "Comes with each head" },
      { id: "wired", label: "Wired" },
      { id: "wifi", label: "Wi-Fi adapter" },
    ],
  },
  {
    id: "condensate",
    scope: "system",
    group: "Indoor units",
    text: "How does the condensate drain?",
    exclusive: true,
    confirm: "whether the condensate drains",
    listOptions: true,
    decides: { group: "Mounting", name: "Condensate drain" },
    options: [
      { id: "gravity", label: "Gravity, outside", fragment: "by gravity, outside" },
      { id: "pump", label: "Pump", fragment: "by a pump" },
    ],
  },
];

/** every question, follow-ups included, by id */
const SPEC_BY_ID = new Map<string, QuestionSpec>();
function index(specs: QuestionSpec[]): void {
  for (const spec of specs) {
    SPEC_BY_ID.set(spec.id, spec);
    for (const option of spec.options) if (option.followUps) index(option.followUps);
  }
}
index([...HOUSE, ...OUTDOOR, ...INDOOR]);

/** the ids of the questions an option asks, all the way down */
function descendantIds(option: OptionSpec): string[] {
  const out: string[] = [];
  for (const followUp of option.followUps ?? []) {
    out.push(followUp.id);
    for (const inner of followUp.options) out.push(...descendantIds(inner));
  }
  return out;
}

const GROUP_ORDER: EquipmentGroup[] = ["Units", "Mounting", "Controls", "Electrical", "Pipework"];

/* ─────────────────────────── words ─────────────────────────── */

const unique = <T,>(items: T[]): T[] => [...new Set(items)];

const joinWith = (items: string[], word: string): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;

const joinAnd = (items: string[]): string => joinWith(items, "and");
const joinOr = (items: string[]): string => joinWith(items, "or");

/** "Wall bracket" → "wall bracket"; a name that opens on a code stays */
const lowerFirst = (text: string): string =>
  /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;

const upperFirst = (text: string): string =>
  text.length ? text[0].toUpperCase() + text.slice(1) : text;

/** the description's head: "Drain socket (outdoor unit)" → "Drain socket" */
const descriptionHead = (accessory: Accessory): string => {
  const head = (accessory.description ?? "").split(/\s*[(,;]/)[0].trim();
  return head || accessory.model;
};

/* ─────────────────────────── accessories ─────────────────────────── */

/** Does a model match one of the pack's `compatible_with` patterns? A
    pattern is an exact model, or a prefix glob ending in `*` ("MSZ-*",
    "PUZ-ZM1*"). Case-sensitive. A `*` anywhere but the end is not a glob
    the pack writes, and never matches. */
export function matchesModelGlob(model: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return !prefix.includes("*") && model.startsWith(prefix);
  }
  return model === pattern;
}

/** the pack's accessories compatible with a model, in pack order; narrowed
    to one category when given */
export function accessoriesFor(
  pack: DataPack,
  model: string,
  category?: Accessory["category"]
): Accessory[] {
  return pack.accessories.filter(
    (accessory) =>
      (category == null || accessory.category === category) &&
      accessory.compatible_with.some((pattern) => matchesModelGlob(model, pattern))
  );
}

/* ─────────────────────────── the system in hand ─────────────────────────── */

interface Context {
  doc: DesignDocument;
  pack: DataPack;
  sys: DesignSystem;
  /** indoor allocations with a model, in allocation order */
  heads: Allocation[];
  /** head model → how many, first seen first */
  headCounts: Map<string, number>;
  /** the outdoor allocation with a model, if any */
  oduAllocation: Allocation | null;
  /** its pack row; null when the pack has no row for the model */
  odu: OutdoorUnit | null;
}

function contextOf(doc: DesignDocument, pack: DataPack, sys: DesignSystem): Context {
  const allocations = allocationsOf(sys);
  const heads = allocations.filter((a) => a.role === "idu" && a.model);
  const headCounts = new Map<string, number>();
  for (const head of heads) headCounts.set(head.model, (headCounts.get(head.model) ?? 0) + 1);
  const oduAllocation = allocations.find((a) => a.role === "odu" && a.model) ?? null;
  const odu = oduAllocation
    ? (pack.outdoor_units.find((u) => u.model === oduAllocation.model) ?? null)
    : null;
  return { doc, pack, sys, heads, headCounts, oduAllocation, odu };
}

const iduRow = (pack: DataPack, model: string): IndoorUnit | null =>
  pack.indoor_units.find((u) => u.model === model) ?? null;

/** the top-level questions this system is asked, house first */
function applicableSpecs(context: Context): QuestionSpec[] {
  return [
    ...HOUSE,
    ...(context.oduAllocation ? OUTDOOR : []),
    ...(context.heads.length ? INDOOR : []),
  ];
}

/* ─────────────────────────── rows ─────────────────────────── */

const packRow = (group: EquipmentGroup, accessory: Accessory, qty: number): EquipmentRow => ({
  group,
  name: descriptionHead(accessory),
  model: accessory.model,
  qty,
});

/** the answer was given but the pack has nothing for the model: the line
    stays on the list and says so, rather than vanishing */
const missingRow = (
  group: EquipmentGroup,
  name: string,
  forModel: string,
  qty: number
): EquipmentRow => ({ group, name, qty, why: `Not in the pack for ${forModel}` });

function drainSocket(context: Context): Accessory | null {
  const model = context.oduAllocation?.model;
  if (!model) return null;
  return (
    accessoriesFor(context.pack, model, "drain-kit").find((a) =>
      (a.description ?? "").startsWith("Drain socket")
    ) ?? null
  );
}

function drainSocketRows(context: Context): EquipmentRow[] {
  const model = context.oduAllocation?.model;
  if (!model) return [];
  const accessory = drainSocket(context);
  return [accessory ? packRow("Mounting", accessory, 1) : missingRow("Mounting", "Drain socket", model, 1)];
}

/** the isolator the system carries: a hand pick on the Components tab
    stands while it is an isolator, else the pack's sizing */
function isolatorOption(context: Context): { option: ComponentChoiceOption; sized: boolean } | null {
  const { odu, sys } = context;
  if (!odu) return null;
  const electrical = COMPONENT_CHOICES.find((g) => g.key === "electrical");
  if (!electrical) return null;
  const sizedId = defaultIsolatorId(odu);
  const pickedId = componentChoices(sys, odu).electrical;
  const picked = electrical.options.find((o) => o.id === pickedId && "isolator" in o);
  const option = picked ?? electrical.options.find((o) => o.id === sizedId);
  return option ? { option, sized: option.id === sizedId } : null;
}

function isolatorRows(context: Context): EquipmentRow[] {
  const model = context.oduAllocation?.model;
  if (!model) return [];
  const found = isolatorOption(context);
  if (!found) return [{ group: "Electrical", name: "Isolator", qty: 1, why: `Unsized, ${model} is not in the pack` }];
  return [{ group: "Electrical", name: found.option.name, qty: 1 }];
}

function isolatorHint(context: Context): string | undefined {
  const found = isolatorOption(context);
  const draw = context.odu?.max_amps_a;
  if (!found || typeof draw !== "number" || !Number.isFinite(draw) || draw <= 0) return undefined;
  const rating = found.option.name.replace(/^Isolator, /, "");
  return `${found.sized ? "From the pack" : "Picked by hand"}: ${rating}, for its ${draw} A`;
}

/** the wired controller for each head model and, where the pack lists an
    interface for that head, the interface too */
function wiredParts(context: Context): { rows: EquipmentRow[]; models: string[] } {
  const rows: EquipmentRow[] = [];
  const models: string[] = [];
  for (const [model, count] of context.headCounts) {
    const controller = accessoriesFor(context.pack, model, "wired-controller")[0];
    if (controller) {
      rows.push(packRow("Controls", controller, count));
      models.push(controller.model);
    } else {
      rows.push(missingRow("Controls", "Wired controller", model, count));
    }
    const wiredInterface = context.pack.accessories.find(
      (a) =>
        WIRED_INTERFACES.includes(a.model) &&
        a.compatible_with.some((pattern) => matchesModelGlob(model, pattern))
    );
    if (wiredInterface) {
      rows.push(packRow("Controls", wiredInterface, count));
      models.push(wiredInterface.model);
    }
  }
  return { rows, models: unique(models) };
}

function wifiParts(context: Context): { rows: EquipmentRow[]; models: string[] } {
  const rows: EquipmentRow[] = [];
  const models: string[] = [];
  for (const [model, count] of context.headCounts) {
    const adapter = accessoriesFor(context.pack, model, "wifi")[0];
    if (adapter) {
      rows.push(packRow("Controls", adapter, count));
      models.push(adapter.model);
    } else {
      rows.push(missingRow("Controls", "Wi-Fi adapter", model, count));
    }
  }
  return { rows, models: unique(models) };
}

/** a pump per head: the unit's own where the pack says it is built in, the
    pack's kit where it has one, a third-party pump otherwise */
function pumpParts(context: Context): { rows: EquipmentRow[]; sub: string | undefined } {
  const rows: EquipmentRow[] = [];
  const builtIn: string[] = [];
  const kits: string[] = [];
  const thirdPartySeries: string[] = [];
  for (const [model, count] of context.headCounts) {
    const idu = iduRow(context.pack, model);
    if (idu?.drain_pump === "built-in") {
      builtIn.push(model);
      continue;
    }
    const kit = accessoriesFor(context.pack, model, "condensate-pump")[0];
    if (kit) {
      rows.push(packRow("Mounting", kit, count));
      kits.push(kit.model);
    } else {
      rows.push({ group: "Mounting", name: THIRD_PARTY_PUMP, qty: count });
      thirdPartySeries.push(idu?.series ?? model);
    }
  }
  const pieces: string[] = [];
  if (builtIn.length) pieces.push(`Built in on ${joinAnd(builtIn)}`);
  if (kits.length) pieces.push(joinAnd(unique(kits)));
  if (thirdPartySeries.length)
    pieces.push(`Third party: ${joinAnd(unique(thirdPartySeries))} heads have none built in`);
  return { rows, sub: pieces.length ? pieces.join("; ") : undefined };
}

/** the rows one ticked option puts on the list */
function optionRows(context: Context, question: QuestionSpec, option: OptionSpec): EquipmentRow[] {
  switch (question.id) {
    case "inside-walls": {
      const name = HEAD_FIXINGS[option.id];
      const count = context.heads.length;
      return name && count ? [{ group: "Mounting", name, qty: count }] : [];
    }
    case "outdoor-drain":
      return option.id === "yes" ? drainSocketRows(context) : [];
    case "isolator-supply":
      return option.id === "we-do" ? isolatorRows(context) : [];
    case "controls":
      if (option.id === "wired") return wiredParts(context).rows;
      if (option.id === "wifi") return wifiParts(context).rows;
      return [];
    case "condensate":
      return option.id === "pump" ? pumpParts(context).rows : [];
    default:
      return (option.parts ?? []).map((part) => ({
        group: "Mounting" as const,
        name: part.name,
        qty: part.qty,
        ...(part.value ? { value: part.value } : {}),
      }));
  }
}

/** the option's second line, from the pack where the pack decides it */
function optionSub(context: Context, question: QuestionSpec, option: OptionSpec): string | undefined {
  switch (question.id) {
    case "outdoor-drain":
      return option.id === "yes" ? drainSocket(context)?.model : option.sub;
    case "controls": {
      if (option.id === "wired") return joinAnd(wiredParts(context).models) || undefined;
      if (option.id === "wifi") return joinAnd(wifiParts(context).models) || undefined;
      return option.sub;
    }
    case "condensate":
      return option.id === "pump" ? pumpParts(context).sub : option.sub;
    default:
      return option.sub;
  }
}

/** where the plan has the outdoor, when it is placed on a floor we can name */
function outdoorWhereabouts(context: Context): string | undefined {
  const id = context.oduAllocation?.id;
  const placed = id ? context.doc.objects.find((o) => o.id === id) : undefined;
  if (!placed) return undefined;
  if (placed.plane === "external-roof") return "The plan has it on the roof";
  const floor = context.doc.floors.find((f) => f.id === placed.floorId);
  return floor ? `The plan has it on the ${lowerFirst(floor.name)}, outside` : undefined;
}

function questionHint(context: Context, question: QuestionSpec): string | undefined {
  if (question.id === "outdoor-sits") return outdoorWhereabouts(context);
  if (question.id === "isolator-supply") return isolatorHint(context);
  return undefined;
}

/** the question as the panel shows it, follow-ups nested under their option */
function materialise(context: Context, question: QuestionSpec): InstallQuestion {
  const hint = questionHint(context, question);
  return {
    id: question.id,
    scope: question.scope,
    group: question.group,
    text: question.text,
    exclusive: question.exclusive,
    ...(hint ? { hint } : {}),
    options: question.options.map((option) => {
      const sub = optionSub(context, question, option);
      return {
        id: option.id,
        label: option.label,
        ...(sub ? { sub } : {}),
        ...(option.followUps
          ? { followUps: option.followUps.map((followUp) => materialise(context, followUp)) }
          : {}),
      };
    }),
  };
}

/* ─────────────────────────── answers ─────────────────────────── */

/** a stored answer set, tolerating any stored shape */
function readStore(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, ticks] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(ticks)) out[id] = ticks.filter((t): t is string => typeof t === "string");
  }
  return out;
}

const isHouseQuestion = (id: string): boolean => SPEC_BY_ID.get(id)?.scope === "house";

/** the ticks a question has, of its own options only */
function ticksOf(answers: Record<string, string[]>, question: QuestionSpec): string[] {
  const ticks = answers[question.id] ?? [];
  return question.options.filter((o) => ticks.includes(o.id)).map((o) => o.id);
}

/* ─────────────────────────── the walk ─────────────────────────── */

interface Walk {
  rows: EquipmentRow[];
  notes: string[];
  answered: number;
  total: number;
}

function provisionNote(question: QuestionSpec, ticks: string[], placed: EquipmentRow[]): string {
  const fragments = question.listOptions
    ? question.options.filter((o) => ticks.includes(o.id)).map((o) => o.fragment ?? lowerFirst(o.label))
    : [];
  const opening = question.confirm ?? lowerFirst(question.text.replace(/\?$/, ""));
  const first = `Confirm on the day ${opening}${fragments.length ? ` ${joinOr(fragments)}` : ""}.`;
  const names = unique(placed.map((row) => `the ${lowerFirst(row.name)}`));
  if (!names.length) return first;
  if (names.length === 1) return `${first} ${upperFirst(names[0])} is on the list.`;
  return `${first} ${upperFirst(joinAnd(names))} are ${names.length === 2 ? "both" : "all"} on the list.`;
}

/** Ask one question: a waiting row when it has no tick, else every ticked
    option's rows, then its follow-ups. Returns the rows it and its follow-ups
    put on the list, for the note. */
function walkQuestion(
  context: Context,
  answers: Record<string, string[]>,
  question: QuestionSpec,
  inheritedOnTheDay: boolean,
  walk: Walk
): EquipmentRow[] {
  walk.total += 1;
  const ticks = ticksOf(answers, question);
  if (!ticks.length) {
    walk.rows.push({ group: question.decides.group, name: question.decides.name, waiting: true });
    return [];
  }
  walk.answered += 1;
  const provisions = question.exclusive && ticks.length > 1;
  const onTheDay = inheritedOnTheDay || provisions;
  const noteAt = walk.notes.length;
  const placed: EquipmentRow[] = [];
  for (const option of question.options) {
    if (!ticks.includes(option.id)) continue;
    for (const row of optionRows(context, question, option)) {
      const out = onTheDay ? { ...row, onTheDay: true } : row;
      walk.rows.push(out);
      placed.push(out);
    }
    for (const followUp of option.followUps ?? []) {
      placed.push(...walkQuestion(context, answers, followUp, onTheDay, walk));
    }
  }
  // the parent's note reads before any follow-up's
  if (provisions) walk.notes.splice(noteAt, 0, provisionNote(question, ticks, placed));
  return placed;
}

/* ─────────────────────────── derived rows ─────────────────────────── */

/** one row per model, the outdoor first, then the heads as allocated */
function unitRows(context: Context): EquipmentRow[] {
  const counts = new Map<string, number>();
  const outdoors = allocationsOf(context.sys).filter((a) => a.role === "odu" && a.model);
  for (const a of [...outdoors, ...context.heads]) counts.set(a.model, (counts.get(a.model) ?? 0) + 1);
  return [...counts].map(([model, qty]) => ({ group: "Units" as const, name: model, model, qty }));
}

const portLetter = (index: number): string => String.fromCharCode(65 + index);

/** The joint pipes a multi's ports need. Heads go on the ports biggest
    first (port A takes the biggest); a port whose size differs from its
    head's connection takes the pack's joint pipe for that pair of sizes. */
function jointPipeRows(context: Context): EquipmentRow[] {
  const { pack, odu } = context;
  if (!odu) return [];
  const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model);
  if (!rule) return [];
  const heads = context.heads
    .map((a) => iduRow(pack, a.model))
    .filter((u): u is IndoorUnit => u != null)
    .sort((a, b) => b.capacity_cool_kw - a.capacity_cool_kw);

  interface Need {
    line: "gas" | "liquid";
    portMm: number;
    headMm: number;
    ports: string[];
  }
  const needs: Need[] = [];
  heads.forEach((head, i) => {
    const port = rule.port_pipe_sizes[i];
    if (!port) return;
    const lines: [Need["line"], number, number][] = [
      ["gas", port.gas_mm, head.conn_gas_mm],
      ["liquid", port.liquid_mm, head.conn_liquid_mm],
    ];
    for (const [line, portMm, headMm] of lines) {
      if (portMm === headMm) continue;
      let need = needs.find((n) => n.line === line && n.portMm === portMm && n.headMm === headMm);
      if (!need) {
        need = { line, portMm, headMm, ports: [] };
        needs.push(need);
      }
      need.ports.push(portLetter(i));
    }
  });

  return needs.map((need) => {
    const wanted = `Joint pipe, unit ${need.portMm} mm to pipe ${need.headMm} mm`;
    const accessory = accessoriesFor(pack, odu.model).find((a) =>
      (a.description ?? "").startsWith(wanted)
    );
    const sizeOf = (head: IndoorUnit) => (need.line === "gas" ? head.conn_gas_mm : head.conn_liquid_mm);
    const everyHead = heads.every((head) => sizeOf(head) === need.headMm);
    const one = need.ports.length === 1;
    const ports = one ? `Port ${need.ports[0]} is` : `Ports ${joinAnd(need.ports)} are`;
    const headsWord = everyHead ? "every head is" : one ? "its head is" : "their heads are";
    const why = `${ports} ${need.portMm} mm, ${headsWord} ${need.headMm}`;
    return accessory
      ? { ...packRow("Pipework", accessory, need.ports.length), why }
      : {
          group: "Pipework" as const,
          name: `Joint pipe, ${need.portMm} mm to ${need.headMm} mm`,
          qty: need.ports.length,
          why,
        };
  });
}

/** Copper is never asked: the drawn runs say whether it is coil or hard
    drawn, and hard drawn brings its lagging. Nothing drawn yet says so. */
function copperRows(context: Context): EquipmentRow[] {
  const { doc, sys } = context;
  if (!context.heads.length && !context.oduAllocation) return [];
  const drawn = doc.objects.some((o) => o.type === "pipe-run" && o.systemId === sys.id);
  if (!drawn) {
    return [
      {
        group: "Pipework",
        name: "Copper and lagging",
        value: "Not drawn",
        why: "Coil or hard drawn, from the drawn runs",
      },
    ];
  }
  const hard = hardDrawnLengthM(doc, sys);
  if (hard != null && hard > 0) {
    return [{ group: "Pipework", name: "Lagging, hard drawn runs", value: `${hard} m` }];
  }
  const total = totalPipeLengthM(buildSystemGraph(doc.objects, doc.floors, sys.id));
  return [
    {
      group: "Pipework",
      name: "Pre-insulated coil",
      ...(total != null && total > 0 ? { value: `${Math.round(total * 10) / 10} m` } : {}),
    },
  ];
}

/** like rows become one row with the quantities summed */
function mergeRows(rows: EquipmentRow[]): EquipmentRow[] {
  const out: EquipmentRow[] = [];
  const byKey = new Map<string, EquipmentRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.group, row.name, row.model, row.value, row.why, !!row.onTheDay, !!row.waiting]);
    const seen = byKey.get(key);
    if (seen && seen.qty != null && row.qty != null) {
      seen.qty += row.qty;
      continue;
    }
    const copy = { ...row };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}

/* ─────────────────────────── API ─────────────────────────── */

/** The top-level questions this system is asked, the house's first, then
    the outdoor's (when it has an outdoor) and the heads' (when it has heads).
    Follow-ups are nested under their option; they are asked, and counted,
    only while that option is ticked. */
export function installQuestions(doc: DesignDocument, pack: DataPack, sys: DesignSystem): InstallQuestion[] {
  const context = contextOf(doc, pack, sys);
  return applicableSpecs(context).map((question) => materialise(context, question));
}

/** the questions in front of the person right now, in order: each
    top-level question, then the follow-ups of its ticked options */
export function askedQuestions(doc: DesignDocument, pack: DataPack, sys: DesignSystem): InstallQuestion[] {
  const answers = installAnswers(doc, sys);
  const out: InstallQuestion[] = [];
  const visit = (question: InstallQuestion) => {
    out.push(question);
    const ticks = answers[question.id] ?? [];
    for (const option of question.options) {
      if (!ticks.includes(option.id)) continue;
      for (const followUp of option.followUps ?? []) visit(followUp);
    }
  };
  for (const question of installQuestions(doc, pack, sys)) visit(question);
  return out;
}

/** every answer this system sees: the house's from the design, its own
    from the system; question id → the option ids ticked */
export function installAnswers(doc: DesignDocument, sys: DesignSystem): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, ticks] of Object.entries(readStore(doc.settings.install))) {
    if (isHouseQuestion(id)) out[id] = ticks;
  }
  for (const [id, ticks] of Object.entries(readStore(sys.settings.install))) {
    if (!isHouseQuestion(id)) out[id] = ticks;
  }
  return out;
}

/** Answer a question: a house question writes to the design, a system
    question to the system. Unknown options are dropped, no ticks clears the
    answer, and the follow-ups of an option that is no longer ticked lose
    their answers with it. */
export function answerInstall(
  doc: DesignDocument,
  systemId: string,
  questionId: string,
  optionIds: string[]
): DesignDocument {
  const question = SPEC_BY_ID.get(questionId);
  if (!question) return doc;
  const ticks = unique(optionIds.filter((id) => question.options.some((o) => o.id === id)));
  const dropped = question.options
    .filter((o) => !ticks.includes(o.id))
    .flatMap((o) => descendantIds(o));
  const rewrite = (store: unknown): Record<string, string[]> => {
    const next = { ...readStore(store) };
    for (const id of dropped) delete next[id];
    if (ticks.length) next[questionId] = ticks;
    else delete next[questionId];
    return next;
  };
  if (question.scope === "house") {
    return { ...doc, settings: { ...doc.settings, install: rewrite(doc.settings.install) } };
  }
  if (!doc.systems.some((s) => s.id === systemId)) return doc;
  return {
    ...doc,
    systems: doc.systems.map((s) =>
      s.id === systemId ? { ...s, settings: { ...s.settings, install: rewrite(s.settings.install) } } : s
    ),
  };
}

/** The system's equipment list: its units, then what every answer put on
    it, then what the pack and the plan decide on their own (joint pipes,
    copper). Rows come in group order. A question with no tick is a waiting
    row; a question answered two ways flags its rows for the day and adds a
    note for the installer. */
export function equipmentList(doc: DesignDocument, pack: DataPack, sys: DesignSystem): EquipmentList {
  const context = contextOf(doc, pack, sys);
  const answers = installAnswers(doc, sys);
  const walk: Walk = { rows: unitRows(context), notes: [], answered: 0, total: 0 };
  for (const question of applicableSpecs(context)) walkQuestion(context, answers, question, false, walk);
  walk.rows.push(...jointPipeRows(context), ...copperRows(context));
  const rows = mergeRows(walk.rows).sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
  );
  return {
    rows,
    notes: walk.notes,
    answered: walk.answered,
    total: walk.total,
    onTheDay: rows.filter((row) => row.onTheDay).length,
    complete: walk.total > 0 && walk.answered === walk.total,
  };
}

/** where the system's questions are up to: nothing ticked yet, some, or
    every question asked (follow-ups included) has a tick */
export function installState(doc: DesignDocument, pack: DataPack, sys: DesignSystem): InstallState {
  const list = equipmentList(doc, pack, sys);
  if (list.answered === 0) return "not-asked";
  return list.complete ? "complete" : "open";
}
