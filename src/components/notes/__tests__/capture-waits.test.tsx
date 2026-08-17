import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "../note-context";
import { TiffButton } from "../tiff-button";

/* THE THREE THINGS YOU SEE BETWEEN PRESSING THE BUTTON AND SAVING.

   Isaac, walking the global button on 2026-08-17, reported the flow as three
   faults in a row, and they are three different bugs with one shape: the card
   showing you something that is not what is happening.

     1. A SMALL CARD FLASHED FIRST. The button opens the sheet and asks for
        the microphone in the same click, and `recording` cannot be true until
        `getUserMedia` comes back — so the sheet rendered its idle self (box,
        Default switch, "Ask or tell Tiff") across that gap and then replaced
        it. `arming` closes it.

     2. THE ANIMATION RAN IN THE WRONG PLACE. The dot field flew for the
        read-back — a second or two — and was pulled precisely when the long
        wait started: the seven seconds of Tiff working out what the words
        become. It now spans the whole wait, and the skeleton rows that used
        to stand in for it are gone.

     3. THE CARD WENT WHITE AT THE REVIEW. Capture was dusk and checking was
        a light surface; one flow, two grounds, and the review has had dark
        clothes since the debrief card needed them.

   These drive the REAL dictation engine against a microphone that never
   opens, because the gap in (1) only exists in the real one — a mocked
   `useDictation` flips `recording` synchronously and has no gap to test. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const routeNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...(a as [])),
  applyNote: jest.fn(),
  dismissNote: jest.fn(async () => ({ ok: true, summary: "" })),
  keepNoteForMe: jest.fn(),
  keepNoteOnJob: jest.fn(),
  answerClarify: jest.fn(),
}));

/** A microphone that never opens, and the switch to let it. */
let openMic: (stream: MediaStream) => void = () => {};
const tracks = { stop: jest.fn() };
const fakeStream = { getTracks: () => [tracks] } as unknown as MediaStream;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          openMic = resolve;
        }),
    },
  });
});

const open = async () => {
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffButton />
    </NoteScopeProvider>
  );
  await userEvent.click(screen.getByRole("button", { name: /Ask or tell Tiff/i }));
};

const card = () => document.querySelector(".wb2-capcard")!;

describe("the press, and the gap after it", () => {
  it("opens straight into the recording card — the idle box never flashes up", async () => {
    await open();

    /* What the recording stage is: the mark in flight, and the three ways
       out. `Done` is the one that only ever exists here. */
    expect(document.querySelector('.wb2-capfield .dotf[data-stage="mark"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    /* And what the flash WAS. Either of these on screen means the card spent
       the gap pretending nobody had pressed anything. */
    expect(screen.queryByRole("textbox", { name: /^$/ })).toBeNull();
    expect(screen.queryByText("Default")).toBeNull();
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
  });

  it("stands down if you change your mind before the microphone opens", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // straight back to the box — nothing was recorded, so nothing is read back
    expect(await screen.findByPlaceholderText(/Tell Luke/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

    /* AND THE MIC THAT ARRIVES LATE IS LET GO. Without this the permission
       promise resolves into a recording nobody asked for, seconds after the
       card went back to the box. */
    openMic(fakeStream);
    await waitFor(() => expect(tracks.stop).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});

describe("the wait, and what is moving during it", () => {
  const type = async (words: string) => {
    await open();
    // out of the arming stage the honest way: type instead of talking
    await userEvent.click(screen.getByRole("button", { name: /Type instead/i }));
    await userEvent.type(await screen.findByPlaceholderText(/Tell Luke/), words);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
  };

  it("keeps the mark in flight for the whole sort, with nothing else claiming to work", async () => {
    /* The routing call, held open — this is the seven seconds the animation
       was missing. */
    let land: (v: unknown) => void = () => {};
    routeNote.mockReturnValue(new Promise((r) => (land = r)));

    await type("Luke needs to order the grilles");
    expect(await screen.findByText("Sorting it out")).toBeInTheDocument();

    expect(document.querySelector('.wb2-capfield .dotf[data-stage="cloud"]')).not.toBeNull();
    // the two indicators that used to double it up
    expect(document.querySelector(".wb2-skel")).toBeNull();
    expect(card().querySelector(".wb2-spin")).toBeNull();
    // and the words are still there to re-read
    expect(screen.getByText("Luke needs to order the grilles")).toBeInTheDocument();

    land({
      ok: true,
      noteId: "n-1",
      proposal: {
        tasks: [],
        bringItems: [],
        flags: [],
        progressBullets: [],
        commissioningEntries: [],
        issueEntries: [],
        kbEntries: [],
        noteLines: ["Order the grilles"],
        plainNote: "Luke needs to order the grilles",
        clarify: null,
      },
      staff: [],
    });

    /* ONE GROUND, ALL THE WAY DOWN. The review used to arrive on a white
       card — the same flow, handing you a different surface to finish on. */
    expect(await screen.findByText("Check it before it saves")).toBeInTheDocument();
    expect(card()).toHaveClass("wb2-dusk");
  });
});
