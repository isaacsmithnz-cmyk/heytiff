import { chatThread } from "../keep-chat";

/* Tiff's chat is kept as a conversation (Isaac, 20 October 2026: after a
   day of talking to her, Conversations said "No conversations yet"). */

const T0 = 1_792_000_000_000;

it("keeps an exchange: your words and hers, titled by what you asked", () => {
  const t = chatThread("chat-a", [
    { who: "you", text: "  can I fit a ducted unit in the roof void? " },
    { who: "tiff", text: "Yes, over the hall: 620 clear." },
  ], T0);
  expect(t).toEqual({
    id: "chat-a",
    title: "can I fit a ducted unit in the roof void?",
    updatedAt: T0,
    messages: [
      { role: "user", text: "can I fit a ducted unit in the roof void?", at: T0 },
      { role: "tiff", text: "Yes, over the hall: 620 clear.", at: T0 },
    ],
  });
});

it("keeps nothing until she has answered", () => {
  expect(chatThread("chat-a", [{ who: "you", text: "who's at 3323 tomorrow?" }], T0)).toBeNull();
  expect(chatThread("chat-a", [{ who: "tiff", text: "Go ahead" }], T0)).toBeNull();
  expect(chatThread("chat-a", [{ who: "you", text: "  " }, { who: "tiff", text: "Hm" }], T0)).toBeNull();
});

it("keeps when each message was first said, and moves the thread only when something was added", () => {
  const first = chatThread("chat-a", [{ who: "you", text: "who's at 3323?" }, { who: "tiff", text: "Lyle." }], T0)!;
  const same = chatThread("chat-a", [{ who: "you", text: "who's at 3323?" }, { who: "tiff", text: "Lyle." }], T0 + 5000, first)!;
  expect(same.updatedAt).toBe(T0);
  const more = chatThread(
    "chat-a",
    [{ who: "you", text: "who's at 3323?" }, { who: "tiff", text: "Lyle." }, { who: "you", text: "and Friday?" }, { who: "tiff", text: "Dane." }],
    T0 + 9000,
    first,
  )!;
  expect(more.updatedAt).toBe(T0 + 9000);
  expect(more.messages.map((m) => m.at)).toEqual([T0, T0, T0 + 9000, T0 + 9000]);
});
