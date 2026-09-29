/* System-module registry: every system type declares how it gathers its
   indoor units, which coverage, pipe sizing and placement read. */

import { SYSTEM_MODULES, moduleFor } from "../modules";
import type { SystemType } from "../document";

describe("system module registry", () => {
  it("covers every SystemType exactly once", () => {
    const types: SystemType[] = [
      "split",
      "multi-split",
      "ducted",
      "vrf",
      "ventilation",
      "sheet-metal",
    ];
    expect(Object.keys(SYSTEM_MODULES).sort()).toEqual([...types].sort());
    for (const t of types) expect(SYSTEM_MODULES[t].type).toBe(t);
  });

  it("declares each type's unit flow", () => {
    expect(moduleFor("split").unitFlow).toBe("pair");
    expect(moduleFor("multi-split").unitFlow).toBe("per-room");
    expect(moduleFor("vrf").unitFlow).toBe("per-room");
    expect(moduleFor("ducted").unitFlow).toBe("ducted");
  });
});
