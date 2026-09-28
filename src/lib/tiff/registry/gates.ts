import type { Gate, Viewer } from "./types";

/** Does this viewer pass this gate? */
export function passes(gate: Gate, viewer: Viewer): boolean {
  if ("open" in gate) return true;
  if ("capability" in gate) return viewer.caps.has(gate.capability);
  return gate.anyOf.some((c) => viewer.caps.has(c));
}
