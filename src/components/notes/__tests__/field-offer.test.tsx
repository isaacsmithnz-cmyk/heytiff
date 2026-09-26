/* The field's Tiff offer. Dictated words that sound like work get a quiet
   line under the box, and "Have a look" opens the Tiff modal on them (it
   opened the capture card's review until the old capture UI went,
   2026-09-27).

   A reply is a reply (two-way phase 2, PR B): dictating one never offers
   Tiff, however much the words sound like work. The field's `offer={false}`
   is what the reply box passes; `onSpoken` tells it the words were said,
   which the reply keeps as its source. */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { NoteToken } from "../note-token";
import { NoteScopeProvider, NoteScopeScreen } from "../note-context";
import { TiffContext, type TiffApi, type TiffOpen } from "@/components/tiff/modal/tiff-context";

/** The engine, with its transcript handed over by the test. */
const heard: { say?: (words: string) => void } = {};
jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: (opts: { onTranscript: (w: string) => void }) => {
      const react = jest.requireActual("react") as typeof import("react");
      heard.say = opts.onTranscript;
      return {
        recording: false,
        arming: false,
        transcribing: false,
        interim: "",
        seconds: 0,
        barsRef: react.createRef(),
        start: jest.fn(),
        stop: jest.fn(),
        handOver: jest.fn(),
        cancel: jest.fn(),
        restart: jest.fn(),
      };
    },
  };
});

/** The modal's door, as the frame's host offers it. */
const open = jest.fn((_o: TiffOpen) => true);
const tiff: TiffApi = { open: (o) => open(o), openedBy: null, isOpen: false, landed: null };

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

function Box({ offer, onSpoken }: { offer?: boolean; onSpoken?: () => void }) {
  const [v, setV] = useState("");
  return <NoteToken as="field" label="a reply" rows={2} value={v} onChange={setV} offer={offer} onSpoken={onSpoken} />;
}

const mount = (ui: React.ReactElement) =>
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffContext.Provider value={tiff}>
        <NoteScopeScreen staffFirstNames={["Luke"]} />
        {ui}
      </TiffContext.Provider>
    </NoteScopeProvider>
  );

const WORK = "Tell Luke he needs to order the grilles before Monday";

describe("the field's Tiff offer", () => {
  it("is made on dictated words that sound like work, as ever", () => {
    mount(<Box />);
    act(() => heard.say!(WORK));
    expect(screen.getByText(/something to do in this/)).toBeInTheDocument();
    // an offer, not an opening
    expect(open).not.toHaveBeenCalled();
  });

  /* (F) The field's words are the modal's first turn; focus comes back to
     the box, because the button pressed goes with the offer. */
  it("opens the Tiff modal on the words when taken, and goes", async () => {
    mount(<Box />);
    act(() => heard.say!(WORK));
    const look = screen.getByRole("button", { name: "Have a look" });
    await userEvent.click(look);

    expect(open).toHaveBeenCalledTimes(1);
    /* One by one, by identity: a matcher that walks a DOM node's properties
       walks the whole document behind it. */
    const o = open.mock.calls[0][0];
    expect(o.words).toBe(WORK);
    expect(o.from).toBe(look);
    expect(o.back).toBe(screen.getByRole("textbox"));
    expect(screen.queryByText(/something to do in this/)).toBeNull();
    // the box keeps what was said: Tiff was handed a copy
    expect(screen.getByRole("textbox")).toHaveValue(WORK);
  });

  it("(F) is never made in a reply box, and the box is told the words were said", () => {
    const spoken = jest.fn();
    mount(<Box offer={false} onSpoken={spoken} />);
    act(() => heard.say!(WORK));
    expect(screen.queryByText(/something to do in this/)).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue(WORK);
    expect(spoken).toHaveBeenCalledTimes(1);
  });
});
