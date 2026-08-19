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

/* ── THE RECORD AND THE ARRIVAL ARE TWO DIFFERENT THINGS ──

   `said` is what is already captured — an earlier leg, or words typed before
   the mic opened. It has been read already, so it never glides and it is not
   split into words: it is one span of ink the new words join onto, which is
   `appendSpoken`'s join kept by construction rather than by calling it. */
it("keeps what was already said out of the words that are arriving", () => {
  render(<LiveWords said="middle rooftop unit tripped again" text="tell Luke" />);

  expect(document.querySelector(".wb2-lwsaid")).toHaveTextContent(
    "middle rooftop unit tripped again"
  );
  expect(words().map((w) => w.textContent)).toEqual(["tell", "Luke"]);
});

it("shows no record at all when there is nothing already said", () => {
  render(<LiveWords text="tell Luke" />);
  expect(document.querySelector(".wb2-lwsaid")).toBeNull();
});

/* ── A BURST ARRIVES AS A FLOW, NOT AS A BLOCK ──

   Scribe lands three words on one message. The glide was already per word,
   but with every word in the burst starting on the same frame it read as a
   block appearing — the "jumpy" this fixes (Isaac, 2026-08-19). Stepping the
   delay is what turns the burst back into speech arriving.

   jsdom runs no animation, but the delay is a style it can read, and that is
   the whole of the mechanism. Words already on screen keep whatever they
   landed with: re-timing a word mid-read would re-run the glide on it. */
it("steps the words that arrived together, and leaves the ones already read", () => {
  const { rerender } = render(<LiveWords text="tell" />);
  expect(words().map((w) => (w as HTMLElement).style.animationDelay)).toEqual(["0ms"]);

  rerender(<LiveWords text="tell Luke the grilles need replacing" />);
  expect(words().map((w) => (w as HTMLElement).style.animationDelay)).toEqual([
    "0ms",
    "0ms",
    "42ms",
    "84ms",
    "126ms",
    "168ms",
  ]);
});

/* The pre-roll can land a whole sentence at once, and a flat step would leave
   its tail drifting in a second behind the voice that said it. */
it("caps the step so a long burst still keeps up with the voice", () => {
  render(<LiveWords text="one two three four five six seven eight nine ten" />);
  const delays = words().map((w) => (w as HTMLElement).style.animationDelay);

  expect(delays[5]).toBe("210ms");
  expect(delays.at(-1)).toBe("210ms");
});

/* THE BOX RIDES THE NEWEST WORD. It is a fixed three-line window, so the
   words being spoken are only on screen if it is scrolled to the bottom —
   and the ride has to happen in a LAYOUT effect, before the frame is painted,
   or it is a visible snap on every partial. */
it("scrolls to the newest word", () => {
  const el = () => document.querySelector(".wb2-livetext") as HTMLElement;
  const { rerender } = render(<LiveWords text="tell" />);
  /* jsdom lays nothing out, so the heights are stated here — the assertion is
     that the component acts on them, not that jsdom can wrap text. */
  Object.defineProperty(el(), "scrollHeight", { value: 200, configurable: true });
  Object.defineProperty(el(), "clientHeight", { value: 65, configurable: true });

  rerender(<LiveWords text="tell Luke" />);

  expect(el().scrollTop).toBe(200);
  /* …and once something has gone out of sight above, the top fades rather
     than being sliced. */
  expect(el().className).toContain("over");
});
