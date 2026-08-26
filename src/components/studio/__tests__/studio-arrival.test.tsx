/* WHAT A `?design=<id>` ARRIVAL LOOKS LIKE WHILE IT IS STILL LOADING.

   The existing deep-link tests assert where you END UP, with `findBy` waiting
   out the load. This one asserts what is ON SCREEN in between, which is the
   part a person actually experiences on a reload: the studio renders
   `doc ? <Editor/> : <Home/>`, and during an arrival `doc` is still null — so
   the index paints, list of designs and all, and the design pops in over it a
   moment later. It reads as "the reload lost my design" even though it did
   not, which is exactly how it was reported. */

import { render, screen, waitFor } from "@testing-library/react";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { createDesign, type DesignDocument } from "@/lib/studio/document";

/** a store whose `load` hangs until the test lets it finish */
class HeldStore extends LocalDesignStore {
  release!: (d: DesignDocument | null) => void;
  private held = new Promise<DesignDocument | null>((res) => {
    this.release = res;
  });
  load(): Promise<DesignDocument | null> {
    return this.held;
  }
}

describe("arriving on ?design=<id>", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/studio");
  });

  it("does not show the Home index while the design is loading", async () => {
    const store = new HeldStore(window.localStorage);
    const doc = createDesign({ name: "Farran St", mode: "blank" });
    render(<Studio store={store} openDesignId={doc.id} />);

    // mid-arrival: the index must not be what a reload paints
    expect(screen.queryByText("New design")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent designs")).not.toBeInTheDocument();

    store.release(doc);
    expect(await screen.findByLabelText("Design name")).toHaveValue("Farran St");
  });

  /* and the id that could not be opened still lands on Home saying so — the
     holding screen must not swallow the failure it was added to cover */
  it("still falls back to Home when the id is not there", async () => {
    const store = new HeldStore(window.localStorage);
    render(<Studio store={store} openDesignId="gone" />);

    store.release(null);
    await waitFor(() => expect(screen.getByText("New design")).toBeInTheDocument());
  });
});
