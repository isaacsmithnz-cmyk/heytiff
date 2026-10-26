/* The phone's 3D page: it says "ready" to the app, then draws only the
   scene and look the app hands it, through the bridge or a posted message. */

import { act, render, screen } from "@testing-library/react";

jest.mock("@/components/studio/view-3d", () => ({
  ALL_FLOORS: "all",
  View3D: ({ scene, look }: { scene: { span: number }; look: { floor: string; apart: boolean } }) => (
    <p>
      drawn {scene.span} m, floor {look.floor}, {look.apart ? "apart" : "together"}
    </p>
  ),
}));

import { Phone3D } from "../phone-3d";

const scene = { span: 12 } as never;
const said: string[] = [];
beforeEach(() => {
  said.length = 0;
  window.ReactNativeWebView = { postMessage: (m) => said.push(m) };
});
afterEach(() => {
  delete window.ReactNativeWebView;
});

it("says ready, then draws what the app hands it", () => {
  render(<Phone3D />);
  expect(said).toEqual(["ready"]);
  expect(screen.queryByText(/drawn/)).toBeNull();
  act(() => window.heytiff3d!({ scene }));
  expect(screen.getByText("drawn 12 m, floor all, together")).toBeTruthy();
  act(() => window.heytiff3d!({ look: { floor: "f1", apart: true, labels: true, layer: "inside" } }));
  expect(screen.getByText("drawn 12 m, floor f1, apart")).toBeTruthy();
});

it("takes a posted message too, for the app's web build in a frame", () => {
  render(<Phone3D />);
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { heytiff3d: { scene } } }));
  });
  expect(screen.getByText("drawn 12 m, floor all, together")).toBeTruthy();
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: "something else" }));
  });
  expect(screen.getByText("drawn 12 m, floor all, together")).toBeTruthy();
});

it("lets go of the bridge when it leaves", () => {
  const { unmount } = render(<Phone3D />);
  unmount();
  expect(window.heytiff3d).toBeUndefined();
});
