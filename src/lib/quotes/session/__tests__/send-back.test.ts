/* Sent back before she answers (send-back.ts): asked about the heat load,
   she runs room_load; the 3465 re-run, 10 November 2026. */
import { LOAD_SEND_BACK, sendBack } from "../send-back";

const said = (t: string) => `<the-job>\nOld notes: heat load done in 2024\n</the-job>\n\nIsaac Smith says:\n${t}`;

it("sends her back when asked about the load and she ran no room_load", () => {
  expect(sendBack(said("Um, have a look at the heat load. I think we want about a fourteen kilowatt"), ["look_at", "add_lines"])).toBe(LOAD_SEND_BACK);
  expect(sendBack("Is 7.1 kW big enough for the lounge?", [])).toBe(LOAD_SEND_BACK);
  expect(sendBack("Will the 14 kW cover it?", [])).toBe(LOAD_SEND_BACK);
  expect(sendBack("Can you check the sizing for me", [])).toBe(LOAD_SEND_BACK);
  expect(sendBack("Run a room load on the bedrooms", [])).toBe(LOAD_SEND_BACK);
});

it("lets her answer once she's run it, or when the load wasn't asked about", () => {
  expect(sendBack(said("have a look at the heat load"), ["plan_rooms", "room_load"])).toBeNull();
  expect(sendBack(said("Let's allow three fifty for decommissioning and removal."), [])).toBeNull();
  /* the job's brief can mention a load: only the person's words count */
  expect(sendBack(said("Add a 6 m drain hose."), [])).toBeNull();
  expect(sendBack("Quote this job.", [])).toBeNull();
});
