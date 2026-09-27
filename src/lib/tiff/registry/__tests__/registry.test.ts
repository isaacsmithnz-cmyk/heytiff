/**
 * @jest-environment node
 */
/* THE REGISTRY'S OWN GUARDS (docs/universal-tiff-phase-1-spec.md, PR 1A).

   Each of these was seen failing once, against a deliberate break, before it
   counted. They hold the shape of the thing every later phase adds to: one
   name per tool, only reads and screen moves in Phase 1, the gates doing the
   filtering, and nothing destructive imported where a model could reach it. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// the readers reach Supabase at import; nothing here runs one
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { TIFF_TOOLS, passes, runTool, toolDefs, toolsFor, type Viewer } from "..";

const viewer = (caps: string[]): Viewer => ({
  orgId: "org-1",
  userId: "auth0|u1",
  staffId: null,
  role: "staff",
  caps: new Set(caps) as Viewer["caps"],
  tz: "Australia/Sydney",
  today: "2026-09-27",
});

describe("the registry's shape", () => {
  it("has one tool per name, each a name the API takes", () => {
    const names = TIFF_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
  });

  it("holds only reads and screen moves in Phase 1: no tool that writes", () => {
    for (const t of TIFF_TOOLS) expect(["read", "screen"]).toContain(t.risk);
  });

  it("gives every tool a label a person could read and a description the model can act on", () => {
    for (const t of TIFF_TOOLS) {
      expect(t.label.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
});

describe("the gates", () => {
  it("open, one capability, or any of several", () => {
    const v = viewer(["tiff"]);
    expect(passes({ open: true }, v)).toBe(true);
    expect(passes({ capability: "tiff" }, v)).toBe(true);
    expect(passes({ capability: "workboard" }, v)).toBe(false);
    expect(passes({ anyOf: ["team", "tiff"] }, v)).toBe(true);
    expect(passes({ anyOf: ["team", "workboard"] }, v)).toBe(false);
  });

  it("a workboard-only viewer holds the four workboard reads and not the library", () => {
    expect(toolsFor(viewer(["workboard"])).map((t) => t.name)).toEqual([
      "job_history",
      "search_jobs",
      "open_task_load",
      "issue_log",
    ]);
  });

  it("a library-only viewer holds kb_search alone", () => {
    expect(toolsFor(viewer(["tiff"])).map((t) => t.name)).toEqual(["kb_search"]);
  });

  it("a viewer with neither holds no read", () => {
    expect(toolsFor(viewer([])).filter((t) => t.risk === "read")).toEqual([]);
  });

  it("shapes definitions in registry order, for a stable cache prefix", () => {
    const defs = toolDefs(TIFF_TOOLS);
    expect(defs.map((d) => d.name)).toEqual(TIFF_TOOLS.map((t) => t.name));
    for (const d of defs) expect(d.input_schema).toHaveProperty("type", "object");
  });
});

describe("running a tool", () => {
  it("an unknown name is an error value, never a throw", async () => {
    expect(await runTool(viewer(["workboard"]), "drop_tables", {}, TIFF_TOOLS)).toEqual({
      ok: false,
      error: "No such tool: drop_tables",
    });
  });

  it("a tool the viewer doesn't hold is unknown to them", async () => {
    const v = viewer(["tiff"]);
    expect(await runTool(v, "issue_log", {}, toolsFor(v))).toEqual({
      ok: false,
      error: "No such tool: issue_log",
    });
  });
});

/* WHAT THE REGISTRY MAY IMPORT. A tool is only as safe as what its `run`
   can reach, and a list of forbidden tool NAMES can't see an import. So this
   reads the registry's own source: no integration settings, no ownership
   transfer, no staff-record writes (the permissions write lives in
   saveStaffSection's access section), and no export named like a delete,
   unless it is allowlisted here with the reason. */
const REGISTRY = path.resolve(__dirname, "..");
const FORBIDDEN_MODULES = [
  "@/app/actions/integrations",
  "@/app/actions/org-ownership",
  "@/app/actions/staff",
];
const DESTRUCTIVE = /^(delete|remove|clear|takeBack)[A-Z]/;
const ALLOWED: Record<string, string> = {};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : sources(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

function importsOf(code: string): { from: string; names: string[] }[] {
  const out: { from: string; names: string[] }[] = [];
  const re = /import\s+(?:type\s+)?(?:\{([^}]*)\}|[\w*\s,]+)?\s*from\s*["']([^"']+)["']/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const names = (m[1] ?? "")
      .split(",")
      .map((n) => n.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ from: m[2], names });
  }
  return out;
}

describe("what the registry may import", () => {
  it("reads its imports the way the guard needs", () => {
    expect(importsOf('import { deleteTask, addTask as a } from "@/app/actions/dashboard";')).toEqual([
      { from: "@/app/actions/dashboard", names: ["deleteTask", "addTask"] },
    ]);
  });

  it("imports no integration settings, ownership or staff-record writes, and nothing named like a delete", () => {
    const bad: string[] = [];
    for (const file of sources(REGISTRY)) {
      for (const imp of importsOf(readFileSync(file, "utf8"))) {
        if (FORBIDDEN_MODULES.some((m) => imp.from === m || imp.from.startsWith(`${m}.`))) {
          bad.push(`${path.relative(REGISTRY, file)} imports ${imp.from}`);
        }
        for (const n of imp.names) {
          if (DESTRUCTIVE.test(n) && !ALLOWED[n]) bad.push(`${path.relative(REGISTRY, file)} imports ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
