/* The install questions and the equipment list, against the real pack.

   Every part asserted here is read off the shipped Mitsubishi pack or the
   Studio's own catalogue, never typed from memory: a pack change that moves
   a joint pipe or a drain socket fails here. Systems are built by hand from
   their allocations, the shape the builder writes. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject, type DesignSystem } from "../document";
import { defaultIsolatorId } from "../components";
import {
  accessoriesFor,
  answerInstall,
  askedQuestions,
  equipmentList,
  installAnswers,
  installQuestions,
  installState,
  matchesModelGlob,
  type EquipmentRow,
  type InstallQuestion,
} from "../install";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

/* ── the house: five zones on one floor ── */

function house(): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" }); // 10 mm per unit
  const floorId = doc.floors[0].id;
  const zone = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      },
      props: { name },
    } as DesignObject);
  zone("living", "Living", 0, 0, 1000, 960);
  zone("bed1", "Bed 1", 1100, 0, 400, 300);
  zone("bed2", "Bed 2", 1600, 0, 450, 400);
  zone("master", "Master", 2150, 0, 550, 500);
  zone("study", "Study", 1100, 500, 400, 320);
  return doc;
}

interface Head {
  id: string;
  model: string;
  roomId: string | null;
  serves?: "zone" | "system";
}

/** a system with these units, as the builder allocates them */
function withSystem(
  doc: DesignDocument,
  id: string,
  type: DesignSystem["type"],
  heads: Head[],
  oduModel: string
): DesignDocument {
  const sys: DesignSystem = {
    id,
    type,
    brand: "mitsubishi-electric",
    colour: "#3366ff",
    name: id,
    settings: {
      allocations: [
        ...heads.map((h) => ({
          id: h.id,
          role: "idu",
          model: h.model,
          roomId: h.roomId,
          ...(h.serves ? { serves: h.serves } : {}),
        })),
        { id: `${id}-odu`, role: "odu", model: oduModel, roomId: null },
      ],
    },
  };
  return { ...doc, systems: [...doc.systems, sys] };
}

const sysOf = (doc: DesignDocument, id: string): DesignSystem => doc.systems.find((s) => s.id === id)!;

/** the five-head multi of the brief on an MXZ-5F100VGD */
function fiveHeadMulti(): DesignDocument {
  return withSystem(
    house(),
    "multi",
    "multi-split",
    [
      { id: "h-living", model: "MSZ-AP35VGD2", roomId: "living" },
      { id: "h-bed1", model: "MSZ-AP20VGD", roomId: "bed1" },
      { id: "h-bed2", model: "MSZ-AP20VGD", roomId: "bed2" },
      { id: "h-master", model: "MSZ-AP42VGD2", roomId: "master" },
      { id: "h-study", model: "MSZ-AP25VGD2", roomId: "study" },
    ],
    "MXZ-5F100VGD"
  );
}

const rowsNamed = (rows: EquipmentRow[], name: string) => rows.filter((r) => r.name === name);
const rowsOfModel = (rows: EquipmentRow[], model: string) => rows.filter((r) => r.model === model);
const questionById = (questions: InstallQuestion[], id: string) => questions.find((q) => q.id === id)!;

/* ── the pack facts the list is built on ── */

describe("the pack facts behind the five-head multi", () => {
  it("puts 12.7 mm gas on port A of the MXZ-5F100VGD and 9.52 on every AP head", () => {
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === "MXZ-5F100VGD")!;
    expect(rule.port_pipe_sizes.map((p) => p.gas_mm)).toEqual([12.7, 9.52, 9.52, 9.52, 9.52]);
    expect(rule.port_pipe_sizes.every((p) => p.liquid_mm === 6.35)).toBe(true);
    for (const model of ["MSZ-AP35VGD2", "MSZ-AP20VGD", "MSZ-AP42VGD2", "MSZ-AP25VGD2"]) {
      const idu = pack.indoor_units.find((u) => u.model === model)!;
      expect(idu.conn_gas_mm).toBe(9.52);
      expect(idu.conn_liquid_mm).toBe(6.35);
      // the AP heads carry no drain_pump field at all: not built in
      expect(idu.drain_pump).toBeUndefined();
    }
  });
});

/* ── 1. the five-head multi ── */

describe("a five-head multi on an MXZ-5F100VGD", () => {
  it("lists its units with their quantities", () => {
    const doc = fiveHeadMulti();
    const { rows } = equipmentList(doc, pack, sysOf(doc, "multi"));
    const units = rows.filter((r) => r.group === "Units").map((r) => [r.model, r.qty]);
    expect(units).toEqual([
      ["MXZ-5F100VGD", 1],
      ["MSZ-AP35VGD2", 1],
      ["MSZ-AP20VGD", 2],
      ["MSZ-AP42VGD2", 1],
      ["MSZ-AP25VGD2", 1],
    ]);
  });

  it("adds the joint pipe port A needs, from the pack, and says why", () => {
    const doc = fiveHeadMulti();
    const { rows } = equipmentList(doc, pack, sysOf(doc, "multi"));
    const joints = rowsOfModel(rows, "MAC-A455JP-E");
    expect(joints).toHaveLength(1);
    expect(joints[0]).toMatchObject({
      group: "Pipework",
      name: "Joint pipe",
      qty: 1,
      why: "Port A is 12.7 mm, every head is 9.52",
    });
    // and no other joint pipe: ports B to E are 9.52 like their heads
    expect(rows.filter((r) => r.name.startsWith("Joint pipe"))).toHaveLength(1);
  });

  it("sizes the isolator from the pack and lists it only when we supply it", () => {
    let doc = fiveHeadMulti();
    const question = questionById(installQuestions(doc, pack, sysOf(doc, "multi")), "isolator-supply");
    expect(question.hint).toBe("From the pack: 1Ø 20 A, for its 18.4 A");

    doc = answerInstall(doc, "multi", "isolator-supply", ["we-do"]);
    let rows = equipmentList(doc, pack, sysOf(doc, "multi")).rows;
    expect(rowsNamed(rows, "Isolator, 1Ø 20 A")).toEqual([
      { group: "Electrical", name: "Isolator, 1Ø 20 A", qty: 1 },
    ]);

    doc = answerInstall(doc, "multi", "isolator-supply", ["electrician"]);
    rows = equipmentList(doc, pack, sysOf(doc, "multi")).rows;
    expect(rows.filter((r) => r.group === "Electrical")).toEqual([]);
  });

  it("adds the outdoor's drain socket from the pack when its water is piped away", () => {
    let doc = fiveHeadMulti();
    const question = questionById(installQuestions(doc, pack, sysOf(doc, "multi")), "outdoor-drain");
    expect(question.options.find((o) => o.id === "yes")?.sub).toBe("PAC-SG60DS-E");

    doc = answerInstall(doc, "multi", "outdoor-drain", ["yes"]);
    const { rows } = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsOfModel(rows, "PAC-SG60DS-E")).toEqual([
      { group: "Mounting", name: "Drain socket", model: "PAC-SG60DS-E", qty: 1 },
    ]);
  });

  it("wired control brings a controller and its interface for every head", () => {
    let doc = fiveHeadMulti();
    const controls = questionById(installQuestions(doc, pack, sysOf(doc, "multi")), "controls");
    expect(controls.exclusive).toBe(false);
    expect(controls.options.find((o) => o.id === "wired")?.sub).toBe("PAR-41MAA and MAC-334IF-E");
    expect(controls.options.find((o) => o.id === "wifi")?.sub).toBe("MAC-588IF-E");
    expect(controls.options.find((o) => o.id === "wireless")?.sub).toBe("Comes with each head");

    doc = answerInstall(doc, "multi", "controls", ["wired"]);
    let rows = equipmentList(doc, pack, sysOf(doc, "multi")).rows;
    expect(rowsOfModel(rows, "PAR-41MAA")).toEqual([
      { group: "Controls", name: "Wired remote controller", model: "PAR-41MAA", qty: 5 },
    ]);
    expect(rowsOfModel(rows, "MAC-334IF-E")).toEqual([
      { group: "Controls", name: "System control interface", model: "MAC-334IF-E", qty: 5 },
    ]);

    // both can happen: wired and Wi-Fi together are both fitted, nothing flagged
    doc = answerInstall(doc, "multi", "controls", ["wired", "wifi"]);
    const list = equipmentList(doc, pack, sysOf(doc, "multi"));
    rows = list.rows;
    expect(rowsOfModel(rows, "MAC-588IF-E")).toEqual([
      { group: "Controls", name: "Wi-Fi interface", model: "MAC-588IF-E", qty: 5 },
    ]);
    expect(rowsOfModel(rows, "PAR-41MAA")).toHaveLength(1);
    expect(list.onTheDay).toBe(0);
    expect(list.notes).toEqual([]);
  });

  it("a pump on AP heads is a third-party pump per head, and the option says so", () => {
    let doc = fiveHeadMulti();
    const condensate = questionById(installQuestions(doc, pack, sysOf(doc, "multi")), "condensate");
    expect(condensate.options.find((o) => o.id === "pump")?.sub).toBe(
      "Third party: MSZ-AP heads have none built in"
    );
    doc = answerInstall(doc, "multi", "condensate", ["pump"]);
    const { rows } = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsNamed(rows, "Condensate pump, third party")).toEqual([
      { group: "Mounting", name: "Condensate pump, third party", qty: 5 },
    ]);
  });

  it("says the copper is not drawn until a run is", () => {
    const doc = fiveHeadMulti();
    const { rows } = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsNamed(rows, "Copper and lagging")).toEqual([
      {
        group: "Pipework",
        name: "Copper and lagging",
        value: "Not drawn",
        why: "Coil or hard drawn, from the drawn runs",
      },
    ]);
    // rows come in group order
    const order = ["Units", "Mounting", "Controls", "Electrical", "Pipework"];
    const seen = rows.map((r) => order.indexOf(r.group));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

/* ── 2. two answers to an exclusive question: provisions for both ── */

describe("where the outdoor sits, answered two ways", () => {
  it("asks both follow-ups, flags both lots of parts for the day, and notes it", () => {
    let doc = fiveHeadMulti();
    doc = answerInstall(doc, "multi", "outdoor-sits", ["ground", "wall"]);
    const asked = askedQuestions(doc, pack, sysOf(doc, "multi")).map((q) => q.id);
    expect(asked).toEqual([
      "outside-walls",
      "inside-walls",
      "outdoor-sits",
      "ground-base",
      "wall-bracket",
      "outdoor-drain",
      "isolator-supply",
      "controls",
      "condensate",
    ]);
    // the follow-ups sit under their option on the question itself
    const sits = questionById(installQuestions(doc, pack, sysOf(doc, "multi")), "outdoor-sits");
    expect(sits.exclusive).toBe(true);
    expect(sits.options.find((o) => o.id === "wall")?.followUps?.map((q) => q.id)).toEqual(["wall-bracket"]);
    expect(sits.options.find((o) => o.id === "ground")?.followUps?.map((q) => q.id)).toEqual(["ground-base"]);
    expect(sits.options.find((o) => o.id === "roof")?.followUps?.map((q) => q.id)).toEqual(["roof-frame"]);

    // before the follow-ups are answered they wait, and the note has nothing to list yet
    let list = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(list.rows.filter((r) => r.waiting).map((r) => r.name)).toEqual(
      expect.arrayContaining(["Ground base", "Wall bracket"])
    );
    expect(list.notes).toEqual(["Confirm on the day whether the outdoor goes on the ground or on a wall."]);

    doc = answerInstall(doc, "multi", "wall-bracket", ["wall-bracket"]);
    doc = answerInstall(doc, "multi", "ground-base", ["rubber-feet"]);
    list = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsNamed(list.rows, "Wall bracket")).toEqual([
      { group: "Mounting", name: "Wall bracket", qty: 1, value: "1 set", onTheDay: true },
    ]);
    expect(rowsNamed(list.rows, "Rubber isolation feet")).toEqual([
      { group: "Mounting", name: "Rubber isolation feet", qty: 1, value: "1 set", onTheDay: true },
    ]);
    expect(list.onTheDay).toBe(2);
    expect(list.notes).toEqual([
      "Confirm on the day whether the outdoor goes on the ground or on a wall. The rubber isolation feet and the wall bracket are both on the list.",
    ]);
    // nothing waits on the outdoor any more
    expect(list.rows.filter((r) => r.waiting).map((r) => r.name)).not.toEqual(
      expect.arrayContaining(["Outdoor base", "Ground base", "Wall bracket"])
    );
  });

  it("unticking the wall drops the bracket's answer and its rows, and the feet are no longer a provision", () => {
    let doc = fiveHeadMulti();
    doc = answerInstall(doc, "multi", "outdoor-sits", ["ground", "wall"]);
    doc = answerInstall(doc, "multi", "wall-bracket", ["wall-bracket"]);
    doc = answerInstall(doc, "multi", "ground-base", ["rubber-feet"]);
    expect(installAnswers(doc, sysOf(doc, "multi"))["wall-bracket"]).toEqual(["wall-bracket"]);

    doc = answerInstall(doc, "multi", "outdoor-sits", ["ground"]);
    const answers = installAnswers(doc, sysOf(doc, "multi"));
    expect(answers["wall-bracket"]).toBeUndefined();
    expect(answers["ground-base"]).toEqual(["rubber-feet"]);
    expect(Object.keys(sysOf(doc, "multi").settings.install as object)).not.toContain("wall-bracket");

    const list = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsNamed(list.rows, "Wall bracket")).toEqual([]);
    expect(rowsNamed(list.rows, "Rubber isolation feet")).toEqual([
      { group: "Mounting", name: "Rubber isolation feet", qty: 1, value: "1 set" },
    ]);
    expect(list.onTheDay).toBe(0);
    expect(list.notes).toEqual([]);
    expect(askedQuestions(doc, pack, sysOf(doc, "multi")).map((q) => q.id)).not.toContain("wall-bracket");
  });

  it("a follow-up answered two ways is its own provision, under its parent's note", () => {
    let doc = fiveHeadMulti();
    doc = answerInstall(doc, "multi", "outdoor-sits", ["wall"]);
    doc = answerInstall(doc, "multi", "wall-bracket", ["wall-bracket", "heavy-bracket"]);
    const list = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsNamed(list.rows, "Wall bracket")[0].onTheDay).toBe(true);
    expect(rowsNamed(list.rows, "Heavy-duty bracket")[0].onTheDay).toBe(true);
    expect(list.notes).toEqual([
      "Confirm on the day whether the outdoor takes the wall bracket or heavy-duty bracket. The wall bracket and the heavy-duty bracket are both on the list.",
    ]);
  });
});

/* ── 3. the house's answers live on the design ── */

describe("the house's answers", () => {
  it("are written on the design, not the system, and read by every system", () => {
    let doc = fiveHeadMulti();
    doc = withSystem(
      doc,
      "split",
      "split",
      [{ id: "s-study", model: "MSZ-AP25VGD2", roomId: "study" }],
      "MUZ-AP25VG2"
    );
    doc = answerInstall(doc, "multi", "inside-walls", ["plasterboard-timber"]);
    expect(doc.settings.install).toEqual({ "inside-walls": ["plasterboard-timber"] });
    expect(sysOf(doc, "multi").settings.install).toBeUndefined();

    // the second system sees the answer and gets its own fixings count
    expect(installAnswers(doc, sysOf(doc, "split"))["inside-walls"]).toEqual(["plasterboard-timber"]);
    const multiRows = equipmentList(doc, pack, sysOf(doc, "multi")).rows;
    expect(rowsNamed(multiRows, "Head fixings, timber stud")).toEqual([
      { group: "Mounting", name: "Head fixings, timber stud", qty: 5 },
    ]);
    const splitRows = equipmentList(doc, pack, sysOf(doc, "split")).rows;
    expect(rowsNamed(splitRows, "Head fixings, timber stud")).toEqual([
      { group: "Mounting", name: "Head fixings, timber stud", qty: 1 },
    ]);

    // two inside walls are both fitted for, nothing flagged: the question is not exclusive
    doc = answerInstall(doc, "split", "inside-walls", ["plasterboard-timber", "brick"]);
    const list = equipmentList(doc, pack, sysOf(doc, "multi"));
    expect(rowsNamed(list.rows, "Head fixings, masonry")).toEqual([
      { group: "Mounting", name: "Head fixings, masonry", qty: 5 },
    ]);
    expect(list.onTheDay).toBe(0);
    // the house questions come first, with no parts for the outside walls
    const questions = installQuestions(doc, pack, sysOf(doc, "split"));
    expect(questions.slice(0, 2).map((q) => [q.id, q.scope, q.group])).toEqual([
      ["outside-walls", "house", "The house"],
      ["inside-walls", "house", "The house"],
    ]);
    doc = answerInstall(doc, "split", "outside-walls", ["brick-veneer", "timber"]);
    expect(doc.settings.install?.["outside-walls"]).toEqual(["brick-veneer", "timber"]);
    expect(equipmentList(doc, pack, sysOf(doc, "split")).rows.filter((r) => r.group === "Mounting")).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ name: "Outside walls" })])
    );
  });
});

/* ── 4. where the questions are up to ── */

describe("install state", () => {
  it("goes not asked, open, complete, and the list agrees", () => {
    let doc = fiveHeadMulti();
    const sys = () => sysOf(doc, "multi");
    expect(installState(doc, pack, sys())).toBe("not-asked");
    let list = equipmentList(doc, pack, sys());
    expect(list.complete).toBe(false);
    expect(list.total).toBe(7);
    expect(list.answered).toBe(0);
    // every unanswered question waits on the list, named for what it decides,
    // in the list's group order (Mounting, Controls, Electrical)
    expect(list.rows.filter((r) => r.waiting).map((r) => r.name)).toEqual([
      "Outside walls",
      "Head fixings",
      "Outdoor base",
      "Outdoor drain",
      "Condensate drain",
      "Controls",
      "Isolator",
    ]);

    doc = answerInstall(doc, "multi", "controls", ["wireless"]);
    expect(installState(doc, pack, sys())).toBe("open");
    list = equipmentList(doc, pack, sys());
    expect(list.answered).toBe(1);
    expect(list.rows.filter((r) => r.waiting).map((r) => r.name)).not.toContain("Controls");
    expect(list.rows.filter((r) => r.waiting).map((r) => r.name)).toContain("Isolator");

    doc = answerInstall(doc, "multi", "outside-walls", ["brick-veneer"]);
    doc = answerInstall(doc, "multi", "inside-walls", ["plasterboard-timber"]);
    doc = answerInstall(doc, "multi", "outdoor-sits", ["ground"]);
    doc = answerInstall(doc, "multi", "outdoor-drain", ["no"]);
    doc = answerInstall(doc, "multi", "isolator-supply", ["we-do"]);
    doc = answerInstall(doc, "multi", "condensate", ["gravity"]);
    // the ground's follow-up is now asked and not yet answered
    expect(installState(doc, pack, sys())).toBe("open");
    list = equipmentList(doc, pack, sys());
    expect(list.total).toBe(8);
    expect(list.answered).toBe(7);
    expect(list.rows.filter((r) => r.waiting).map((r) => r.name)).toEqual(["Ground base"]);

    doc = answerInstall(doc, "multi", "ground-base", ["ground-pad"]);
    expect(installState(doc, pack, sys())).toBe("complete");
    list = equipmentList(doc, pack, sys());
    expect(list.complete).toBe(true);
    expect(list.rows.some((r) => r.waiting)).toBe(false);
    expect(rowsNamed(list.rows, "Ground pad")).toEqual([{ group: "Mounting", name: "Ground pad", qty: 1 }]);

    // clearing an answer opens it again
    doc = answerInstall(doc, "multi", "condensate", []);
    expect(installState(doc, pack, sys())).toBe("open");
    expect(installAnswers(doc, sys()).condensate).toBeUndefined();
  });

  it("ignores an option the question does not have, and a question nothing has", () => {
    let doc = fiveHeadMulti();
    doc = answerInstall(doc, "multi", "controls", ["wired", "laser"]);
    expect(installAnswers(doc, sysOf(doc, "multi")).controls).toEqual(["wired"]);
    const same = answerInstall(doc, "multi", "no-such-question", ["yes"]);
    expect(same).toBe(doc);
    const noSystem = answerInstall(doc, "no-such-system", "controls", ["wired"]);
    expect(noSystem).toBe(doc);
  });
});

/* ── 5. a split and a ducted pair ── */

describe("a split and a ducted pair", () => {
  it("a wall split on its own outdoor needs no joint pipe", () => {
    const doc = withSystem(
      house(),
      "split",
      "split",
      [{ id: "s-living", model: "MSZ-AP80VGD2", roomId: "living" }],
      "MUZ-AP80VG2"
    );
    const { rows } = equipmentList(doc, pack, sysOf(doc, "split"));
    expect(rows.some((r) => r.name.startsWith("Joint pipe"))).toBe(false);
    expect(rows.filter((r) => r.group === "Units").map((r) => [r.model, r.qty])).toEqual([
      ["MUZ-AP80VG2", 1],
      ["MSZ-AP80VGD2", 1],
    ]);
  });

  it("a PEAD ducted pair drains with its own pump and takes a 32 A isolator", () => {
    let doc = withSystem(
      house(),
      "ducted",
      "ducted",
      [{ id: "ahu", model: "PEAD-M125JAA(D)", roomId: null, serves: "system" }],
      "PUZ-ZM125VKA2-A"
    );
    const idu = pack.indoor_units.find((u) => u.model === "PEAD-M125JAA(D)")!;
    expect(idu.drain_pump).toBe("built-in");
    const odu = pack.outdoor_units.find((u) => u.model === "PUZ-ZM125VKA2-A")!;
    expect(odu.max_amps_a).toBe(28);
    expect(odu.phase).toBe("1");
    expect(defaultIsolatorId(odu)).toBe("isolator-32a-1ph");

    const questions = installQuestions(doc, pack, sysOf(doc, "ducted"));
    expect(questionById(questions, "condensate").options.find((o) => o.id === "pump")?.sub).toBe(
      "Built in on PEAD-M125JAA(D)"
    );
    expect(questionById(questions, "isolator-supply").hint).toBe("From the pack: 1Ø 32 A, for its 28 A");

    doc = answerInstall(doc, "ducted", "condensate", ["pump"]);
    doc = answerInstall(doc, "ducted", "isolator-supply", ["we-do"]);
    const { rows } = equipmentList(doc, pack, sysOf(doc, "ducted"));
    expect(rows.some((r) => r.name.startsWith("Condensate pump") || r.name.startsWith("Drain pump"))).toBe(false);
    expect(rows.filter((r) => r.group === "Electrical")).toEqual([
      { group: "Electrical", name: "Isolator, 1Ø 32 A", qty: 1 },
    ]);
  });

  it("an SEZ bulkhead takes the pack's own drain pump kit", () => {
    let doc = withSystem(
      house(),
      "split",
      "split",
      [{ id: "sez", model: "SEZ-M71DA(L)", roomId: "living" }],
      "SUZ-M71VAD-A"
    );
    expect(pack.indoor_units.find((u) => u.model === "SEZ-M71DA(L)")?.drain_pump).toBe("none");
    doc = answerInstall(doc, "split", "condensate", ["pump"]);
    const { rows } = equipmentList(doc, pack, sysOf(doc, "split"));
    expect(rowsOfModel(rows, "PAC-KE07DM-E")).toEqual([
      { group: "Mounting", name: "Drain pump kit", model: "PAC-KE07DM-E", qty: 1 },
    ]);
  });
});

/* ── the plan's own answers: where the outdoor is, and the drawn copper ── */

describe("what the plan already knows", () => {
  it("hints where the outdoor was placed, and reads the drawn runs for the copper", () => {
    let doc = fiveHeadMulti();
    const floorId = doc.floors[0].id;
    const sys = () => sysOf(doc, "multi");
    expect(questionById(installQuestions(doc, pack, sys()), "outdoor-sits").hint).toBeUndefined();

    // place the outdoor and one head, as the plan would
    doc = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "multi-odu",
          type: "unit",
          systemId: "multi",
          floorId,
          plane: "external-ground",
          geometry: { kind: "point", at: { x: 500, y: 1100 } },
          props: { role: "odu", model: "MXZ-5F100VGD" },
        },
        {
          id: "h-living",
          type: "unit",
          systemId: "multi",
          floorId,
          plane: "room",
          geometry: { kind: "point", at: { x: 500, y: 100 } },
          props: { role: "idu", model: "MSZ-AP35VGD2", roomId: "living" },
        },
      ],
    };
    expect(questionById(installQuestions(doc, pack, sys()), "outdoor-sits").hint).toBe(
      "The plan has it on the ground floor, outside"
    );

    // a hard drawn run of 100 units at 10 mm per unit is 1 m of copper
    const run = (form?: "soft"): DesignObject => ({
      id: "run-1",
      type: "pipe-run",
      systemId: "multi",
      floorId,
      plane: "room",
      geometry: {
        kind: "polyline",
        points: [
          { x: 500, y: 100 },
          { x: 500, y: 200 },
        ],
      },
      props: {
        startAttach: { kind: "unit", id: "h-living" },
        endAttach: { kind: "unit", id: "multi-odu" },
        ...(form ? { form } : {}),
      },
    });
    const hard = { ...doc, objects: [...doc.objects, run()] };
    expect(rowsNamed(equipmentList(hard, pack, sysOf(hard, "multi")).rows, "Lagging, hard drawn runs")).toEqual([
      { group: "Pipework", name: "Lagging, hard drawn runs", value: "1 m" },
    ]);
    expect(rowsNamed(equipmentList(hard, pack, sysOf(hard, "multi")).rows, "Copper and lagging")).toEqual([]);

    const soft = { ...doc, objects: [...doc.objects, run("soft")] };
    const coil = rowsNamed(equipmentList(soft, pack, sysOf(soft, "multi")).rows, "Pre-insulated coil");
    expect(coil).toHaveLength(1);
    expect(coil[0].value).toMatch(/^\d+(\.\d)? m$/);
    expect(rowsNamed(equipmentList(soft, pack, sysOf(soft, "multi")).rows, "Lagging, hard drawn runs")).toEqual([]);
  });
});

/* ── 6. model globs ── */

describe("matchesModelGlob", () => {
  it("matches an exact model or a prefix glob, case-sensitively", () => {
    expect(matchesModelGlob("MSZ-AP35VGD2", "MSZ-*")).toBe(true);
    expect(matchesModelGlob("MSZ-AP35VGD2", "MSZ-AP35VGD2")).toBe(true);
    expect(matchesModelGlob("MSZ-AP35VGD2", "MSZ-EF*")).toBe(false);
    expect(matchesModelGlob("PUZ-ZM125VKA2-A", "PUZ-ZM1*")).toBe(true);
    expect(matchesModelGlob("PUZ-ZM125VKA2-A", "PUZ-*")).toBe(true);
    expect(matchesModelGlob("PUZ-ZM125VKA2-A", "PUZ-ZM2*")).toBe(false);
    expect(matchesModelGlob("msz-ap35vgd2", "MSZ-*")).toBe(false);
    // a star anywhere but the end is not a glob the pack writes
    expect(matchesModelGlob("MSZ-AP35VGD2", "MSZ-*VGD2")).toBe(false);
  });

  it("reads the pack's accessories by compatibility and category", () => {
    expect(accessoriesFor(pack, "MSZ-AP35VGD2", "wifi").map((a) => a.model)).toEqual(["MAC-588IF-E"]);
    expect(accessoriesFor(pack, "MSZ-AP35VGD2", "wired-controller")[0].model).toBe("PAR-41MAA");
    expect(accessoriesFor(pack, "MSZ-AP35VGD2", "condensate-pump")).toEqual([]);
    expect(accessoriesFor(pack, "MXZ-5F100VGD", "drain-kit").map((a) => a.model)).toEqual(["PAC-SG60DS-E"]);
    // no category: everything compatible, in pack order
    expect(accessoriesFor(pack, "MXZ-5F100VGD").map((a) => a.model)).toContain("MAC-A455JP-E");
  });
});
