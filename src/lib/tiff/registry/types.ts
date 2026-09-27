/* WHAT A TIFF TOOL IS — the one registry every Tiff phase adds to.

   The universal-Tiff plan (docs/universal-tiff-phase-1-spec.md): every thing
   Tiff can do is a descriptor here, run with the asker's identity and gated
   the way its screen is. The loop never writes a table itself; a tool calls
   the reader or the action a screen would call, and that code keeps its own
   checks.

   PHASE 1 HOLDS ONLY `read` AND `screen` TOOLS. The other two risks are named
   now so the type does not change shape when Phase 3 and 4 arrive, and a
   guard in the registry's tests fails if one appears early. Fields only a
   later phase needs (an undo, examples, strict schemas) arrive with the first
   tool that uses them. */

import type { Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/** What running a tool can do. read: nothing changes. screen: the page moves.
    reversible: a write with an undo. confirm: a write that waits for a yes. */
export type Risk = "read" | "screen" | "reversible" | "confirm";

/** Who is asking, built once per request (./viewer). */
export type Viewer = {
  orgId: string;
  /** The Auth0 subject. */
  userId: string;
  /** staff_profiles.id, when they have a card. */
  staffId: string | null;
  role: Role | null;
  caps: ReadonlySet<Capability>;
  /** The workspace's clock, and its date on that clock. */
  tz: string | null;
  today: string;
};

/** Who may hold a tool. `open` is anyone signed in to the workspace. */
export type Gate =
  | { open: true }
  | { capability: Capability }
  | { anyOf: readonly Capability[] };

/** What a tool hands back: data for the model, or a place to move to. */
export type Outcome =
  | { kind: "result"; value: unknown }
  | { kind: "screen"; href: string; label: string; line: string };

export type TiffTool = {
  /** ^[a-z][a-z0-9_]{1,63}$ — the registry's tests hold it. */
  name: string;
  /** What the person would see while it runs, present tense, no jargon. */
  label: string;
  /** For the model: when to use it, and when not. */
  description: string;
  risk: Risk;
  gate: Gate;
  inputSchema: Record<string, unknown>;
  /** `input` is already validated against the schema by the API; `run`
      still treats it as data. */
  run: (viewer: Viewer, input: Record<string, unknown>) => Promise<Outcome>;
};
