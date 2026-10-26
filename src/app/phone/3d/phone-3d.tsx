"use client";

import { useEffect, useState } from "react";
import { ALL_FLOORS, View3D, type Look3D } from "@/components/studio/view-3d";
import type { Scene3D } from "@/lib/studio/scene3d";

/* THE PHONE'S 3D (Isaac, 27 October 2026: "the way that I was able to view
   and control it in the chat session was pretty much perfect"). That was
   the web's 3D in a browser, so the phone shows the same: the Studio's own
   View3D, in a web view over the app's Design screen. One finger turns
   the house, two pinch and slide it, as they did there.

   The page reads nothing, no session and no workspace. The app fetches the
   design's scene with its own token (api/mobile/designs/[id]/scene) and
   hands it in, with the look its buttons set (which floor, lifted apart,
   labels, roof or framing or inside):
   - in the app, by calling `window.heytiff3d` once the page says "ready"
     through the web view's bridge;
   - in a frame (the app's web build), by posting `{ heytiff3d }`.
   Whatever is handed in is only drawn, so a stranger handing it something
   draws them a house and nothing else. */

export type Posted = { scene?: Scene3D; look?: Look3D };

declare global {
  interface Window {
    heytiff3d?: (p: Posted) => void;
    ReactNativeWebView?: { postMessage: (m: string) => void };
  }
}

export function Phone3D() {
  const [scene, setScene] = useState<Scene3D | null>(null);
  const [look, setLook] = useState<Look3D>({ floor: ALL_FLOORS, apart: false, labels: true, layer: "roof" });

  useEffect(() => {
    const take = (p: Posted) => {
      if (p.scene) setScene(p.scene);
      if (p.look) setLook(p.look);
    };
    const onMessage = (e: MessageEvent) => {
      const d: unknown = e.data;
      if (d && typeof d === "object" && "heytiff3d" in d && typeof d.heytiff3d === "object" && d.heytiff3d) take(d.heytiff3d as Posted);
    };
    window.heytiff3d = take;
    window.addEventListener("message", onMessage);
    window.ReactNativeWebView?.postMessage("ready");
    if (window.parent !== window) window.parent.postMessage({ heytiff3d: "ready" }, "*");
    return () => {
      window.removeEventListener("message", onMessage);
      if (window.heytiff3d === take) delete window.heytiff3d;
    };
  }, []);

  return <div className="dstudio" style={{ position: "fixed", inset: 0 }}>{scene ? <View3D scene={scene} look={look} /> : null}</div>;
}
