"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { TextInput } from "@/components/parts/field";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import type { RoofReading } from "@/lib/studio/reading";

/* TELL TIFF WHAT'S WRONG WITH THE 3D (Isaac, 20 October 2026: "She should
   also be able to revise 3d renderings if you are not happy, similar to
   how we have done it in chat"). A box under the 3D view: say it ("it's a
   hip roof at 25°", "the kitchen ceiling is 2.7"), and she reads the set
   again with what she read before and your words, and hands the roof and
   heights back corrected with a line saying what she changed. It goes on
   the design through the Studio's own history, so Undo takes it back. */

type Answer = { ok: true; roof: RoofReading; said: string } | { ok: false; error: string };

export type Reviser = (designId: string, words: string) => Promise<Answer>;

const reviseOnServer: Reviser = async (designId, words) => {
  try {
    const res = await fetch("/api/studio/revise-3d", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ designId, words }),
    });
    return (await res.json()) as Answer;
  } catch {
    return { ok: false, error: "Tiff couldn't be reached. Try again." };
  }
};

export function Revise3D({
  designId,
  onRoof,
  onUndo,
  reviser = reviseOnServer,
}: {
  designId: string;
  /** keeps the corrected roof on the design, through its history */
  onRoof: (roof: RoofReading) => void;
  onUndo: () => void;
  reviser?: Reviser;
}) {
  const [words, setWords] = useState("");
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);

  const send = async () => {
    const w = words.trim();
    if (!w || working) return;
    setWorking(true);
    setSaid(null);
    const got = await reviser(designId, w);
    setWorking(false);
    if (!got.ok) {
      setSaid({ text: got.error, bad: true });
      return;
    }
    onRoof(got.roof);
    setWords("");
    setSaid({ text: got.said, bad: false });
  };

  return (
    <div className="ds3-revise">
      {(working || said) && (
        <div className={`ds3-said${said?.bad ? " bad" : ""}`} role="status">
          <TiffGlyph size={24} working={working} />
          <span>{working ? "Tiff is reading the drawings again" : said?.text}</span>
          {said && !said.bad && (
            <Button kind="quiet" size={32} onClick={onUndo}>
              Undo
            </Button>
          )}
        </div>
      )}
      <form
        className="ds3-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <TextInput
          aria-label="What's wrong with the 3D"
          placeholder="What's wrong with it? Say it: a hip roof at 25°, the kitchen ceiling is 2.7"
          value={words}
          disabled={working}
          onChange={(e) => setWords(e.target.value)}
        />
        <Button kind="main" size={36} disabled={working || !words.trim()} onClick={() => void send()}>
          Change it
        </Button>
      </form>
    </div>
  );
}
