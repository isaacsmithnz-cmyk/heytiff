import { askBrain } from "../ask-client";

/* The browser's half of the Tiff modal's follow-up: the conversation so far
   rides with the question, so the route can replay it ahead of it. Without
   it "and the day after?" reaches the brain meaning nothing. The route caps
   and filters what it is sent (ask-route.test); this holds that it is sent,
   and only when there is some. */

const done = { onDelta: () => {}, onTool: () => {}, onError: () => {}, onDone: () => {} };

function stubFetch() {
  // jsdom has no ReadableStream: a reader that ends at once is all this needs
  const body = { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) };
  const fetch = jest.fn(async () => ({ ok: true, body }) as unknown as Response);
  global.fetch = fetch as unknown as typeof global.fetch;
  return fetch;
}

const sent = (fetch: jest.Mock) => JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string);

it("sends the conversation ahead of the question", async () => {
  const fetch = stubFetch();
  await askBrain(
    {
      question: "and the day after?",
      history: [
        { who: "you", text: "who's at 3323 tomorrow?" },
        { who: "tiff", text: "Luke, from 9:00." },
      ],
    },
    done
  );
  expect(sent(fetch).history).toEqual([
    { who: "you", text: "who's at 3323 tomorrow?" },
    { who: "tiff", text: "Luke, from 9:00." },
  ]);
});

it("sends no history when there is none", async () => {
  const fetch = stubFetch();
  await askBrain({ question: "who's at 3323 tomorrow?" }, done);
  expect(sent(fetch)).not.toHaveProperty("history");
});
