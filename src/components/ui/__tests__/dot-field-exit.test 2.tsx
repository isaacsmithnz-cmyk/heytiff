import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { FALL_MS, useDotFieldExit, type DotFieldStage } from "../dot-field";

/* THE FIELD'S EXIT, which had no test at all.

   `useDotFieldExit` is the only stateful thing in the dot field: it holds the
   last live stage on screen long enough for the drop to play, because the card
   that owns the field unmounts the moment the wait ends and an unmounted
   element cannot animate. Everything else in that file is arithmetic.

   It shipped deriving that stage in an EFFECT, which put main's CI red on
   `react-hooks/set-state-in-effect` and was not a style complaint: React
   rendered two hundred dots once with the stale stage, ran the effect, and
   rendered them again — at the exact frame the mark becomes a cloud. #420
   moved the derivation into the render body, where it belongs.

   These tests came AFTER that fix, because the hook had none either way, and
   the shape it moved to is an easy one to get subtly wrong: a missed guard
   loops forever, and the drop is the kind of thing that silently stops
   happening. They describe the contract, not the implementation, so they hold
   whichever way the derivation is written.

   THE CONTRACT, in the four cases that exist:

     live is a stage        → show it, and remember whether it was a cloud
     cloud → null           → show "fall" for FALL_MS, then nothing
     mark → null            → show nothing at once; a mark has nowhere to fall
     null → cloud mid-fall  → the drop is abandoned, not queued behind
*/

/** Renders the hook and reports what it returned on the latest render. */
function harness(initial: DotFieldStage | null) {
  const seen: (DotFieldStage | null)[] = [];
  function Probe({ live }: { live: DotFieldStage | null }) {
    seen.push(useDotFieldExit(live));
    return null;
  }
  const view = render(<Probe live={initial} />);
  return {
    seen,
    now: () => seen[seen.length - 1],
    set: (live: DotFieldStage | null) => act(() => view.rerender(<Probe live={live} />)),
    renders: () => seen.length,
    unmount: () => view.unmount(),
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("useDotFieldExit", () => {
  it("passes a live stage straight through", () => {
    const h = harness("mark");
    expect(h.now()).toBe("mark");
    h.set("cloud");
    expect(h.now()).toBe("cloud");
    h.unmount();
  });

  /* THE WHOLE REASON THE HOOK EXISTS. The caller drops `live` to null the
     instant the answer lands; the field has to stay mounted for the drop. */
  it("holds a cloud on screen for the drop, then lets go", () => {
    const h = harness("cloud");
    h.set(null);
    expect(h.now()).toBe("fall");

    act(() => void jest.advanceTimersByTime(FALL_MS - 1));
    expect(h.now()).toBe("fall"); // still falling one tick short

    act(() => void jest.advanceTimersByTime(1));
    expect(h.now()).toBeNull();
    h.unmount();
  });

  /* "Only a cloud has anywhere to fall from" — a recording abandoned before
     the mic closes goes with the card rather than performing an exit. */
  it("drops a mark instantly, with no fall", () => {
    const h = harness("mark");
    h.set(null);
    expect(h.now()).toBeNull();

    act(() => void jest.advanceTimersByTime(FALL_MS * 2));
    expect(h.now()).toBeNull(); // and nothing appears later
    h.unmount();
  });

  it("abandons the drop if the wait starts again mid-fall", () => {
    const h = harness("cloud");
    h.set(null);
    expect(h.now()).toBe("fall");

    act(() => void jest.advanceTimersByTime(FALL_MS / 2));
    h.set("cloud");
    expect(h.now()).toBe("cloud");

    /* the timer from the abandoned fall must not fire underneath the new one */
    act(() => void jest.advanceTimersByTime(FALL_MS));
    expect(h.now()).toBe("cloud");
    h.unmount();
  });

  /* A cloud that was never a cloud again: once it has fallen and gone, a fresh
     mark must not inherit the old flag and fall a second time. */
  it("forgets the cloud once a mark has replaced it", () => {
    const h = harness("cloud");
    h.set(null);
    act(() => void jest.advanceTimersByTime(FALL_MS));
    expect(h.now()).toBeNull();

    h.set("mark");
    h.set(null);
    expect(h.now()).toBeNull(); // a mark, so no drop
    h.unmount();
  });

  it("mounts straight into a cloud and still knows it was one", () => {
    const h = harness("cloud"); // no mark ever seen
    h.set(null);
    expect(h.now()).toBe("fall");
    h.unmount();
  });

  /* THE COST THE LINT RULE IS ABOUT, and the assertion has to be made on what
     COMMITS rather than on what renders.

     Deriving the stage in an effect committed twice for one change: React
     painted the field with the stale stage, then the effect set state and it
     painted again — two commits of two hundred dots at the frame the mark
     becomes a cloud. Adjusting during render also re-runs the component, but
     React throws the first pass away BEFORE committing, so nothing reaches the
     DOM twice.

     A probe that records during render sees both passes and cannot tell the
     two apart — it reports ["mark","cloud"] either way, because one of those
     is a render that was discarded. Counting commits is what separates them,
     and it is also what the user's eye is actually counting. */
  it("commits once for a stage change, not twice", () => {
    const committed: (string | null)[] = [];
    function Probe({ live }: { live: DotFieldStage | null }) {
      const stage = useDotFieldExit(live);
      useEffect(() => {
        committed.push(stage);
      });
      return <span data-testid="f" data-stage={String(stage)} />;
    }
    const view = render(<Probe live="mark" />);
    expect(committed).toEqual(["mark"]);

    act(() => view.rerender(<Probe live="cloud" />));
    /* one commit, and it is the new stage — never the stale one in between */
    expect(committed).toEqual(["mark", "cloud"]);
    expect(view.getByTestId("f").getAttribute("data-stage")).toBe("cloud");
    view.unmount();
  });

  it("cleans its timer up on unmount", () => {
    const h = harness("cloud");
    h.set(null);
    expect(h.now()).toBe("fall");
    h.unmount();
    // the pending fall timer must not fire into an unmounted tree
    expect(() => act(() => void jest.advanceTimersByTime(FALL_MS))).not.toThrow();
  });
});
