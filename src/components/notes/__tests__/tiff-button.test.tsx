import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TIFF_BUTTON_PLACES, TiffButton } from "../tiff-button";
import { NoteScopeProvider, NoteScopeScreen, useNoteScope } from "../note-context";

/* ONE WAY IN, IN THE SAME CORNER OF EVERY SCREEN.

   The button is the second half of the argument PR #287 started. That one
   collapsed five CONTROLS into one; this collapses the places you can reach
   it into one, and the interesting consequence is a reversal: the token used
   to sit inside the screen that configured it, and now it sits in the frame
   ABOVE every screen, so screens report up instead of wrapping it.

   That reversal is what these guard. A button that renders perfectly while
   pointed at nothing looks completely fine and quietly files every note
   against the wrong thing — or against nothing at all.

   WHAT A PRESS OPENS is the Tiff modal's to hold, in its own suite
   (../../tiff/modal/__tests__/tiff-modal), with its host round the button
   as the frame has it. The capture sheet the button opened before the new
   Home was everyone's keeps its tests in ./capture-sheet. */

const job = (id: string) => ({
  kind: "visit" as const,
  id,
  clientName: "Meridian Data",
  label: "Server room CRACs",
  siteLabel: null,
  jobNumber: "1042",
});

function Probe() {
  const s = useNoteScope();
  return <span data-testid="scope">{`${s.target.kind}|${s.targetLabel ?? "-"}|${s.jobs.length}`}</span>;
}

const mount = (ui?: React.ReactNode, voiceEnabled = true) =>
  render(
    <NoteScopeProvider voiceEnabled={voiceEnabled}>
      <Probe />
      {ui}
      <TiffButton />
    </NoteScopeProvider>
  );

const btn = () => screen.getByLabelText(/Ask or tell Tiff/);

afterEach(cleanup);

describe("the button itself", () => {
  it("is one control, not a capsule — it takes anything, so it offers one way in", () => {
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    /* The keyboard|mic pair belonged to the corner capsule this replaced.
       Typing is not hidden by that: the modal it opens ends in a box. */
    expect(document.querySelector(".wb2-tok")).toBeNull();
  });

  /* IT RENDERS WHERE IT IS PUT. It portalled to body for one commit, when it
     floated bottom-right: inside `.fg` a fixed overlay is unreachable under a
     sheet's scrim at ANY z-index (measured — a probe at 2147483647 still
     loses), so a floating version had to leave the frame.

     Moving it into the topbar dissolved that problem rather than solving it.
     It is chrome now, and chrome dimming under a modal is what chrome does —
     so it renders in place, and only the MODAL it opens portals. */
  it("renders in place — it is chrome, not an overlay", () => {
    render(
      <NoteScopeProvider voiceEnabled>
        <div className="tbr">
          <TiffButton />
        </div>
      </NoteScopeProvider>
    );
    expect(btn().closest(".tbr")).not.toBeNull();
    expect(btn().parentElement).not.toBe(document.body);
  });

  /* THE SHEET VARIANT. Nothing outside a sheet's scrim can be clicked, so the
     topbar button is unreachable the moment a job opens — which killed the one
     case the context tag exists for. Isaac's fix: a button ON the sheet. It is
     the same component and the same flow; only the ground changes, so only the
     skin does. */
  it("wears the paper skin in a sheet, and says what it will be about", () => {
    render(
      <NoteScopeProvider voiceEnabled>
        <NoteScopeScreen target={{ kind: "visit", id: "v-1" }} targetLabel="Server room CRACs" />
        <TiffButton where="sheet" />
      </NoteScopeProvider>
    );
    const el = screen.getByLabelText("Ask or tell Tiff about Server room CRACs");
    expect(el).toHaveClass("tiffbtn-sheet");
    /* A white face on a white sheet is nothing: on paper the face takes the
       brand gradient, and the depth goes a step darker. */
    const face = el.querySelector(".tiffbtn-ly.face path");
    expect(face).toHaveAttribute("stroke", "url(#tiffFacePaper)");
    expect(el.querySelectorAll(".tiffbtn-ly")).toHaveLength(10);
  });

  /* THE BOX VARIANT. At the end of an entry box it is on paper, so it wears
     the sheet's skin, and it says what it does beside the words to type:
     talk. Even on a screen about a job — the box beside it is the room's,
     not the sheet's. */
  it("wears the paper skin in a box and says Talk to Tiff, whatever the screen is about", () => {
    render(
      <NoteScopeProvider voiceEnabled>
        <NoteScopeScreen target={{ kind: "visit", id: "v-1" }} targetLabel="Server room CRACs" />
        <TiffButton where="box" room="diary" />
      </NoteScopeProvider>
    );
    const el = screen.getByRole("button", { name: "Talk to Tiff" });
    expect(el).toHaveClass("tiffbtn-box");
    expect(el).not.toHaveAttribute("title");
    expect(el.querySelector(".tiffbtn-ly.face path")).toHaveAttribute("stroke", "url(#tiffFacePaper)");
  });

  /* THE SKIN IS A CLASS BUILT FROM THE PLACE, `tiffbtn-${where}`, and a
     dead-CSS sweep cannot see a class built that way: #681's deleted every
     `.tiffbtn-sheet` rule and the sheet's button went 0×0. So every place
     has its size rule, read off the stylesheet, and a paper place its
     paper light. */
  it("has a size rule in the stylesheet for every place it stands", () => {
    const css = readFileSync(join(process.cwd(), "src/app/dashboard/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.split(",").map((s) => s.trim()), m[2]!] as const);
    expect(TIFF_BUTTON_PLACES).toEqual(["topbar", "sheet", "box"]);
    for (const place of TIFF_BUTTON_PLACES) {
      const sized = rules.some(([sels, body]) => sels.includes(`.tiffbtn-${place}`) && /--tb\s*:\s*\d+px/.test(body));
      expect(`${place}: ${sized}`).toBe(`${place}: true`);
    }
    const lit = (place: string) => rules.some(([sels, body]) => sels.includes(`.tiffbtn-${place}`) && /--tiffbtn-sheen\s*:/.test(body));
    for (const place of TIFF_BUTTON_PLACES) expect(`${place}: ${lit(place)}`).toBe(`${place}: true`);
    const size = (place: string) =>
      rules.find(([sels, body]) => sels.includes(`.tiffbtn-${place}`) && /--tb\s*:/.test(body))![1].match(/--tb\s*:\s*(\d+)px/)![1];
    expect(size("box")).toBe("36");
  });

  it("wears the ink skin on the frame: a paper face, gradient depth", () => {
    mount();
    const el = btn();
    expect(el).toHaveClass("tiffbtn-topbar");
    expect(el.querySelector(".tiffbtn-ly.face path")).toHaveAttribute("stroke", "currentColor");
    expect(el.querySelector(".tiffbtn-ly:not(.face) path")).toHaveAttribute("stroke", "url(#tiffDepthInk)");
  });

  /* THE GIMBAL (Isaac, 2026-09-25). Two rings, each with its run of light,
     around the mark in both places — and nothing around the rings: the
     aura went on his word ("aura looks too generic ai"), and law 5 took the
     sparkle long before. */
  it("is the mark in two gimbals, with no halo and no sparkle", () => {
    mount();
    const el = btn();
    expect(el.querySelectorAll(".tiffbtn-gim")).toHaveLength(2);
    expect(el.querySelectorAll(".tiffbtn-arc circle")).toHaveLength(4);
    expect(el.querySelector(".tiffbtn-halo, .tiffbtn-spark, .tiffbtn-core")).toBeNull();
    // the band of light is cut to the logo's own shape, passed in from the one geometry
    expect(el.style.getPropertyValue("--tiffbtn-mask")).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it("says what it does rather than naming an icon", () => {
    mount();
    /* No "— starts listening" suffix any more: it doesn't. The name promising
       a recording that no longer happens would be the worse kind of stale. */
    expect(btn()).toHaveAccessibleName("Ask or tell Tiff");
    mount(undefined, false);
    expect(screen.getAllByLabelText("Ask or tell Tiff")[0]).toBeInTheDocument();
  });
});

describe("what it is pointed at", () => {
  it("is a universal note taker when nothing has reported in", () => {
    mount();
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|0");
  });

  it("picks up the screen underneath, which is above it in nothing and below it in the tree", () => {
    mount(
      <NoteScopeScreen
        target={{ kind: "project", id: "p-1" }}
        targetLabel="Smith St change-over"
        jobs={[job("v-1"), job("v-2")]}
      />
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("project|Smith St change-over|2");
  });

  /* THE BUG THE TWO SLOTS EXIST FOR. A screen reports its job list; a sheet
     opens over it and reports a target. With one slot the second push replaced
     the first, the job list vanished, and a note taken from the button could
     no longer be pinned to anything on the board behind it. */
  it("lets a sheet re-aim it WITHOUT losing the board's job list", () => {
    const Sheet = () => {
      const { pushFocus } = useNoteScope();
      React.useEffect(() => {
        pushFocus({ target: { kind: "visit", id: "v-9" }, targetLabel: "Meridian, CRACs" });
        return () => pushFocus(null);
      }, [pushFocus]);
      return null;
    };
    const { rerender } = render(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "none" }} jobs={[job("v-1"), job("v-2")]} />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|2");

    rerender(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "none" }} jobs={[job("v-1"), job("v-2")]} />
        <Sheet />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("visit|Meridian, CRACs|2");
  });

  it("falls back to the screen when the sheet closes, not to nothing", () => {
    const Sheet = () => {
      const { pushFocus } = useNoteScope();
      React.useEffect(() => {
        pushFocus({ target: { kind: "visit", id: "v-9" }, targetLabel: "Meridian, CRACs" });
        return () => pushFocus(null);
      }, [pushFocus]);
      return null;
    };
    const tree = (withSheet: boolean) => (
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "project", id: "p-1" }} targetLabel="Smith St" />
        {withSheet && <Sheet />}
        <TiffButton />
      </NoteScopeProvider>
    );
    const { rerender } = render(tree(true));
    expect(screen.getByTestId("scope")).toHaveTextContent("visit|Meridian, CRACs");

    rerender(tree(false));
    expect(screen.getByTestId("scope")).toHaveTextContent("project|Smith St");
  });

  it("stops holding a board once its screen goes away", () => {
    const { rerender } = render(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "project", id: "p-1" }} jobs={[job("v-1")]} />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("project|-|1");

    /* Navigation, in the shape the frame actually sees it: the screen
       unmounts and the button does not. Leaving the last board's jobs behind
       would offer to pin a note to a job that is no longer on screen. */
    rerender(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|0");
  });

  it("does not name a job it was not given — a stale label is worse than none", () => {
    const Aim = ({ label }: { label?: string }) => {
      const { pushFocus } = useNoteScope();
      React.useEffect(() => {
        pushFocus({ target: { kind: "visit", id: "v-1" }, targetLabel: label });
      }, [pushFocus, label]);
      return null;
    };
    const { rerender } = render(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <Aim label="Meridian, CRACs" />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("Meridian, CRACs");

    rerender(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <Aim />
      </NoteScopeProvider>
    );
    act(() => {});
    expect(screen.getByTestId("scope")).toHaveTextContent("visit|-|0");
  });
});
