/* The Simulate readiness verdict. It is derived in the Editor (buildSimModel
   over the active floor) and read by the Summary; the action card that once
   rendered it went on 2026-10-18, since nothing drew it. */

export interface SimReady {
  ok: boolean;
  /** why not, when !ok — shown in place of the pitch line */
  reason: string;
  /** the floor toggleSim will run — named so the button says what it does */
  floorName: string;
}
