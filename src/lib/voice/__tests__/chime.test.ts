import { chimeScore, playChime } from "../chime";

/* THE MIC'S THREE NOTES.

   Two things are worth a test here and the rest is taste. First, the SHAPE:
   start rises, stop is the same interval falling, and discard is a single low
   note that resolves nowhere — that is the whole design, because it is what
   lets someone tell by ear whether their words were kept without looking at
   the phone. Swap the arrays around and nothing fails at runtime; it just
   quietly starts lying.

   Second, that it CANNOT take a recording down with it. This fires inside
   `start`, `stop` and `cancel`, so a browser with no Web Audio, a blocked
   context or an exception mid-schedule must cost the note and nothing else. */

describe("the shape of it", () => {
  it("opens on a rising fifth", () => {
    const [a, b] = chimeScore("start");
    expect(b).toBeGreaterThan(a);
    expect(b / a).toBeCloseTo(1.5, 1);
  });

  it("closes on the same fifth, falling", () => {
    const start = chimeScore("start");
    const stop = chimeScore("stop");
    expect(stop).toEqual([...start].reverse());
  });

  it("throws away on one low note that resolves nowhere", () => {
    const discard = chimeScore("discard");
    expect(discard).toHaveLength(1);
    expect(discard[0]).toBeLessThan(Math.min(...chimeScore("start")));
  });

  it("hands back a copy — a caller cannot retune the app by accident", () => {
    chimeScore("start").push(1);
    expect(chimeScore("start")).toHaveLength(2);
  });
});

describe("it never costs anything but the sound", () => {
  const realAC = window.AudioContext;
  afterEach(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: realAC,
    });
  });

  /* jsdom has no Web Audio at all, which is the no-support case for free. */
  it("is silent and harmless where Web Audio does not exist", () => {
    expect(window.AudioContext).toBeUndefined();
    expect(() => playChime("start")).not.toThrow();
  });

  it("swallows a context that refuses to be built", () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: function Blocked() {
        throw new Error("blocked by policy");
      },
    });
    expect(() => playChime("stop")).not.toThrow();
  });

  it("swallows a context that throws once it is being scheduled", () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: function Broken(this: Record<string, unknown>) {
        this.state = "running";
        this.currentTime = 0;
        this.destination = {};
        this.createOscillator = () => {
          throw new Error("no more oscillators");
        };
        this.createGain = () => ({});
      },
    });
    expect(() => playChime("discard")).not.toThrow();
  });
});
