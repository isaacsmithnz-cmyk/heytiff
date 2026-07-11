/* System-module registry (flow rework): split is the only live module; the
   rest are registered-but-coming so the chooser can offer them. */

import {
  SYSTEM_MODULES,
  MODULE_ORDER,
  moduleFor,
  availableModules,
} from "../modules";
import type { SystemType } from "../document";

describe("system module registry", () => {
  it("covers every SystemType exactly once, in order", () => {
    const types: SystemType[] = [
      "split",
      "multi-split",
      "ducted",
      "vrf",
      "ventilation",
      "sheet-metal",
    ];
    expect([...MODULE_ORDER].sort()).toEqual([...types].sort());
    for (const t of types) expect(SYSTEM_MODULES[t].type).toBe(t);
  });

  it("split is the only available module today", () => {
    expect(availableModules().map((m) => m.type)).toEqual(["split"]);
    expect(moduleFor("split").available).toBe(true);
    expect(moduleFor("split").unitFlow).toBe("pair");
    expect(moduleFor("split").roomScope).toBe("single");
  });

  it("unavailable modules declare their arrival stage", () => {
    for (const m of Object.values(SYSTEM_MODULES)) {
      if (!m.available) expect(m.comingStage).toMatch(/^Stage \d+$/);
    }
    expect(moduleFor("multi-split").comingStage).toBe("Stage 5");
    expect(moduleFor("vrf").summary).toBe("capacity");
    expect(moduleFor("ducted").summary).toBe("ducted");
  });
});
