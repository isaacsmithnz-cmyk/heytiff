import { conversationDays, type FeedTodo, type QuoteChat } from "../job-conversation";

/* THE TIFF TAB (Isaac, 14 November 2026, call 20, mock E): the quote's chat is
   listed with the chats from her window, where its moment puts it */
const todo = (over: Partial<FeedTodo> = {}): FeedTodo => ({ id: "t1", title: "Chase Sharon", line: "", assigneeId: null, forLine: "For Isaac", by: "Isaac Smith", day: "2026-11-14", at: "2026-11-14 09:40", time: "9:40 am", done: false, ...over });

it("puts the quote's chat where its moment puts it", () => {
  const quote: QuoteChat = { day: "2026-11-13", at: "2026-11-13 16:52", time: "4:52 pm", text: "Priced at $775.00 + GST." };
  const days = conversationDays([], [], "2026-11-14", new Set(), true, [], [todo()], quote);
  expect(days.map((d) => d.items[0]!.quote?.text ?? d.items[0]!.todo?.id)).toEqual(["Priced at $775.00 + GST.", "t1"]);
});
