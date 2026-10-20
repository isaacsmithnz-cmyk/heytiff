"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { WALLED, middleOf, type Scene3D, type XZ } from "@/lib/studio/scene3d";

/* THE DESIGN IN 3D (Isaac, 20 October 2026: "a button on Design"). The
   scene is worked out in lib/studio/scene3d; this paints it with three.js,
   which loads only when the view first opens, so the Studio's own load
   carries none of it.

   The colours are the palette's (docs/design.md): white walls with an ink
   edge, windows blue, doors orange, indoor units ink, outdoor units grey,
   copper pipe in orange's word value. The prototype this follows is the
   Frogmore board (https://claude.ai/artifact/LdUcnNxQC3WEJ9Sx3WQtmB).

   What to show rides in from the top bar (`look`): which floor, the floors
   lifted apart, the labels. Drag turns, the wheel zooms. */

export type Look3D = { floor: string; apart: boolean; labels: boolean };
export const ALL_FLOORS = "all";

const C = {
  wall: 0xffffff,
  edge: 0x9ca3af,
  slab: 0xffffff,
  outside: 0x9ca3af,
  existing: 0x9ca3af,
  window: 0x2563eb,
  door: 0xf97316,
  indoor: 0x050505,
  outdoor: 0x9ca3af,
  pipe: 0xb45309,
  grid: 0x9ca3af,
};

/** how far apart the floors stand when lifted, over their own storey */
const LIFT_M = 3;

type Label = { el: HTMLDivElement; at: THREE_NS.Vector3; group: THREE_NS.Group; floorIndex: number; keep: boolean };

type Built = {
  apply: (look: Look3D) => void;
  dispose: () => void;
};

async function build(host: HTMLDivElement, scene3: Scene3D, look: Look3D): Promise<Built | null> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "ds3-gl";
  host.prepend(renderer.domElement);

  const [cx, cz] = scene3.center;
  const P = (p: XZ): [number, number] => [p[0] - cx, p[1] - cz];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  const top = Math.max(3, ...scene3.floors.map((f) => f.y0 + f.ceiling));
  const d = scene3.span * 1.25;
  camera.position.set(-0.75 * d, top + 0.6 * d, 0.95 * d);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, top / 2, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9ca3af, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-20, 32, 24);
  scene.add(sun);
  const gridSize = Math.ceil(scene3.span * 2.5);
  const grid = new THREE.GridHelper(gridSize, gridSize, C.grid, C.grid);
  (grid.material as THREE_NS.Material).opacity = 0.25;
  (grid.material as THREE_NS.Material).transparent = true;
  grid.position.y = Math.min(0, ...scene3.floors.map((f) => f.y0)) - 0.02;
  scene.add(grid);

  const M = (o: THREE_NS.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const wallMat = M({ color: C.wall, transparent: true, opacity: 0.86 });
  const edgeMat = new THREE.LineBasicMaterial({ color: C.edge });
  const slabMat = M({ color: C.slab, roughness: 1 });
  const outMat = M({ color: C.outside, transparent: true, opacity: 0.35, roughness: 1 });
  const oldMat = M({ color: C.existing, transparent: true, opacity: 0.45 });
  const winMat = M({ color: C.window, transparent: true, opacity: 0.8 });
  const doorMat = M({ color: C.door, transparent: true, opacity: 0.85 });
  const iduMat = M({ color: C.indoor, roughness: 0.6 });
  const oduMat = M({ color: C.outdoor, roughness: 0.6 });
  const pipeMat = M({ color: C.pipe, metalness: 0.3, roughness: 0.5 });

  const shape = (pts: XZ[]) => {
    const s = new THREE.Shape();
    pts.forEach((p, i) => {
      const [x, z] = P(p);
      if (i) s.lineTo(x, -z);
      else s.moveTo(x, -z);
    });
    return s;
  };
  const flat = (pts: XZ[], mat: THREE_NS.Material, y: number) => {
    const g = new THREE.ShapeGeometry(shape(pts));
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.y = y;
    return m;
  };
  const segBox = (a: XZ, b: XZ, y0: number, h: number, t: number, mat: THREE_NS.Material, edges: boolean): THREE_NS.Object3D[] => {
    const [x1, z1] = P(a);
    const [x2, z2] = P(b);
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05 || h <= 0) return [];
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), mat);
    m.position.set((x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    if (!edges) return [m];
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat);
    e.position.copy(m.position);
    e.rotation.copy(m.rotation);
    return [m, e];
  };

  const labels: Label[] = [];
  const label = (text: string, at: THREE_NS.Vector3, group: THREE_NS.Group, floorIndex: number, kind: "room" | "unit") => {
    if (!text.trim()) return;
    const el = document.createElement("div");
    el.className = `ds3-lab ${kind}`;
    el.textContent = text;
    host.appendChild(el);
    labels.push({ el, at, group, floorIndex, keep: kind === "unit" });
  };

  const groups = new Map<string, THREE_NS.Group>();
  scene3.floors.forEach((f, i) => {
    const g = new THREE.Group();
    groups.set(f.id, g);
    scene.add(g);
    for (const s of f.spaces) {
      if (s.kind === "void") continue;
      if (s.kind === "outdoor") {
        g.add(flat(s.pts, outMat, f.y0 - 0.02));
      } else if (s.existing) {
        g.add(flat(s.pts, oldMat, f.y0 + 0.005));
        for (let k = 0; k < s.pts.length; k++) g.add(...segBox(s.pts[k], s.pts[(k + 1) % s.pts.length], f.y0, f.ceiling, 0.1, oldMat, false));
      } else if (WALLED.has(s.kind)) {
        g.add(flat(s.pts, slabMat, f.y0 + 0.005));
        for (let k = 0; k < s.pts.length; k++) g.add(...segBox(s.pts[k], s.pts[(k + 1) % s.pts.length], f.y0, f.ceiling, 0.1, wallMat, true));
      }
      if (s.kind !== "stair" && s.kind !== "cupboard") {
        const [lx, lz] = P(middleOf(s.pts));
        label(s.name, new THREE.Vector3(lx, f.y0 + 0.4, lz), g, i, "room");
      }
    }
    for (const o of f.openings) {
      g.add(...segBox(o.a, o.b, f.y0 + o.sill, o.head - o.sill, o.external ? 0.16 : 0.13, o.kind === "window" ? winMat : doorMat, false));
    }
  });
  for (const u of scene3.units) {
    const g = groups.get(u.floorId);
    if (!g) continue;
    const i = scene3.floors.findIndex((f) => f.id === u.floorId);
    const m = new THREE.Mesh(new THREE.BoxGeometry(u.w, u.h, u.d), u.outdoor ? oduMat : iduMat);
    const [x, z] = P(u.at);
    m.position.set(x, u.y + u.h / 2, z);
    m.rotation.y = (-u.rot * Math.PI) / 180;
    g.add(m);
    label(u.label, new THREE.Vector3(x, u.y + u.h + 0.35, z), g, i, "unit");
  }
  for (const r of scene3.pipes) {
    const g = groups.get(r.floorId);
    if (!g) continue;
    const pts = r.pts.map(([x, y, z]) => new THREE.Vector3(x - cx, y, z - cz));
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 12, 0.035, 10, false), pipeMat));
  }

  let current = look;
  const apply = (l: Look3D) => {
    current = l;
    scene3.floors.forEach((f, i) => {
      const g = groups.get(f.id)!;
      g.visible = l.floor === ALL_FLOORS || l.floor === f.id;
      g.position.y = l.apart && l.floor === ALL_FLOORS ? i * LIFT_M : 0;
    });
  };
  apply(look);

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const watch = new ResizeObserver(resize);
  watch.observe(host);
  resize();

  const v = new THREE.Vector3();
  let raf = 0;
  const frame = () => {
    controls.update();
    renderer.render(scene, camera);
    const w = host.clientWidth;
    const h = host.clientHeight;
    /* a floor's room names hide under the floor above it, unless they're lifted apart */
    const covered = (i: number) =>
      !current.apart && current.floor === ALL_FLOORS && scene3.floors.some((_, j) => j > i);
    for (const l of labels) {
      v.copy(l.at);
      v.y += l.group.position.y;
      v.project(camera);
      const on = current.labels && l.group.visible && v.z < 1 && (l.keep || !covered(l.floorIndex));
      l.el.style.display = on ? "block" : "none";
      if (on) {
        l.el.style.left = `${((v.x + 1) / 2) * w}px`;
        l.el.style.top = `${((1 - v.y) / 2) * h}px`;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  frame();

  return {
    apply,
    dispose: () => {
      cancelAnimationFrame(raf);
      watch.disconnect();
      controls.dispose();
      for (const l of labels) l.el.remove();
      scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        m.geometry?.dispose?.();
      });
      for (const mat of [wallMat, slabMat, outMat, oldMat, winMat, doorMat, iduMat, oduMat, pipeMat, edgeMat]) mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function View3D({ scene, look }: { scene: Scene3D; look: Look3D }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const builtRef = useRef<Built | null>(null);
  const lookRef = useRef(look);
  const [noGl, setNoGl] = useState(false);

  useEffect(() => {
    lookRef.current = look;
    builtRef.current?.apply(look);
  }, [look]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let gone = false;
    void build(host, scene, lookRef.current).then((b) => {
      if (gone) {
        b?.dispose();
        return;
      }
      if (!b) setNoGl(true);
      builtRef.current = b;
    });
    return () => {
      gone = true;
      builtRef.current?.dispose();
      builtRef.current = null;
    };
  }, [scene]);

  return (
    <div className="ds3" ref={hostRef} aria-label="The design in 3D" role="img">
      {noGl && <p className="ds3-none">The 3D view needs WebGL, which this browser has turned off.</p>}
    </div>
  );
}
