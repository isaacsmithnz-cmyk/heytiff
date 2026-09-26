/* A reply of yours in the diary says where it stands with ServiceM8 with
   the job card's own line, and offers the doors the task's line offers
   (task-sm8-line): Send again, Try again on one that failed or is still in
   ServiceM8, and the link question while it waits on you. */

import type { NoteSender } from "@/lib/integrations/links";
import { NOTE_WORDS, type NoteState } from "@/lib/integrations/sm8-note-plan";
import { replyLine } from "../diary-reply";

const state = (over: Partial<NoteState>): NoteState => ({ key: null, text: null, tone: null, acts: [], ...over });
const READY: NoteSender = { state: "ready", staffUuid: "u-isaac", remoteId: "u-isaac", sm8Name: "Isaac Smith", handle: "isaacsmith" };
const ASKING: NoteSender = { state: "confirm", remoteId: "u-isaac", sm8Name: "Isaac Smith", handle: "isaacsmith" };

it("says a sent reply is in ServiceM8, in the state's colour, with no door", () => {
  expect(replyLine(state({ key: "line.sent", text: "In ServiceM8", tone: "ok", acts: ["undo"] }), READY)).toEqual({
    text: "In ServiceM8",
    tone: "ok",
    again: null,
    ask: null,
  });
});

it("offers Try again on one that failed, and Send again on one that may be there already", () => {
  const failed = state({ key: "line.notSent", text: "Not sent to ServiceM8. ServiceM8 refused the note.", tone: "bad", acts: ["send_again", "undo"] });
  expect(replyLine(failed, READY)?.again).toEqual({ act: "send_again", label: NOTE_WORDS.door.tryAgain });
  const unsure = state({ key: "line.unsure", text: NOTE_WORDS.line.unsure, tone: "bad", acts: ["send_again", "undo"] });
  expect(replyLine(unsure, READY)?.again).toEqual({ act: "send_again", label: NOTE_WORDS.door.sendAgain });
});

it("offers Try again on one still in ServiceM8 after a take-back, which takes it out", () => {
  const still = state({ key: "line.stillIn", text: "Still in ServiceM8. HeyTiff hasn't taken it out yet.", tone: "bad", acts: ["take_out_again"] });
  expect(replyLine(still, READY)?.again).toEqual({ act: "take_out_again", label: NOTE_WORDS.door.tryAgain });
});

it("asks the link's question while it waits on you, and simply sends again once it is answered", () => {
  const refused = state({ key: "line.notSent", text: "Not sent to ServiceM8. Is Isaac Smith you?", tone: "bad", acts: ["confirm", "undo"] });
  expect(replyLine(refused, ASKING)).toMatchObject({ ask: "u-isaac", again: null });
  expect(replyLine(refused, READY)).toMatchObject({ ask: null, again: { act: "send_again", label: NOTE_WORDS.door.tryAgain } });
  // nobody known to answer for: the sentence, and no door
  expect(replyLine(refused, null)).toMatchObject({ ask: null, again: null });
});

it("says nothing for a state that says nothing", () => {
  expect(replyLine(state({}), READY)).toBeNull();
  expect(replyLine(null, READY)).toBeNull();
  expect(replyLine(undefined, READY)).toBeNull();
});
