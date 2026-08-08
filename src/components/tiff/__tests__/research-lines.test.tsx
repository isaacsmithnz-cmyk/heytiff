import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { ResearchLines, WIDE_QUERY } from "../research-lines";
import { KB_CATEGORIES, type KbCategoryKey } from "../kb";
import { IDLE_VIZ, reduceViz, type ResearchViz, type VizEvent } from "@/lib/tiff/research-viz";

/* The SVG underlay.

   THE GEOMETRY IS NOT ASSERTED HERE AND CANNOT BE: jsdom reports every rect as
   0×0, exactly as the system map's own tests say up front. What these prove is
   the wiring — that a path exists per shelf carrying that shelf's class, that
   the overlay knows when it has nothing to draw, and that it lets go of its
   observers when it goes. Where a line actually lands is eyeballed live.

   Measurement IS proved indirectly: a lane only exists for a card the overlay
   found and measured, so four paths means four measurements happened. */

/* ── harness ─────────────────────────────────────────────────────────────── */

/* A matchMedia that can be moved. Real ones hand back a fresh
   MediaQueryList per call, so `matches` is a getter over the current width
   rather than a value frozen into one object. */
let mediaListeners: (() => void)[] = [];
let lastQuery = "";
let isWide = true;

const setViewport = (wide: boolean) => {
  isWide = wide;
};

const installMatchMedia = () => {
  window.matchMedia = ((query: string) => {
    lastQuery = query;
    return {
      media: query,
      get matches() {
        return isWide;
      },
      onchange: null,
      addEventListener: (_type: string, fn: () => void) => {
        mediaListeners.push(fn);
      },
      removeEventListener: (_type: string, fn: () => void) => {
        mediaListeners = mediaListeners.filter((l) => l !== fn);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};

/** Resize the window as far as the component can tell. */
const resizeTo = (wide: boolean) =>
  act(() => {
    isWide = wide;
    for (const fn of [...mediaListeners]) fn();
  });

const observed: Element[] = [];
const disconnected: number[] = [];
let roCount = 0;

class ObserverSpy {
  id: number;
  /* The callback is deliberately dropped: nothing here fires a resize, and a
     spy that could would be measuring 0×0 rects either way. */
  constructor() {
    this.id = ++roCount;
  }
  observe(el: Element) {
    observed.push(el);
  }
  unobserve() {}
  disconnect() {
    disconnected.push(this.id);
  }
}

const viz = (...events: VizEvent[]): ResearchViz => events.reduce(reduceViz, IDLE_VIZ);

const traced = viz(
  { t: "submit" },
  { t: "trace", winners: ["faults"], hits: { faults: 4, install: 2 } }
);

function Stage({ viz: state, measureKey = 0 }: { viz: ResearchViz; measureKey?: number }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const cardRefs = useRef(new Map<KbCategoryKey, HTMLElement>());

  /* Composed exactly as the assistant composes it, overlay LAST — the cards'
     callback refs detach and re-attach in tree order on every render, so the
     order here is part of what is under test. */
  return (
    <div className="tk-stage" ref={stageRef} data-testid="stage">
      <form className="tk-composer" ref={composerRef} data-testid="composer" />
      <aside>
        {KB_CATEGORIES.map((c) => (
          <a
            key={c.key}
            href="#"
            className="tk-rcat"
            data-cat={c.key}
            ref={(el) => {
              if (el) cardRefs.current.set(c.key, el);
              else cardRefs.current.delete(c.key);
            }}
          >
            {c.label}
          </a>
        ))}
      </aside>
      <ResearchLines
        stageRef={stageRef}
        composerRef={composerRef}
        cardRefs={cardRefs}
        viz={state}
        measureKey={measureKey}
      />
    </div>
  );
}

const svg = (c: HTMLElement) => c.querySelector("svg.tk-lines");
const paths = (c: HTMLElement, sel = "") => [...c.querySelectorAll(`path.tk-line${sel}`)];

beforeEach(() => {
  mediaListeners = [];
  observed.length = 0;
  disconnected.length = 0;
  roCount = 0;
  installMatchMedia();
  setViewport(true);
  // the jest.setup stub can't be watched; this one can
  window.ResizeObserver = ObserverSpy as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

/* ── when there is nothing to draw ───────────────────────────────────────── */

describe("with nothing being searched", () => {
  it("renders no overlay at all", () => {
    const { container } = render(<Stage viz={IDLE_VIZ} />);
    expect(svg(container)).toBeNull();
  });
});

describe("on a narrow screen", () => {
  it("renders nothing, because the rail is stacked under the composer there", () => {
    setViewport(false);
    const { container } = render(<Stage viz={traced} />);
    expect(svg(container)).toBeNull();
  });

  it("asks for the exact complement of the stylesheet's stacking query", () => {
    render(<Stage viz={traced} />);
    expect(lastQuery).toBe(WIDE_QUERY);
    expect(WIDE_QUERY).toBe("not all and (max-width: 1100px)");
  });

  it("appears and disappears as the window crosses the breakpoint", () => {
    setViewport(false);
    const { container } = render(<Stage viz={traced} />);
    expect(svg(container)).toBeNull();

    resizeTo(true);
    expect(svg(container)).not.toBeNull();

    resizeTo(false);
    expect(svg(container)).toBeNull();
  });
});

/* ── the lines themselves ────────────────────────────────────────────────── */

describe("while searching", () => {
  it("draws a base path and a pulse over it for every shelf", () => {
    const { container } = render(<Stage viz={viz({ t: "submit" })} />);

    expect(paths(container, ".draw")).toHaveLength(5);
    expect(paths(container, ".pulse")).toHaveLength(5);
    for (const c of KB_CATEGORIES) {
      expect(container.querySelector(`path.tk-line.draw[data-cat="${c.key}"]`)).not.toBeNull();
      expect(container.querySelector(`path.tk-line.pulse[data-cat="${c.key}"]`)).not.toBeNull();
    }
  });

  /* pathLength=1 is what makes one stroke-dasharray draw in every line at the
     same rate; the pulse's dash travels in real units and must not have it. */
  it("normalises the length of the drawing path only", () => {
    const { container } = render(<Stage viz={viz({ t: "submit" })} />);
    expect(paths(container, ".draw")[0].getAttribute("pathLength")).toBe("1");
    expect(paths(container, ".pulse")[0].getAttribute("pathLength")).toBeNull();
  });

  it("carries the shelf's colour as a custom property rather than naming it", () => {
    const { container } = render(<Stage viz={viz({ t: "submit" })} />);
    const group = container.querySelector('g[data-cat="faults"]') as SVGGElement;
    expect(group.style.getPropertyValue("--tkc")).toBe(
      KB_CATEGORIES.find((c) => c.key === "faults")!.color
    );
  });

  it("says nothing to a screen reader — the rail already does", () => {
    const { container } = render(<Stage viz={viz({ t: "submit" })} />);
    expect(svg(container)).toHaveAttribute("aria-hidden", "true");
  });
});

describe("once the trace lands", () => {
  it("lights the winner, tints the hit, dims the rest and stops pulsing", () => {
    const { container } = render(<Stage viz={traced} />);

    expect(container.querySelector('path.tk-line.lit[data-cat="faults"]')).not.toBeNull();
    expect(paths(container, ".lit")).toHaveLength(1);
    // install had 2 hits the answer didn't use — a fact worth its own class
    expect(container.querySelector('path.tk-line.hit[data-cat="install"]')).not.toBeNull();
    expect(paths(container, ".hit")).toHaveLength(1);
    expect(paths(container, ".dim")).toHaveLength(3);
    expect(paths(container, ".pulse")).toHaveLength(0);
  });

  /* The writing has its own pulse, on the winner's lane only, run backwards —
     the answer being drawn FROM the shelf. */
  it("pulses back along the winner's lane while the answer streams", () => {
    const { container } = render(<Stage viz={reduceViz(traced, { t: "firstDelta" })} />);

    const back = paths(container, ".pulse.back");
    expect(back).toHaveLength(1);
    expect(back[0].getAttribute("data-cat")).toBe("faults");
    expect(paths(container, ".pulse")).toHaveLength(1);
  });

  it("keeps the winner's line faintly once the answer is finished, fades the rest", () => {
    const { container } = render(
      <Stage viz={reduceViz(reduceViz(traced, { t: "firstDelta" }), { t: "done" })} />
    );
    expect(paths(container, ".fade")).toHaveLength(4);
    const kept = paths(container, ".kept");
    expect(kept).toHaveLength(1);
    expect(kept[0].getAttribute("data-cat")).toBe("faults");
    expect(paths(container, ".pulse")).toHaveLength(0);
    expect(svg(container)).not.toBeNull();
  });

  it("goes away entirely on a reset", () => {
    const { container, rerender } = render(<Stage viz={traced} />);
    expect(svg(container)).not.toBeNull();

    rerender(<Stage viz={reduceViz(traced, { t: "reset" })} />);
    expect(svg(container)).toBeNull();
  });
});

/* ── measuring ───────────────────────────────────────────────────────────── */

describe("keeping the geometry current", () => {
  it("watches the stage for size changes", () => {
    const { getByTestId } = render(<Stage viz={traced} />);
    expect(observed).toContain(getByTestId("stage"));
  });

  it("remeasures when the parent says the composer moved", () => {
    const rect = jest.spyOn(Element.prototype, "getBoundingClientRect");
    const { rerender } = render(<Stage viz={traced} measureKey={0} />);
    rect.mockClear();

    rerender(<Stage viz={traced} measureKey={1} />);
    expect(rect).toHaveBeenCalled();
    rect.mockRestore();
  });

  /* The cards' callback refs are detached and re-attached on every render. A
     measurement taken in the gap sees no rail at all, and blanking the lines
     on it would flicker them out mid-question. */
  it("keeps its lines through a re-render rather than blanking them", () => {
    const { container, rerender } = render(<Stage viz={viz({ t: "submit" })} measureKey={0} />);
    expect(paths(container)).toHaveLength(10);

    rerender(<Stage viz={traced} measureKey={1} />);
    expect(paths(container)).toHaveLength(5);
    expect(paths(container, ".lit")).toHaveLength(1);
  });

  it("lets go of its observer and its resize listener when it goes", () => {
    const off = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<Stage viz={traced} />);
    const opened = roCount;

    unmount();
    expect(disconnected).toHaveLength(opened);
    expect(off).toHaveBeenCalledWith("resize", expect.any(Function));
    off.mockRestore();
  });

  it("draws nothing rather than guessing when a card has no element", () => {
    const stageRef = { current: document.createElement("div") };
    const composerRef = { current: document.createElement("form") };
    const { container } = render(
      <ResearchLines
        stageRef={stageRef}
        composerRef={composerRef}
        cardRefs={{ current: new Map() }}
        viz={traced}
      />
    );
    expect(container.querySelectorAll("path.tk-line")).toHaveLength(0);
  });
});
