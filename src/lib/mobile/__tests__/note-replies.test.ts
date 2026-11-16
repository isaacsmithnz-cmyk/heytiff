import { replyableNotes } from "../note-replies";

const ready = { state: "ready" as const, staffUuid: "ME", remoteId: "ME", sm8Name: "Isaac Smith", handle: "isaacsmith" };

describe("which notes the phone offers a reply on", () => {
  test("a ServiceM8 note that mentions you, not your own, nor one that doesn't", () => {
    expect(
      replyableNotes(
        ready,
        [
          { remoteId: "a", text: "@IsaacSmith see comments??", authorSm8Uuid: "luke" },
          { remoteId: "b", text: "@IsaacSmith note to self", authorSm8Uuid: "me" },
          { remoteId: "c", text: "Booked for Monday", authorSm8Uuid: "luke" },
        ],
        []
      )
    ).toEqual({ a: "a" });
  });

  test("one of ours by someone else, once ServiceM8 holds it, answers its ServiceM8 copy", () => {
    expect(
      replyableNotes(ready, [], [
        { id: "row-1", text: "@isaacsmith can you look", sm8Uuid: "sm8-1" },
        { id: "row-2", text: "@isaacsmith not gone yet", sm8Uuid: null },
        { id: "row-3", text: "@isaacsmith mine", sm8Uuid: "sm8-3", mine: true },
        { id: "row-4", text: "@isaacsmith taken back", sm8Uuid: "sm8-4", removed: true },
      ])
    ).toEqual({ "row-1": "sm8-1" });
  });

  test("nothing while you can't send as yourself", () => {
    const notes = [{ remoteId: "a", text: "@IsaacSmith see comments??" }];
    expect(replyableNotes({ state: "confirm", remoteId: "ME", sm8Name: "Isaac Smith", handle: "isaacsmith" }, notes, [])).toEqual({});
    expect(replyableNotes(null, notes, [])).toEqual({});
  });
});
