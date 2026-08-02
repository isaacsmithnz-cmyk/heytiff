/* One brain, reachable from anywhere on the board.

   The pill's engine — routing words into tasks, flags and issues behind an
   editable review — used to be reachable only by pressing the pill, so a box
   literally labelled "Notes for the visit" was a dumb string field. This pins
   the bridge: the pill REGISTERS a sender, any field can hand it text, and a
   screen with no pill degrades to no button rather than a broken one. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { NoteBrainProvider, useNoteBrain } from "../note-brain-context";

/** Stands in for the pill: mounts, registers, unmounts. */
function Registrar({ send }: { send: (text: string) => void }) {
  const { register } = useNoteBrain();
  useEffect(() => {
    register(send);
    return () => register(null);
  }, [register, send]);
  return null;
}

/** Stands in for a notes field somewhere inside a sheet. */
function Field({ text }: { text: string }) {
  const { send, voiceEnabled } = useNoteBrain();
  return (
    <>
      <span>{voiceEnabled ? "voice on" : "typing only"}</span>
      {send && (
        <button type="button" onClick={() => send(text)}>
          Sort this out
        </button>
      )}
    </>
  );
}

describe("the note brain bridge", () => {
  it("hands a field's text to whatever registered the engine", async () => {
    const send = jest.fn();
    render(
      <NoteBrainProvider voiceEnabled>
        <Registrar send={send} />
        <Field text="Luke needs to order the grilles" />
      </NoteBrainProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    expect(send).toHaveBeenCalledWith("Luke needs to order the grilles");
  });

  it("offers nothing at all when no pill is mounted — the field still works, it just can't route", () => {
    render(
      <NoteBrainProvider voiceEnabled={false}>
        <Field text="anything" />
      </NoteBrainProvider>
    );
    expect(screen.queryByRole("button", { name: "Sort this out" })).not.toBeInTheDocument();
  });

  it("carries whether this deployment can hear you, so every dictation box agrees", () => {
    const { unmount } = render(
      <NoteBrainProvider voiceEnabled>
        <Field text="x" />
      </NoteBrainProvider>
    );
    expect(screen.getByText("voice on")).toBeInTheDocument();
    unmount();
    render(
      <NoteBrainProvider voiceEnabled={false}>
        <Field text="x" />
      </NoteBrainProvider>
    );
    expect(screen.getByText("typing only")).toBeInTheDocument();
  });

  it("un-registers when the pill goes, so a stale sender can't be called", async () => {
    const send = jest.fn();
    const { rerender } = render(
      <NoteBrainProvider voiceEnabled>
        <Registrar send={send} />
        <Field text="x" />
      </NoteBrainProvider>
    );
    expect(screen.getByRole("button", { name: "Sort this out" })).toBeInTheDocument();
    rerender(
      <NoteBrainProvider voiceEnabled>
        <Field text="x" />
      </NoteBrainProvider>
    );
    expect(screen.queryByRole("button", { name: "Sort this out" })).not.toBeInTheDocument();
  });
});
