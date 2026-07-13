import {
  buildSimModel,
  carryState,
  initSimState,
  simTick,
  type SimFan,
  type SimMode,
  type SimModel,
  type SimState,
} from "./sim";
import type { DesignDocument } from "./document";
import type { DataPack } from "./packs/schema";

/* The one mutable object of the simulation: owns the derived model + the
   ephemeral state, is advanced by the overlay's rAF loop, and notifies UI
   subscribers at a throttled cadence so a 60 fps tick never becomes 60 fps
   React renders. Holds NO reference it could write the document through. */

const NOTIFY_EVERY_S = 0.25;

export class SimRuntime {
  model: SimModel;
  state: SimState;
  private listeners = new Set<() => void>();
  private sinceNotify = 0;

  constructor(doc: DesignDocument, pack: DataPack | null, floorId: string, outdoorC: number) {
    this.model = buildSimModel(doc, pack, floorId);
    this.state = initSimState(this.model, { outdoorC });
  }

  /** doc changed while simulating — re-derive, keep temps + settings */
  rebuild(doc: DesignDocument, pack: DataPack | null, floorId: string): void {
    this.model = buildSimModel(doc, pack, floorId);
    this.state = carryState(this.model, this.state);
    this.notify();
  }

  /** advance both clocks; called once per animation frame */
  advance(dtRealS: number): void {
    this.state = simTick(this.model, this.state, dtRealS);
    this.sinceNotify += dtRealS;
    if (this.sinceNotify >= NOTIFY_EVERY_S) {
      this.sinceNotify = 0;
      this.notify();
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private patchHandler(id: string, patch: Partial<SimState["handlers"][string]>): void {
    const h = this.state.handlers[id];
    if (!h) return;
    this.state = {
      ...this.state,
      handlers: { ...this.state.handlers, [id]: { ...h, ...patch } },
    };
    this.notify();
  }

  setOn(id: string, on: boolean): void {
    const h = this.model.handlers.find((x) => x.id === id);
    if (on && h) {
      // power-on re-baselines the room so the fill-front grows from here
      this.state = {
        ...this.state,
        baselineC: { ...this.state.baselineC, [h.roomId]: this.state.roomTempC[h.roomId] },
      };
    }
    this.patchHandler(id, { on });
  }
  setMode(id: string, mode: SimMode): void {
    this.patchHandler(id, { mode });
  }
  setSetpoint(id: string, setpointC: number): void {
    this.patchHandler(id, { setpointC: Math.round(setpointC * 2) / 2 });
  }
  setFan(id: string, fan: SimFan): void {
    this.patchHandler(id, { fan });
  }
  setOutdoor(outdoorC: number): void {
    this.state = { ...this.state, outdoorC };
    this.notify();
  }
  setSpeed(speed: number): void {
    this.state = { ...this.state, speed };
    this.notify();
  }
  setPaused(paused: boolean): void {
    this.state = { ...this.state, paused };
    this.notify();
  }
}
