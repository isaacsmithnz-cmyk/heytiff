import { act, render, screen, waitFor } from "@testing-library/react";
import type { RecordRef } from "@/lib/records/ref";

/* WHO ELSE HAS THIS RECORD OPEN. A card joins its record's private channel
   on the workspace's own topic, says who it is, hears who else is there and
   word when they change it, and leaves when it closes. Live records are on
   unless the deployment switches them off, and then it asks for nothing.
   The Realtime client is a stand-in that records what the card did with
   it. */

type Handler = (arg: { payload?: unknown }) => void;
const channels: FakeChannel[] = [];
class FakeChannel {
  handlers: Record<string, Handler> = {};
  state: Record<string, { id: string; name: string }[]> = {};
  tracked: unknown = null;
  sent: unknown[] = [];
  untracked = false;
  constructor(
    public topic: string,
    public opts: unknown,
  ) {
    channels.push(this);
  }
  on(type: string, filter: { event: string }, cb: Handler) {
    this.handlers[`${type}:${filter.event}`] = cb;
    return this;
  }
  subscribe(cb: (status: string) => void) {
    cb("SUBSCRIBED");
    return this;
  }
  presenceState() {
    return this.state;
  }
  async track(meta: unknown) {
    this.tracked = meta;
  }
  async untrack() {
    this.untracked = true;
  }
  async send(msg: unknown) {
    this.sent.push(msg);
  }
}
const removed: FakeChannel[] = [];
const setAuth = jest.fn(async () => {});
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    realtime: { setAuth },
    channel: (topic: string, opts: unknown) => new FakeChannel(topic, opts),
    removeChannel: async (ch: FakeChannel) => {
      removed.push(ch);
    },
  }),
}));
const ticket = jest.fn();
jest.mock("@/app/actions/realtime", () => ({ realtimeTicket: () => ticket() }));

import * as presence from "../use-record-presence";

/** On is the flag unset; off is the deployment's "0". */
function load(live: boolean) {
  if (live) delete process.env.NEXT_PUBLIC_LIVE_RECORDS;
  else process.env.NEXT_PUBLIC_LIVE_RECORDS = "0";
  presence.forgetLiveTicket();
  return presence;
}

function Card({ mod, record }: { mod: typeof presence; record: RecordRef | null }) {
  const live = mod.useRecordPresence(record);
  return (
    <div>
      <output aria-label="here">{mod.hereSaid(live.others) ?? "alone"}</output>
      <output aria-label="heard">{live.heard ? `${live.heard.what}:${live.heard.n}` : "nothing"}</output>
      <button onClick={() => live.announce("diary")}>Write</button>
    </div>
  );
}

beforeEach(() => {
  channels.length = 0;
  removed.length = 0;
  ticket.mockReset().mockResolvedValue({
    token: "t.o.k",
    expiresAt: Date.now() + 3_600_000,
    orgId: "org-1",
    me: { id: "auth0|me", name: "Isaac" },
  });
});

it("joins the record's private channel on its workspace's topic, and says who it is", async () => {
  const mod = load(true);
  render(<Card mod={mod} record={{ kind: "job", id: "j-1" }} />);
  await waitFor(() => expect(channels).toHaveLength(1));
  expect(setAuth).toHaveBeenCalledWith("t.o.k");
  expect(channels[0]!.topic).toBe("record:org-1:job:j-1");
  expect(channels[0]!.opts).toMatchObject({ config: { private: true, presence: { key: "auth0|me" } } });
  expect(channels[0]!.tracked).toEqual({ id: "auth0|me", name: "Isaac" });
});

it("says who else is there, never itself", async () => {
  const mod = load(true);
  render(<Card mod={mod} record={{ kind: "job", id: "j-1" }} />);
  await waitFor(() => expect(channels).toHaveLength(1));
  const ch = channels[0]!;
  ch.state = {
    "auth0|me": [{ id: "auth0|me", name: "Isaac" }],
    "auth0|dane": [{ id: "auth0|dane", name: "Dane" }],
  };
  act(() => ch.handlers["presence:sync"]!({}));
  expect(screen.getByRole("status", { name: "here" })).toHaveTextContent("Dane has this open too");
});

it("hears word of a change, and sends its own", async () => {
  const mod = load(true);
  render(<Card mod={mod} record={{ kind: "job", id: "j-1" }} />);
  await waitFor(() => expect(channels).toHaveLength(1));
  const ch = channels[0]!;
  act(() => ch.handlers["broadcast:changed"]!({ payload: { what: "diary" } }));
  act(() => ch.handlers["broadcast:changed"]!({ payload: { what: "diary" } }));
  expect(screen.getByRole("status", { name: "heard" })).toHaveTextContent("diary:2");
  act(() => screen.getByRole("button", { name: "Write" }).click());
  expect(ch.sent).toEqual([{ type: "broadcast", event: "changed", payload: { what: "diary" } }]);
});

it("leaves the channel when the card closes", async () => {
  const mod = load(true);
  const { unmount } = render(<Card mod={mod} record={{ kind: "job", id: "j-1" }} />);
  await waitFor(() => expect(channels).toHaveLength(1));
  unmount();
  expect(channels[0]!.untracked).toBe(true);
  expect(removed).toContain(channels[0]);
});

it("asks for nothing while the deployment has live records switched off", async () => {
  const mod = load(false);
  render(<Card mod={mod} record={{ kind: "job", id: "j-1" }} />);
  await act(async () => {});
  expect(ticket).not.toHaveBeenCalled();
  expect(channels).toHaveLength(0);
  expect(screen.getByRole("status", { name: "here" })).toHaveTextContent("alone");
});

it("joins nothing without a ticket", async () => {
  ticket.mockResolvedValue(null);
  const mod = load(true);
  render(<Card mod={mod} record={{ kind: "job", id: "j-1" }} />);
  await act(async () => {});
  expect(channels).toHaveLength(0);
});

describe("the words", () => {
  it("name one, two, or two and how many more", () => {
    const { hereSaid } = load(false);
    const p = (name: string) => ({ id: name, name });
    expect(hereSaid([])).toBeNull();
    expect(hereSaid([p("Dane")])).toBe("Dane has this open too");
    expect(hereSaid([p("Dane"), p("Mia")])).toBe("Dane and Mia have this open too");
    expect(hereSaid([p("Dane"), p("Mia"), p("Sam"), p("Jo")])).toBe("Dane, Mia and 2 more have this open too");
  });
});
