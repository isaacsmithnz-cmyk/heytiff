/* Server-backed DesignStore, calling the studio Server Functions. The actions
   module is imported lazily so this file (and everything that imports it) can
   load in environments without the server runtime (jest/jsdom) — errors
   surface as rejected promises, which SyncedDesignStore treats as offline. */

import type { DesignDocument } from "./document";
import { migrateDesign } from "./migrations";
import type { DesignStore, DesignSummary } from "./store";

const actions = () => import("@/app/actions/studio");

export class RemoteDesignStore implements DesignStore {
  async list(): Promise<DesignSummary[]> {
    return (await actions()).listStudioDesigns();
  }

  async load(id: string): Promise<DesignDocument | null> {
    const raw = await (await actions()).loadStudioDesign(id);
    if (raw == null) return null;
    // server rows migrate on open exactly like imported files
    return migrateDesign(raw).doc;
  }

  async save(doc: DesignDocument): Promise<void> {
    await (await actions()).saveStudioDesign(doc);
  }

  async remove(id: string): Promise<void> {
    await (await actions()).deleteStudioDesign(id);
  }
}
