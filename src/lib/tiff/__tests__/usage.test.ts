/**
 * @jest-environment node
 *
 * The cost instrument. Two things are worth pinning:
 *
 * A PRICE THAT ISN'T ON FILE PRODUCES NO NUMBER. The whole point of measuring
 * is to stop guessing, so a model swapped in without a price must log its
 * tokens and say "unpriced" — an invented figure is worse than none, because
 * somebody will budget against it.
 *
 * LOGGING NEVER THROWS. This sits inside the answer stream, between the final
 * message and the caller's last event. An exception here would turn a
 * cost-reporting bug into a dead answer on somebody's screen.
 */

import { costOf, logUsage } from "../usage";

describe("costOf", () => {
  it("prices input and output at their different rates", () => {
    // 1M in at $5 + 1M out at $25
    expect(costOf("claude-opus-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(30, 6);
  });

  it("prices a measured question in the cents it actually costs", () => {
    const usd = costOf("claude-opus-5", { input_tokens: 5_500, output_tokens: 2_500 });
    expect(usd).toBeCloseTo(0.0900, 4);
  });

  it("charges cache reads at a tenth of the input rate", () => {
    expect(costOf("claude-opus-5", { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.5, 6);
  });

  it("charges cache writes at a quarter over the input rate", () => {
    expect(costOf("claude-opus-5", { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(6.25, 6);
  });

  /* The reason caching is a judgement call and not a free win: the round that
     writes a prefix pays more than it would have uncached, and only earns it
     back when a later round reads it. A costOf that ignored writes would make
     every caching change look free. */
  it("prices a written-then-read prefix above a plain read", () => {
    const written = costOf("claude-opus-5", { cache_creation_input_tokens: 10_000 })!;
    const read = costOf("claude-opus-5", { cache_read_input_tokens: 10_000 })!;
    const plain = costOf("claude-opus-5", { input_tokens: 10_000 })!;
    expect(written).toBeGreaterThan(plain);
    expect(read).toBeLessThan(plain);
    // one write plus one read still beats sending it twice uncached
    expect(written + read).toBeLessThan(plain * 2);
  });

  it("returns null for a model with no price on file", () => {
    expect(costOf("claude-haiku-4-5", { input_tokens: 1_000, output_tokens: 100 })).toBeNull();
  });

  it("treats missing counts as zero rather than NaN", () => {
    expect(costOf("claude-sonnet-5", {})).toBe(0);
    expect(costOf("claude-sonnet-5", { input_tokens: null, output_tokens: undefined })).toBe(0);
  });
});

describe("logUsage", () => {
  const lines: string[] = [];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    lines.length = 0;
    spy = jest.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
  });

  afterEach(() => spy.mockRestore());

  it("writes one greppable line per call", () => {
    logUsage("answer:general", "claude-opus-5", { input_tokens: 5_500, output_tokens: 2_500 });
    expect(lines).toEqual(["[kb-usage] answer:general claude-opus-5 in=5500 out=2500 $0.0900"]);
  });

  /* The cache segment is the instrument the whole caching change is judged by,
     so it has to be absent when there is nothing to judge — an uncached stage
     must read exactly as it did before. */
  it("leaves the line alone on an uncached call", () => {
    logUsage("prep", "claude-sonnet-5", { input_tokens: 900, output_tokens: 400 });
    expect(lines[0]).not.toContain("cache(");
  });

  it("shows what was read back and what was written when a prefix is cached", () => {
    logUsage("ask:2", "claude-opus-5", {
      input_tokens: 120,
      output_tokens: 300,
      cache_read_input_tokens: 8_400,
      cache_creation_input_tokens: 1_100,
    });
    expect(lines[0]).toContain("in=120 out=300 cache(r=8400 w=1100)");
  });

  it("says so rather than inventing a figure for an unpriced model", () => {
    logUsage("prep", "some-new-model", { input_tokens: 900, output_tokens: 400 });
    expect(lines[0]).toContain("in=900 out=400 unpriced");
  });

  it("stays silent when there is no usage to report", () => {
    logUsage("prep", "claude-sonnet-5", null);
    logUsage("prep", "claude-sonnet-5", undefined);
    expect(lines).toEqual([]);
  });

  it("swallows a malformed usage object instead of killing the answer", () => {
    const hostile = {
      get input_tokens(): number {
        throw new Error("usage came back in a shape nobody expected");
      },
    };
    expect(() => logUsage("answer:research", "claude-opus-5", hostile)).not.toThrow();
  });
});
