/* A reply is a reply (two-way phase 2, PR B): dictating one never offers
   Tiff's review, however much the words sound like work. The field's
   `offer={false}` is what the reply box passes; `onSpoken` tells it the
   words were said, which the reply keeps as its source. */

import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { NoteToken } from "../note-token";
import { NoteScopeProvider, NoteScopeScreen } from "../note-context";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

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
        handing: false,
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

afterEach(cleanup);

function Box({ offer, onSpoken }: { offer?: boolean; onSpoken?: () => void }) {
  const [v, setV] = useState("");
  return <NoteToken as="field" label="a reply" rows={2} value={v} onChange={setV} offer={offer} onSpoken={onSpoken} />;
}

const mount = (ui: React.ReactElement) =>
  render(
    <NoteScopeProvider voiceEnabled>
      <NoteScopeScreen staffFirstNames={["Luke"]} />
      {ui}
    </NoteScopeProvider>
  );

const WORK = "Tell Luke he needs to order the grilles before Monday";

describe("the field's Tiff offer", () => {
  it("is made on dictated words that sound like work, as ever", () => {
    mount(<Box />);
    act(() => heard.say!(WORK));
    expect(screen.getByText(/something to do in this/)).toBeInTheDocument();
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
