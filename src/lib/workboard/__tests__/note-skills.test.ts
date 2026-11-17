import { confirmAsk, confirms, linesOf, skillGap, skillRow, skillsFromCalls, skillsOf, SKILL_KINDS, SKILL_TOOLS } from "../note-skills";
import { noteTools, rawFromCalls, shapeProposal, type NoteContext } from "../note-brain";
import { planRows, storedProposal, toDraft, withoutRows } from "../note-draft";
import { variationFields } from "../note-variation";
import { planView } from "@/components/tiff/modal/plan-view";

const ctx: NoteContext = {
  staff: [
    { id: "s-isaac", fullName: "Isaac Smith" },
    { id: "s-luke", fullName: "Luke Brown" },
  ],
  author: { id: "s-isaac", fullName: "Isaac Smith" },
  todayISO: "2026-11-18",
};

describe("the skills' tools", () => {
  it("are each a tool, not strict, with every field required", () => {
    const tools = noteTools(true);
    for (const kind of SKILL_KINDS) {
      const t = tools.find((x) => x.name === kind)!;
      expect(t).toBeTruthy();
      expect((t as { strict?: boolean }).strict).toBeUndefined();
      const item = SKILL_TOOLS[kind].item;
      expect(item.required).toEqual(Object.keys(item.properties));
    }
  });
});

describe("the mock's wrap-up, read back", () => {
  const calls = [
    { name: "time_on_job", input: { items: [{ from: "08:00", until: "11:00" }] } },
    { name: "used", input: { items: [{ what: "3/8 5/8 pair coil", qty: 14, unit: "m" }, { what: "wall bracket", qty: 2, unit: "" }] } },
    { name: "photo_request", input: { items: [{ what: "the switchboard" }] } },
    { name: "job_status", input: { items: [{ to: "completed" }] } },
    { name: "job_note", input: { text: "Pipes done." } },
  ];
  const p = shapeProposal(rawFromCalls(calls), ctx, "");

  it("keeps every skill, the speaker's time on the speaker", () => {
    expect(p.skills?.map((s) => s.kind)).toEqual(["time_on_job", "used", "used", "photo_request", "job_status"]);
    expect(p.skills?.[0]!.whoId).toBe("s-isaac");
  });

  it("draws the rows the mock drew", () => {
    const rows = planView(p, ctx.staff, true);
    expect(rows.map((r) => `${r.lead}, ${r.text}${r.needs ? " · Needs an answer" : ""}`)).toEqual([
      "Isaac, on the job today, 8:00 to 11:00",
      "Used, 3/8 5/8 pair coil, 14 m",
      "Used, wall bracket, 2",
      "Photo, the switchboard, next visit",
      "Job, Completed · Needs an answer",
    ]);
  });

  it("survives being stored, and a cross takes one off", () => {
    const stored = storedProposal(JSON.parse(JSON.stringify(p)))!;
    expect(stored.skills).toEqual(p.skills);
    const key = planRows(stored).find((r) => r.lane === "skills" && r.index === 2)!.key;
    expect(withoutRows(toDraft(stored), [key]).skills.map((s) => s.on)).toEqual([true, true, false, true, true]);
  });
});

describe("checks", () => {
  it("drops a skill that says nothing it could do", () => {
    expect(skillsFromCalls([{ name: "used", input: { items: [{ what: "", qty: 3, unit: "" }] } }])).toEqual([]);
    expect(skillsFromCalls([{ name: "time_on_job", input: { items: [{ from: "11:00", until: "08:00" }] } }])).toEqual([]);
    expect(skillsFromCalls([{ name: "block_out", input: { items: [{ who_hint: "", day: "Friday", start: "12:00", end: "15:30", what: "dentist" }] } }])).toEqual([]);
  });

  it("asks how many when no number was said", () => {
    const [u] = skillsOf([{ kind: "used", what: "wall bracket", qty: 0, unit: "" }]);
    expect(skillGap(u!)).toBe("How many wall bracket did you use?");
  });

  it("asks first for a status and a new job, only", () => {
    expect(confirms({ kind: "job_status", to: "completed" })).toBe(true);
    expect(confirms({ kind: "new_job", work: "split", address: "32 Glen St", client: "Jenny", phone: "", email: "" })).toBe(true);
    expect(confirms({ kind: "site_note", text: "Dog in the yard" })).toBe(false);
    expect(confirmAsk({ kind: "job_status", to: "completed" }, "3054")).toEqual({ question: "Mark 3054 Completed?", yes: "Mark it Completed", no: "Leave it" });
  });

  it("blocks out the dentist on a Friday", () => {
    const [b] = skillsFromCalls([{ name: "block_out", input: { items: [{ who_hint: "", day: "2026-11-20", start: "12:00", end: "15:30", what: "dentist" }] } }]);
    expect(skillRow(b!, "Isaac")).toEqual({ lead: "Isaac", text: "blocked out Fri 12:00 to 3:30, dentist", needs: false });
  });
});

describe("Dan Brad's variation, with its lines", () => {
  const said = { what: "replace 2 ceiling fans and move a tap", lines: [{ kind: "labour", what: "move the tap", hours: 1, qty: 0 }, { kind: "labour", what: "replace 2 ceiling fans", hours: 2, qty: 0 }] };

  it("keeps the labour lines, no materials", () => {
    expect(variationFields(said)).toEqual({ what: said.what, lines: [{ kind: "labour", what: "move the tap", hours: 1, qty: 0 }, { kind: "labour", what: "replace 2 ceiling fans", hours: 2, qty: 0 }] });
  });

  it("says its hours on the row", () => {
    const p = shapeProposal(rawFromCalls([{ name: "variations", input: { items: [said] } }]), ctx, "");
    expect(planView(p, ctx.staff, false)[0]!.text).toBe("replace 2 ceiling fans and move a tap, 3 h labour");
  });

  it("drops a labour line with no hours", () => {
    expect(linesOf([{ kind: "labour", what: "fans", hours: 0, qty: 0 }])).toEqual([]);
  });
});
