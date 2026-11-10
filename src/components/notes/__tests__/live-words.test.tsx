import { cleanup, render, screen } from "@testing-library/react";
import { LiveWords } from "../dictation";

/* THE LIVE TRANSCRIPT, WORD BY WORD.

   The engine does not speak evenly: Scribe sends partials in bursts and
   REVISES them — three words land at once, then a pause, then "grills"
   becomes "grilles". Rendering the whole thing as one string meant every
   one of those swapped the paragraph, which read as flicker.

   The fix is a rendering decision, and it is the kind that looks like a
   detail and is actually the whole behaviour: words are keyed by WHO THEY
   ARE, matched against the guess before, so React mounts only the words
   that are new. jsdom cannot see a CSS
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
  render(<LiveWords text="tell Lyle about the grilles" />);
  expect(words().map((w) => w.textContent)).toEqual([
    "tell",
    "Lyle",
    "about",
    "the",
    "grilles",
  ]);
});

it("keeps the words already said, and mounts only what arrived", () => {
  const { rerender } = render(<LiveWords text="tell Lyle" />);
  const before = words();
  expect(before).toHaveLength(2);

  rerender(<LiveWords text="tell Lyle about the grilles" />);
  const after = words();

  expect(after).toHaveLength(5);
  /* The same nodes, not merely the same text — a remount here would
     re-run the glide on words the person finished reading a second ago. */
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
});

/* Scribe revises what it already sent. The corrected word is a new word,
   and glides in where the old one stood, as the phone melts it in (Isaac,
   5 November 2026: "morphing into the correct word", then "line them up");
   the words either side of it stay put. */
it("glides a corrected word in, and leaves its neighbours be", () => {
  const { rerender } = render(<LiveWords text="order the grills today" />);
  const before = words();

  rerender(<LiveWords text="order the grilles today" />);
  const after = words();

  expect(after.map((w) => w.textContent)).toEqual(["order", "the", "grilles", "today"]);
  expect(after[2]).not.toBe(before[2]);
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[3]).toBe(before[3]);
});

/* Keyed by position, a word put in mid-sentence handed every word after it
   the letters of the one before. Keyed by who they are, they keep theirs. */
it("puts a word in mid-sentence without touching the words after it", () => {
  const { rerender } = render(<LiveWords text="tell Lyle the grilles" />);
  const before = words();

  rerender(<LiveWords text="tell Lyle about the grilles" />);
  const after = words();

  expect(after.map((w) => w.textContent)).toEqual(["tell", "Lyle", "about", "the", "grilles"]);
  expect(after[3]).toBe(before[2]);
  expect(after[4]).toBe(before[3]);
});

it("ignores the engine's stray whitespace rather than rendering empty words", () => {
  render(<LiveWords text="  tell   Lyle  " />);
  expect(words().map((w) => w.textContent)).toEqual(["tell", "Lyle"]);
});

/* The words are what the person is checking while they talk, so they are
   announced — but the paragraph is one region, not one per word. */
it("stays a single polite region", () => {
  render(<LiveWords text="tell Lyle" />);
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
  render(<LiveWords said="middle rooftop unit tripped again" text="tell Lyle" />);

  expect(document.querySelector(".wb2-lwsaid")).toHaveTextContent(
    "middle rooftop unit tripped again"
  );
  expect(words().map((w) => w.textContent)).toEqual(["tell", "Lyle"]);
});

it("shows no record at all when there is nothing already said", () => {
  render(<LiveWords text="tell Lyle" />);
  expect(document.querySelector(".wb2-lwsaid")).toBeNull();
});

/* THE PHONE'S MOTIONS (Isaac, 9 November 2026: "make sure that the words
   show the same way. The mobile does. How quickly they render and the way
   that they change words to self-heal"). jsdom has no Web Animations, so the
   calls are caught and read: what moved, for how long, after what wait. */
type Call = { el: HTMLElement; frames: Record<string, unknown>; opts: KeyframeAnimationOptions };
function catchMotion(): Call[] {
  const calls: Call[] = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, frames: Record<string, unknown>, opts: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, opts });
    return { onfinish: null } as unknown as Animation;
  };
  return calls;
}
afterEach(() => {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

it("shows each new word the moment it's heard: no step between words, no blur", () => {
  const calls = catchMotion();
  const { rerender } = render(<LiveWords text="tell" />);
  rerender(<LiveWords text="tell Lyle the grilles" />);
  const fades = calls.filter((c) => "opacity" in c.frames);
  expect(fades).toHaveLength(4);
  for (const c of fades) {
    expect(c.opts.duration).toBe(200);
    expect(c.opts.delay ?? 0).toBe(0);
    expect(JSON.stringify(c.frames)).not.toContain("blur");
  }
});

it("brings a fixed word up into its place in ink, settling to grey, as the phone does", () => {
  const calls = catchMotion();
  const { rerender } = render(<LiveWords text="after that the boat" />);
  calls.length = 0;
  rerender(<LiveWords text="after that the quote" />);
  const fix = calls.find((c) => c.el.textContent === "quote" && "opacity" in c.frames);
  expect(fix?.opts).toMatchObject({ duration: 280, delay: 50 });
  const settle = calls.find((c) => c.el.textContent === "quote" && "color" in c.frames);
  expect(settle?.opts.duration).toBe(1200);
});

it("fades the word that went out where it stood", () => {
  const calls = catchMotion();
  const { rerender } = render(<LiveWords text="after that the boat" />);
  rerender(<LiveWords text="after that the quote" />);
  const gone = document.querySelector(".wb2-lw.gone");
  expect(gone?.textContent).toBe("boat");
  expect(gone?.getAttribute("aria-hidden")).toBe("true");
  const out = calls.find((c) => c.el === gone);
  expect(out?.opts.duration).toBe(200);
});

it("moves nothing where motion is turned down", () => {
  const calls = catchMotion();
  const was = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  try {
    const { rerender } = render(<LiveWords text="after that the boat" />);
    rerender(<LiveWords text="after that the quote" />);
    expect(calls).toHaveLength(0);
    expect(document.querySelector(".wb2-lw.gone")).toBeNull();
  } finally {
    window.matchMedia = was;
  }
});

/* THE BOX RIDES THE NEWEST WORD. It is a fixed three-line window, so the
   words being spoken are only on screen if it is scrolled to the bottom —
   and the ride has to happen in a LAYOUT effect, before the frame is painted,
   or it is a visible snap on every partial. */
it("scrolls to the newest word", () => {
  const el = () => document.querySelector(".wb2-lwbox") as HTMLElement;
  const { rerender } = render(<LiveWords text="tell" />);
  /* jsdom lays nothing out, so the heights are stated here — the assertion is
     that the component acts on them, not that jsdom can wrap text. */
  Object.defineProperty(el(), "scrollHeight", { value: 200, configurable: true });
  Object.defineProperty(el(), "clientHeight", { value: 65, configurable: true });

  rerender(<LiveWords text="tell Lyle" />);

  expect(el().scrollTop).toBe(200);
  /* …and once something has gone out of sight above, the top fades rather
     than being sliced. */
  expect(el().className).toContain("over");
});

/* FREE WORDS ARE NOT A WINDOW. On the Tiff modal the box is as tall as what
   was said, and its only "overflow" is a word arriving 4px low — which the
   window read as scrolled, fading out the first line of every dictation
   there ("some of the words are getting cut off", Isaac, 2026-09-26). */
it("neither rides nor fades when its words are free", () => {
  const el = () => document.querySelector(".wb2-lwbox") as HTMLElement;
  const { rerender } = render(<LiveWords free text="the alarm's" />);
  Object.defineProperty(el(), "scrollHeight", { value: 88, configurable: true });
  Object.defineProperty(el(), "clientHeight", { value: 84, configurable: true });

  rerender(<LiveWords free text="the alarm's gone mental" />);

  expect(el().scrollTop).toBe(0);
  expect(el().className).toContain("free");
  expect(el().className).not.toContain("over");
});

/* ── THE SAME RIVER, IN A FIELD'S BOX ──

   The field mics hand their box over rather than shoving the sentence into
   the field, and what makes that swap invisible is that the river wears the
   FIELD'S own class. The height parity is measured in a browser against the
   real sheet — 30px, 34px and 74px, either way — but which classes end up on
   the element is jsdom's to check. */
it("wears the box it was handed", () => {
  render(<LiveWords className="wb2-fi" text="tell Lyle" />);
  const box = document.querySelector(".wb2-lwbox")!;

  expect(box.className).toContain("wb2-fi");
});

/* A paragraph has no `rows`, so the block posture hands the number down and
   the sheet works out the height the textarea would have had. */
it("carries the row count the textarea was sized to", () => {
  render(<LiveWords className="wb2-notes" rows={3} text="tell Lyle" />);
  expect(document.querySelector<HTMLElement>(".wb2-lwbox")!.style.getPropertyValue("--lwrows")).toBe(
    "3"
  );
});
