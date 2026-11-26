"use client";

import { Button } from "@/components/parts/button";
import { readOut, stopSpeaking, unlockSpeech, useReadingOut, useVoiceUnavailable, VOICE_UNAVAILABLE } from "@/lib/voice/speaker";

/* READ OUT, under every answer of hers (Isaac, 26 November 2026, "Flow's
   right" to https://claude.ai/artifact/2vtUgVFZHbJf5gamXZZBPm, board 1). A
   quiet door like Undo: pressed, she reads the answer out, the boomerang
   goes up on her mark, her head says "Reading out" and the door is Stop
   reading. One answer is read at a time, page-wide (lib/voice/speaker). */

/** What Read out knows a turn of the Tiff modal's conversation by (the
    modal and a job's box share the conversation). */
export const readKey = (key: string) => `tiff-modal:${key}`;

/** True while the answer `id` is being read out. */
export function useIsReading(id: string): boolean {
  return useReadingOut() === id;
}

export function ReadOut({ id, text, door = false }: { id: string; text: string; /** The feed's small grey door, beside the time. */ door?: boolean }) {
  const on = useIsReading(id);
  const unvoiced = useVoiceUnavailable(id);
  if (!text.trim()) return null;
  /* her voice couldn't be had: said, and nothing played (Isaac, 27 November 2026) */
  const said = unvoiced && <span className="tf-reading" role="status">{VOICE_UNAVAILABLE}</span>;
  const press = () => {
    if (on) return stopSpeaking();
    unlockSpeech();
    void readOut(id, text);
  };
  if (door)
    return (
      <>
        <button type="button" className="jc-bmdoor" onClick={press}>
          {on ? "Stop reading" : "Read out"}
        </button>
        {said}
      </>
    );
  return (
    <>
      <Button kind="quiet" size={32} onClick={press}>
        {on ? "Stop reading" : "Read out"}
      </Button>
      {said}
    </>
  );
}

/** Beside her name while she reads, as the time sits there. */
export function ReadingWord() {
  return <span className="tf-reading">Reading out</span>;
}
