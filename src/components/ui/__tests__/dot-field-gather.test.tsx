import { act, render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { DotField, GATHER_MS } from "../dot-field";

/* THE WAY IN, and the two things about it a stylesheet cannot say.

   The travel itself is CSS — one keyframe, a per-dot delay, and a pair of
   custom properties naming the button. What lives in the component is the
   part that decides WHETHER it happens and WHEN it stops, and both of those
   are the kind of thing that breaks without anything throwing: a gather that
   never ends leaves the mark permanently mid-flight, and a gather that fires
   on every surface makes the debrief card grow a chevron flying in from a
   button that is not on the screen.

   `from` IS THE WHOLE SWITCH. It is the pressed button's offset, so its
   presence is the same question as "did a button open this" — which is why
   nothing here has a `gather` prop to get out of step with it. */

/* The field mounts inside a positioned card in the real app and reads its own
   offsets against it. jsdom reports 0 for every offset, which is fine: the
   numbers are the browser's business and the STAGE is this file's. */
function mount(from?: { dx: number; dy: number } | null) {
  const view = render(<DotField stage="mark" size={252} from={from} />);
  return {
    stage: () => document.querySelector(".dotf")?.getAttribute("data-stage"),
    view,
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("flies the mark in when a button opened it", () => {
  const f = mount({ dx: 663, dy: -387 });
  expect(f.stage()).toBe("gather");
});

/* THE FIELD LETS GO ON ITS OWN. Nothing outside it counts the arrival — the
   card would have to hold a timer that agreed with a keyframe in a different
   file, which is the sort of pair that drifts the first time either is
   touched. */
it("hands over to the resting mark once the last dot is seated", () => {
  const f = mount({ dx: 663, dy: -387 });

  act(() => void jest.advanceTimersByTime(GATHER_MS - 50));
  expect(f.stage()).toBe("gather");

  act(() => void jest.advanceTimersByTime(60));
  expect(f.stage()).toBe("mark");
});

/* Every surface that has no button to have flown out of: the debrief card,
   the note postures, a field's nudge. They get the mark as it always was. */
it("does not fly in where there is no button", () => {
  const f = mount(null);
  expect(f.stage()).toBe("mark");

  act(() => void jest.advanceTimersByTime(GATHER_MS + 100));
  expect(f.stage()).toBe("mark");
});

/* ONCE PER OPEN, AND ONLY ON THE WAY IN. Choosing Talk mid-flight swaps the
   body under the field and leaves the field mounted — the mark has to carry
   on arriving, not start again from the button, which is the whole reason the
   instrument is mounted above the stage branch in the first place. */
it("carries the same arrival through a stage change", () => {
  const from = { dx: 663, dy: -387 };
  const view = render(<DotField stage="mark" size={252} from={from} />);
  const stage = () => document.querySelector(".dotf")?.getAttribute("data-stage");

  act(() => void jest.advanceTimersByTime(300));
  expect(stage()).toBe("gather");

  // the card moves door -> recording; the field is told "mark" again
  act(() => view.rerender(<DotField stage="mark" size={252} from={from} />));
  expect(stage()).toBe("gather");

  // and it still ends when the ORIGINAL flight ends, not 300ms later
  act(() => void jest.advanceTimersByTime(GATHER_MS - 300 + 20));
  expect(stage()).toBe("mark");
});

/* A mark that has arrived stays arrived. There is no path back to it today —
   the field only ever runs forwards, mark to cloud to gone — but a `gather`
   replayed on the way OUT of a wait would be the entrance performing itself
   in the middle of a capture. */
it("never flies in a second time", () => {
  const from = { dx: 663, dy: -387 };
  const view = render(<DotField stage="mark" size={252} from={from} />);
  const stage = () => document.querySelector(".dotf")?.getAttribute("data-stage");

  act(() => void jest.advanceTimersByTime(GATHER_MS + 10));
  expect(stage()).toBe("mark");

  act(() => view.rerender(<DotField stage="cloud" size={252} from={from} />));
  expect(stage()).toBe("cloud");

  act(() => view.rerender(<DotField stage="mark" size={252} from={from} />));
  expect(stage()).toBe("mark");
});

/* The per-dot numbers the keyframes read. They are geometry, not state, so
   the only thing worth pinning here is that the component actually writes
   them out — a keyframe reading `var(--gd)` off an element that never got one
   falls back to 0, and every dot leaves at the same instant. */
it("writes the arrival order onto every dot", () => {
  mount({ dx: 663, dy: -387 });
  const cells = [...document.querySelectorAll<HTMLElement>(".dotf-cell")];
  expect(cells.length).toBeGreaterThan(80);

  for (const c of cells) {
    expect(c.style.getPropertyValue("--gd")).not.toBe("");
    expect(c.style.getPropertyValue("--bx")).not.toBe("");
    expect(c.style.getPropertyValue("--by")).not.toBe("");
  }
  const order = cells.map((c) => Number(c.style.getPropertyValue("--gd")));
  expect(Math.min(...order)).toBe(0);
  expect(Math.max(...order)).toBe(1);
});

/* ── THE SEAM, GUARDED IN THE STYLESHEET ──

   Isaac, watching it land on prod: "when the trail lands on the page,
   everything then readjusts to start the next part of the animation — it looks
   like a glitch."

   The swell carries a NEGATIVE per-dot delay, which is what runs the wave
   along the mark. Handed to a dot only once it was seated, that delay dropped
   it partway up its own curve — so at the hand-over every dot jumped from a
   flat `scale(1)` to anything between 62% and 175% of its size, in one frame.
   Measured on the real card: 109 dots, a median jump of 31% and a worst of
   75%. Nothing about it throws, and no test that renders markup can see it.

   The fix is that the swell never starts at the seam because it has been
   running since the dots left the button, and the arrival lives on a wrapper
   of its own so the two never share a property. Both halves are one selector
   each, and either one quietly narrowing puts the jump back — so they are
   pinned as text. jsdom cannot run a keyframe; it can read the rule. */
describe("the hand-over into the resting mark", () => {
  const css = readFileSync(
    join(process.cwd(), "src/app/dashboard/shell.css"),
    "utf8"
  );

  it("keeps the swell running through the arrival", () => {
    const rule = css.match(/([^\n]*)\s*\{\s*\n?\s*animation:dotfSwell[^}]*}/);
    expect(rule).not.toBeNull();
    // both stages, or the wave starts at the seam and the mark resizes
    expect(rule![1]).toContain('data-stage="gather"');
    expect(rule![1]).toContain('data-stage="mark"');
  });

  it("keeps the arrival off the element the swell is on", () => {
    const rule = css.match(/([^\n]*)\s*\{\s*\n?\s*animation:dotfArrive[^}]*}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain(".dotf-wander");
    // sharing `transform` with the swell is the whole bug, in one selector
    expect(rule![1]).not.toMatch(/\.dotf-cell\s+i/);
  });

  /* It has to end at the wrapper's own resting values, or removing the
     animation snaps back from wherever it stopped — the same jump, moved one
     element down. */
  it("lands the arrival on nothing at all", () => {
    const frames = css.match(/@keyframes dotfArrive\s*\{([^}]*\}[^}]*\}[^}]*\})/);
    expect(frames).not.toBeNull();
    expect(frames![1]).toMatch(/100%\s*\{\s*opacity:1;\s*transform:scale\(1\)\s*\}/);
  });
});
