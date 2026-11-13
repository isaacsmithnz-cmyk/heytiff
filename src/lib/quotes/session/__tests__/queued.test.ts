import { waitingIds } from "../queued";

/* Isaac, 13 November 2026: "Build E, the answering while she works" */
const e = (id: number, turnId: string | null, kind: string, body: Record<string, unknown> = {}) => ({ id, turnId, kind, body });

it("waits until a turn begins after it, though the page still reads it as queued", () => {
  const working = [e(1, "t1", "message", { text: "15" }), e(2, "t1", "tool"), e(3, null, "message", { text: "1", queued: true })];
  expect(waitingIds(working)).toEqual([3]);
  // her turn for 15 ends: still waiting, until she starts on it
  const ended = [...working, e(4, "t1", "usage")];
  expect(waitingIds(ended)).toEqual([3]);
  expect(waitingIds([...ended, e(5, "t2", "tool")])).toEqual([]);
  // a message never queued never waits
  expect(waitingIds([e(1, null, "message", { text: "hi" })])).toEqual([]);
});
