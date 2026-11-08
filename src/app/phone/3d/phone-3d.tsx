"use client";

import { useEffect, useRef, useState } from "react";
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
   draws them a house and nothing else.

   AR (Isaac, 8 November 2026: "Can we just have it built into the app
   itself without having to go externally?"): asked `{ glb: true }`, the
   page hands back the house as it shows now, a GLB in base64, as
   `{"glb": "..."}` (or `{"glb": null}` when there's none), for the app's
   own AR to stand on a table. */

export type Posted = { scene?: Scene3D; look?: Look3D; glb?: true };

/** an ArrayBuffer as base64, a slice at a time so a big house doesn't overflow the call */
function base64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

declare global {
  interface Window {
    heytiff3d?: (p: Posted) => void;
    ReactNativeWebView?: { postMessage: (m: string) => void };
  }
}

export function Phone3D() {
  const [scene, setScene] = useState<Scene3D | null>(null);
  const [look, setLook] = useState<Look3D>({ floor: ALL_FLOORS, apart: false, labels: true, layer: "roof" });
  const glbRef = useRef<(() => Promise<ArrayBuffer>) | null>(null);

  useEffect(() => {
    const answer = (m: { glb: string | null }) => {
      window.ReactNativeWebView?.postMessage(JSON.stringify(m));
      if (window.parent !== window) window.parent.postMessage({ heytiff3d: m }, "*");
    };
    const house = async () => {
      const make = glbRef.current;
      if (!make) return answer({ glb: null });
      try {
        answer({ glb: base64(await make()) });
      } catch {
        answer({ glb: null });
      }
    };
    const take = (p: Posted) => {
      if (p.scene) setScene(p.scene);
      if (p.look) setLook(p.look);
      if (p.glb) void house();
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

  return <div className="dstudio" style={{ position: "fixed", inset: 0 }}>{scene ? <View3D scene={scene} look={look} onHouse={(g) => (glbRef.current = g)} /> : null}</div>;
}
