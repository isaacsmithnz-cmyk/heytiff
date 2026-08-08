import { cleanup, render, screen } from "@testing-library/react";
import { LiveWords } from "../dictation";

/* THE LIVE TRANSCRIPT, WORD BY WORD.

   The engine does not speak evenly: Scribe sends partials in bursts and
   REVISES them — three words land at once, then a pause, then "grills"
   becomes "grilles". Rendering the whole thing as one string meant every
   one of those swapped the paragraph, which read as flicker.

   The fix is a rendering decision, and it is the kind that looks like a
   detail and is actually the whole behaviour: words are keyed by POSITION,
   so React mounts only the spans just appended. jsdom cannot see a CSS
   animation, but it can see the thing the animation hangs off — whether a
   span is the same DOM node as it was a moment ago. A word that survives is
   a word that does not re-glide.

   That is why these assert node IDENTITY rather than class names. Key by
   the word's text instead and every repeat of "the" collides; key by
   something fresh each render and the entire line re-animates on every
   partial, which is the erratic behaviour this replaced. */

const words = () => Array.from(document.querySelectorAll(".wb2-lw"));

afterEach(cleanup);

it("splits the line into one span per word", () => {
  render(<LiveWords text="tell Luke about the grilles" />);
  expect(words().map((w) => w.textContent)).toEqual([
    "tell",
    "Luke",
    "about",
    "the",
    "grilles",
  ]);
});

it("keeps the words already said, and mounts only what arrived", () => {
  const { rerender } = render(<LiveWords text="tell Luke" />);
  const before = words();
  expect(before).toHaveLength(2);

  rerender(<LiveWords text="tell Luke about the grilles" />);
  const after = words();

  expect(after).toHaveLength(5);
  /* The same nodes, not merely the same text — a remount here would
     re-run the glide on words the person finished reading a second ago. */
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
});

/* Scribe revises what it already sent. The corrected word must change in
   place: re-mounting it would flash a word mid-sentence, which is worse
   than the wrong word was. */
it("corrects a word without re-mounting it", () => {
  const { rerender } = render(<LiveWords text="order the grills" />);
  const before = words();

  rerender(<LiveWords text="order the grilles" />);
  const after = words();

  expect(after[2]).toBe(before[2]);
  expect(after[2].textContent).toBe("grilles");
});

it("ignores the engine's stray whitespace rather than rendering empty words", () => {
  render(<LiveWords text="  tell   Luke  " />);
  expect(words().map((w) => w.textContent)).toEqual(["tell", "Luke"]);
});

/* The words are what the person is checking while they talk, so they are
   announced — but the paragraph is one region, not one per word. */
it("stays a single polite region", () => {
  render(<LiveWords text="tell Luke" />);
  const region = screen.getByText(/tell/).closest("p");
  expect(region).toHaveAttribute("aria-live", "polite");
  expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
});
