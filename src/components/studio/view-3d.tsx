"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { WALLED, middleOf, type Floor3D, type Grille3D, type Opening3D, type Scene3D, type Space3D, type Unit3D, type XZ } from "@/lib/studio/scene3d";
import { within } from "@/lib/studio/furnish3d";
import { pieceMaker } from "./view-3d-pieces";
import { airMaker } from "./view-3d-air";

/* THE DESIGN IN 3D (Isaac, 20 October 2026: "a button on Design"). The
   scene is worked out in lib/studio/scene3d; this paints it with three.js,
   which loads only when the view first opens, so the Studio's own load
   carries none of it.

   THE NEXT LOOK (mock, Isaac 7 November 2026: "Mock up", then "I want to make
   these things really pop"): the room lit as a room is, soft shadows on the
   ground, floors with their finish or the floor's own drawing laid on them,
   walls with their windows and doors cut in, units shaped as what they are,
   ducts at their size and colour, pipes that join up.

   What to show rides in from the top bar (`look`): which floor, the floors
   lifted apart, the labels, the drawing or the grid. Drag turns, the wheel
   zooms.

   FURTHER (mock, Isaac 8 November 2026: "Push mock further"): the rooms
   furnished, off the drawing where Tiff read it; the stairs as steps; decks
   and balustrades; the lawn, trees and sky outside; the light settling into
   corners (ambient occlusion); the air leaving each head; and a double-click
   on a floor to stand in that room at eye height, facing its head. */

/** Roof: the roof on, Framing: the timber under it, Inside: neither, nor the ceilings */
export type Layer3D = "roof" | "framing" | "inside";
/** `plans`: each floor's drawing on it (the default), or the grid and the floors' finish */
/** `outside`: the lawn round the house, its trees and the sky; `air`: the air leaving each head and grille */
export type Look3D = { floor: string; apart: boolean; labels: boolean; layer: Layer3D; plans?: boolean; outside?: boolean; air?: boolean };
export const ALL_FLOORS = "all";

const C = {
  wall: 0xffffff,
  edge: 0x9ca3af,
  outside: 0xd1d5db,
  existing: 0x9ca3af,
  pipe: 0xb45309,
  grid: 0x9ca3af,
  roof: 0x4b5563,
  ceiling: 0xffffff,
  /* timber as it is: pine, the ridge and hips a shade darker */
  rafter: 0xd2b07c,
  joist: 0xe2c592,
  ridge: 0xb98b55,
  frame: 0x374151,
  glass: 0xbfdbfe,
  leaf: 0xc8a27a,
  slabSide: 0xe5e7eb,
};

/** how far apart the floors stand when lifted, over their own storey */
const LIFT_M = 3;
/** a floor plate's thickness, as drawn under each room */
const SLAB_M = 0.15;
/** how far a unit's name stands over it, metres */
const STEM_M = 0.6;

type Label = {
  el: HTMLDivElement;
  at: THREE_NS.Vector3;
  /** a unit's top, where its name's line comes down to */
  base: THREE_NS.Vector3 | null;
  group: THREE_NS.Group;
  floorIndex: number;
  kind: "room" | "unit" | "riser";
  /** a unit's place on the plan, so standing in a room shows only its own */
  unitAt?: XZ;
  outdoor?: boolean;
};

type Built = {
  apply: (look: Look3D) => void;
  /** stand back out of a room */
  backOut: () => void;
  dispose: () => void;
};

/** "FAMILY ROOM" reads as "Family room": no type in capitals */
const sentence = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s);

async function build(host: HTMLDivElement, scene3: Scene3D, look: Look3D, planUrl: ((ref: string) => Promise<string>) | undefined, onStand: (standing: boolean) => void): Promise<Built | null> {
  let gone = false;
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
  const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
  const { GTAOPass } = await import("three/examples/jsm/postprocessing/GTAOPass.js");
  const { OutputPass } = await import("three/examples/jsm/postprocessing/OutputPass.js");
  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "ds3-gl";
  host.prepend(renderer.domElement);
  /* the names' lines, drawn over the picture */
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ds3-lines");
  host.appendChild(svg);

  const disposables: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

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

  /* LIGHT AS A ROOM HAS IT: a soft room all round for the reflections and the
     shade, and one sun that casts */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = own(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  pmrem.dispose();
  scene.environment = env;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd1d5db, 0.8));
  /* standing in a room, the light the room bounces about: its ceiling and walls aren't left in the dark */
  const bounce = new THREE.AmbientLight(0xffffff, 0);
  scene.add(bounce);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-0.6 * d, top + 1.2 * d, 0.45 * d);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const reach = scene3.span * 0.9 + 4;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: d * 4 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  scene.fog = new THREE.Fog(0xffffff, d * 1.8, d * 4.5);

  const groundY = Math.min(0, ...scene3.floors.map((f) => f.y0));
  const gridSize = Math.ceil(scene3.span * 2.5);
  const grid = new THREE.GridHelper(gridSize, gridSize, C.grid, C.grid);
  (grid.material as THREE_NS.Material).opacity = 0.25;
  (grid.material as THREE_NS.Material).transparent = true;
  grid.position.y = groundY - 0.02;
  scene.add(grid);
  /* the house's shadow on the ground, and nothing else of the ground */
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(gridSize * 2, gridSize * 2), own(new THREE.ShadowMaterial({ opacity: 0.16 })));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = groundY - 0.015;
  catcher.receiveShadow = true;
  scene.add(catcher);
  /* the light settling into corners and under things (ambient occlusion),
     over the picture as drawn; see-through things cast none. A phone goes
     without: its picture is drawn every frame, on its battery */
  let composer: InstanceType<typeof EffectComposer> | null = null;
  if (!window.matchMedia?.("(pointer: coarse)").matches) try {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.5, scale: 1.1, samples: 16 });
    ao.blendIntensity = 0.85;
    /* a roof's sheet is seen from either side: its far side mustn't let the rafters under it through */
    (ao as unknown as { normalMaterial: THREE_NS.Material }).normalMaterial.side = THREE.DoubleSide;
    const hide = ao.overrideVisibility.bind(ao);
    ao.overrideVisibility = () => {
      hide();
      scene.traverse((o) => {
        const m = (o as THREE_NS.Mesh).material as THREE_NS.Material | THREE_NS.Material[] | undefined;
        if (m && !Array.isArray(m) && m.transparent) o.visible = false;
      });
    };
    composer.addPass(ao);
    composer.addPass(new OutputPass());
  } catch {
    composer = null;
  }

  const M = (o: THREE_NS.MeshStandardMaterialParameters) => own(new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }));
  const wallMat = M({ color: C.wall, roughness: 0.9 });
  const edgeMat = own(new THREE.LineBasicMaterial({ color: C.edge }));
  const outMat = M({ color: C.outside, transparent: true, opacity: 0.6, roughness: 1 });
  const oldMat = M({ color: C.existing, transparent: true, opacity: 0.45 });
  const pipeMat = M({ color: C.pipe, metalness: 0.6, roughness: 0.35 });
  const roofMat = M({ color: C.roof, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.35 });
  const oldRoofMat = M({ color: C.existing, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
  const fillMat = M({ color: C.wall, side: THREE.DoubleSide });
  const ceilMat = M({ color: C.ceiling, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const roofEdge = own(new THREE.LineBasicMaterial({ color: 0x1f2937 }));
  const timber = {
    rafter: M({ color: C.rafter, roughness: 0.8 }),
    hip: M({ color: C.ridge, roughness: 0.8 }),
    ridge: M({ color: C.ridge, roughness: 0.8 }),
    joist: M({ color: C.joist, roughness: 0.8 }),
  };
  /* a room you drew, over the plan it was drawn on: glass, so the drawing reads through */
  const zoneMat = M({ color: C.wall, transparent: true, opacity: 0.32, depthWrite: false });
  const meshOf = (m: { verts: [number, number, number][]; tris: number[] }, mat: THREE_NS.Material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.verts.flatMap(([x, y, z]) => [x - cx, y, z - cz]), 3));
    g.setIndex(m.tris);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };
  const canvasTex = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    draw(cv.getContext("2d")!);
    const t = own(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  /** a texture laid in metres: one tile of it covers `m` metres */
  const tiled = (t: THREE_NS.Texture, m: number) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / m, 1 / m);
    return t;
  };

  /* ── FLOORS: their finish, or white under the drawing ── */
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const oak = tiled(
    canvasTex(512, 512, (c) => {
      const rows = 16;
      const h = 512 / rows;
      for (let r = 0; r < rows; r++) {
        let x = -Math.floor(rnd() * 300);
        while (x < 512) {
          const len = 220 + Math.floor(rnd() * 260);
          const tone = 205 + Math.floor(rnd() * 22);
          c.fillStyle = `rgb(${tone}, ${tone - 28}, ${tone - 62})`;
          c.fillRect(x, r * h, len, h);
          c.fillStyle = "rgba(90, 60, 30, 0.07)";
          for (let k = 0; k < 5; k++) c.fillRect(x, r * h + 3 + Math.floor(rnd() * (h - 6)), len, 1);
          c.fillStyle = "rgba(80, 55, 30, 0.35)";
          c.fillRect(x, r * h, 2, h);
          x += len;
        }
        c.fillStyle = "rgba(80, 55, 30, 0.3)";
        c.fillRect(0, r * h, 512, 1);
      }
    }),
    2.4
  );
  const tile = tiled(
    canvasTex(256, 256, (c) => {
      c.fillStyle = "#C9CED6";
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const tone = 228 + Math.floor(rnd() * 8);
          c.fillStyle = `rgb(${tone}, ${tone + 1}, ${tone + 3})`;
          c.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
        }
    }),
    1.2
  );
  const concrete = tiled(
    canvasTex(256, 256, (c) => {
      c.fillStyle = "#D4D4D2";
      c.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 2600; k++) {
        const v = 180 + Math.floor(rnd() * 60);
        c.fillStyle = `rgba(${v}, ${v}, ${v - 4}, 0.35)`;
        c.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 2, 2);
      }
    }),
    3
  );
  const carpet = tiled(
    canvasTex(256, 256, (c) => {
      c.fillStyle = "#CBC4B8";
      c.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 9000; k++) {
        const v = 180 + Math.floor(rnd() * 40);
        c.fillStyle = `rgba(${v}, ${v - 6}, ${v - 16}, 0.4)`;
        c.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 1, 1);
      }
    }),
    1
  );
  const finishMat = {
    oak: M({ map: oak, roughness: 0.6 }),
    tile: M({ map: tile, roughness: 0.3 }),
    concrete: M({ map: concrete, roughness: 0.95 }),
    carpet: M({ map: carpet, roughness: 1 }),
  };
  /* THE STANDARD FINISHES (finishes.ts): what the plan writes in a room, else wet areas tiled, a garage concrete, the rest timber */
  const finishOf = (s: Space3D) =>
    s.finish === "timber"
      ? finishMat.oak
      : s.finish === "tile"
        ? finishMat.tile
        : s.finish === "carpet"
          ? finishMat.carpet
          : s.finish === "concrete"
            ? finishMat.concrete
            : s.kind === "wet"
              ? finishMat.tile
              : s.kind === "garage"
                ? finishMat.concrete
                : finishMat.oak;
  const plainTop = M({ color: 0xffffff, roughness: 1 });
  const slabSide = M({ color: C.slabSide, roughness: 1 });

  /* ── OUTSIDE: decks and paving on the outdoor spaces, a lawn, trees, the sky ── */
  const decking = tiled(
    canvasTex(512, 512, (c) => {
      const n = 8;
      const h = 512 / n;
      for (let r = 0; r < n; r++) {
        let x = -Math.floor(rnd() * 400);
        while (x < 512) {
          const len = 300 + Math.floor(rnd() * 400);
          const tone = 150 + Math.floor(rnd() * 26);
          c.fillStyle = `rgb(${tone}, ${tone - 42}, ${tone - 78})`;
          c.fillRect(x, r * h, len, h);
          c.fillStyle = "rgba(60, 40, 20, 0.5)";
          c.fillRect(x, r * h, 2, h);
          x += len;
        }
        c.fillStyle = "rgba(50, 32, 16, 0.55)";
        c.fillRect(0, r * h, 512, 4);
      }
    }),
    1.12
  );
  const pavers = tiled(
    canvasTex(256, 256, (c) => {
      c.fillStyle = "#A8A29E";
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const tone = 206 + Math.floor(rnd() * 14);
          c.fillStyle = `rgb(${tone}, ${tone - 4}, ${tone - 10})`;
          c.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
        }
    }),
    1.2
  );
  const deckMat = M({ map: decking, roughness: 0.75 });
  const paverMat = M({ map: pavers, roughness: 0.9 });
  const outFlats: THREE_NS.Mesh[] = [];
  const decks: THREE_NS.Mesh[] = [];
  /** an outdoor space's deck, or its paving, a step below the floor inside */
  const deck = (s: Space3D, f: Floor3D) => {
    const g = new THREE.ExtrudeGeometry(shape(s.pts), { depth: 0.12, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const paved = s.finish ? s.finish === "tile" : /terrace|courtyard|balcony|patio|paving|path/i.test(s.name);
    const top = s.finish === "concrete" ? finishMat.concrete : paved ? paverMat : deckMat;
    const m = new THREE.Mesh(g, [top, slabSide]);
    m.position.y = f.y0 - 0.15;
    m.receiveShadow = true;
    m.castShadow = true;
    decks.push(m);
    return m;
  };
  const lawnR = scene3.span * 0.75 + 8;
  const grass = canvasTex(256, 256, (c) => {
    c.fillStyle = "#A3B892";
    c.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 5000; k++) {
      const g = 160 + Math.floor(rnd() * 40);
      c.fillStyle = `rgba(${g - 40}, ${g}, ${g - 55}, 0.35)`;
      c.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 1, 3);
    }
  });
  grass.wrapS = THREE.RepeatWrapping;
  grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(lawnR, lawnR);
  const fade = canvasTex(256, 256, (c) => {
    const r = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, "#fff");
    r.addColorStop(0.62, "#fff");
    r.addColorStop(1, "#000");
    c.fillStyle = r;
    c.fillRect(0, 0, 256, 256);
  });
  fade.colorSpace = THREE.NoColorSpace;
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(lawnR, 96), M({ map: grass, alphaMap: fade, transparent: true, depthWrite: false, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = groundY - 0.06;
  lawn.receiveShadow = true;
  lawn.renderOrder = -1;
  scene.add(lawn);
  const trees = new THREE.Group();
  {
    const trunk = M({ color: 0x8b6b4a, roughness: 0.9 });
    const leaves = [0x93ad82, 0xa3bb92, 0x86a275].map((c) => M({ color: c, roughness: 0.9, flatShading: true }));
    const homes = scene3.floors.flatMap((f) => f.spaces.map((s) => s.pts)).flat();
    const clear = (x: number, z: number) => homes.every(([px, pz]) => Math.hypot(px - x, pz - z) > 3.2);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
      for (let r = scene3.span * 0.6 + 4; r < lawnR * 0.75; r += 1.5) {
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (!clear(x, z)) continue;
        const t = new THREE.Group();
        const k = 0.6 + rnd() * 0.35;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * k, 0.14 * k, 2.2 * k, 8), trunk);
        stem.position.y = 1.1 * k;
        stem.castShadow = true;
        t.add(stem);
        for (let j = 0; j < 3; j++) {
          const crown = new THREE.Mesh(new THREE.IcosahedronGeometry((1.1 + rnd() * 0.6) * k, 1), leaves[(i + j) % leaves.length]);
          crown.position.set((rnd() - 0.5) * 1.2 * k, (2.6 + rnd() * 0.9) * k, (rnd() - 0.5) * 1.2 * k);
          crown.castShadow = true;
          crown.receiveShadow = true;
          t.add(crown);
        }
        t.position.set(x - cx, groundY - 0.06, z - cz);
        trees.add(t);
        break;
      }
    }
  }
  scene.add(trees);
  /* the sky: a dome, pale blue overhead to white at the horizon; its colours
     are set so they come out as these once the picture's light is mapped */
  const sky = (() => {
    const geo = new THREE.SphereGeometry(Math.min(900, d * 6), 32, 16);
    const pos = geo.attributes.position as THREE_NS.BufferAttribute;
    const stops: [number, [number, number, number]][] = [
      [-1, [2.8034, 3.162, 2.5256]],
      [0, [1.9092, 2.5885, 3.6335]],
      [0.18, [0.6564, 1.1576, 2.2533]],
      [0.6, [0.33, 0.6903, 1.5515]],
      [1, [0.33, 0.6903, 1.5515]],
    ];
    const col = new Float32Array(pos.count * 3);
    const v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const y = v3.fromBufferAttribute(pos, i).normalize().y;
      let k = 1;
      while (k < stops.length - 1 && y > stops[k][0]) k++;
      const [y0, a] = stops[k - 1];
      const [y1, b] = stops[k];
      const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0 || 1)));
      col.set([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    m.renderOrder = -2;
    scene.add(m);
    return m;
  })();

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
    m.receiveShadow = true;
    return m;
  };
  /** a room's piece of floor plate: its finish on top, a grey edge */
  const slabs: { mesh: THREE_NS.Mesh; finish: THREE_NS.Material }[] = [];
  const slab = (s: Space3D, f: Floor3D) => {
    const g = new THREE.ExtrudeGeometry(shape(s.pts), { depth: SLAB_M, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const finish = finishOf(s);
    const m = new THREE.Mesh(g, [finish, slabSide]);
    m.position.y = f.y0 - SLAB_M;
    m.receiveShadow = true;
    slabs.push({ mesh: m, finish });
    return m;
  };
  const segBox = (a: XZ, b: XZ, y0: number, h: number, t: number, mat: THREE_NS.Material, edges: boolean): THREE_NS.Object3D[] => {
    const [x1, z1] = P(a);
    const [x2, z2] = P(b);
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.02 || h <= 0.01) return [];
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), mat);
    m.position.set((x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    m.castShadow = mat === wallMat;
    m.receiveShadow = true;
    if (!edges) return [m];
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat);
    e.position.copy(m.position);
    e.rotation.copy(m.rotation);
    return [m, e];
  };

  /* ── WINDOWS AND DOORS, cut into the wall they are in ── */
  const frameMat = M({ color: C.frame, roughness: 0.4, metalness: 0.5 });
  const glassMat = own(new THREE.MeshPhysicalMaterial({ color: C.glass, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.4, depthWrite: false }));
  const leafMat = M({ color: C.leaf, roughness: 0.55 });
  const box = (w: number, h: number, t: number, mat: THREE_NS.Material, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
    m.position.set(x, y, z);
    m.castShadow = mat !== glassMat;
    return m;
  };
  /** an opening's frame and what fills it, in the wall's own frame: along it x, up y */
  const fill = (o: Opening3D, w: number): THREE_NS.Group => {
    const g = new THREE.Group();
    const h = o.head - o.sill;
    const bar = 0.05;
    const deep = 0.09;
    g.add(box(w, bar, deep, frameMat, 0, h - bar / 2));
    g.add(box(bar, h, deep, frameMat, -w / 2 + bar / 2, h / 2));
    g.add(box(bar, h, deep, frameMat, w / 2 - bar / 2, h / 2));
    if (o.kind === "window") {
      g.add(box(w, bar, deep, frameMat, 0, bar / 2));
      g.add(box(w + 0.08, 0.03, 0.2, frameMat, 0, -0.015, 0.03));
      const panes = w > 1.4 ? 2 : 1;
      for (let i = 1; i < panes; i++) g.add(box(bar * 0.8, h, deep, frameMat, -w / 2 + (w * i) / panes, h / 2));
      g.add(box(w - bar * 2, h - bar * 2, 0.012, glassMat, 0, h / 2));
    } else if (o.external && w >= 1.5) {
      /* a wide outside door is glass, sliding */
      g.add(box(w, bar, deep, frameMat, 0, bar / 2));
      g.add(box(bar * 0.8, h, deep, frameMat, 0, h / 2));
      g.add(box(w - bar * 2, h - bar * 2, 0.012, glassMat, 0, h / 2));
    } else {
      g.add(box(w - bar * 2, h - bar - 0.01, 0.04, leafMat, 0, (h - bar) / 2));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), frameMat);
      knob.position.set(w / 2 - 0.16, 1.0, 0.04);
      g.add(knob);
    }
    return g;
  };
  /** a wall from a to b with the floor's openings on it cut in */
  const wall = (a: XZ, b: XZ, f: Floor3D, mat: THREE_NS.Material, edges: boolean): THREE_NS.Object3D[] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return [];
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const at = (t: number): XZ => [a[0] + ux * t, a[1] + uz * t];
    const along = (p: XZ) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uz;
    const off = (p: XZ) => Math.abs((p[0] - a[0]) * uz - (p[1] - a[1]) * ux);
    const span = (p: XZ, q: XZ) => ({ t0: Math.max(0, Math.min(along(p), along(q))), t1: Math.min(len, Math.max(along(p), along(q))) });
    const cuts: { o?: Opening3D; t0: number; t1: number }[] = [
      ...f.openings.filter((o) => off(o.a) < 0.25 && off(o.b) < 0.25).map((o) => ({ o, ...span(o.a, o.b) })),
      /* a stair's open end: no wall at all */
      ...(f.open ?? []).filter(([p, q]) => off(p) < 0.25 && off(q) < 0.25).map(([p, q]) => span(p, q)),
    ]
      .filter((c) => c.t1 - c.t0 > 0.3)
      .sort((p, q) => p.t0 - q.t0);
    const out: THREE_NS.Object3D[] = [];
    let t = 0;
    for (const c of cuts) {
      if (!c.o) {
        if (c.t1 <= t) continue;
        if (c.t0 > t) out.push(...segBox(at(t), at(c.t0), f.y0, f.ceiling, 0.1, mat, edges));
        t = c.t1;
        continue;
      }
      if (c.t0 < t) continue;
      if (c.t0 > t) out.push(...segBox(at(t), at(c.t0), f.y0, f.ceiling, 0.1, mat, edges));
      const head = Math.min(c.o.head, f.ceiling);
      out.push(...segBox(at(c.t0), at(c.t1), f.y0, c.o.sill, 0.1, mat, edges));
      out.push(...segBox(at(c.t0), at(c.t1), f.y0 + head, f.ceiling - head, 0.1, mat, edges));
      const g = fill({ ...c.o, head }, c.t1 - c.t0);
      const [mx, mz] = P(at((c.t0 + c.t1) / 2));
      g.position.set(mx, f.y0 + c.o.sill, mz);
      g.rotation.y = -Math.atan2(uz, ux);
      out.push(g);
      t = c.t1;
    }
    if (t < len) out.push(...segBox(at(t), b, f.y0, f.ceiling, 0.1, mat, edges));
    return out;
  };

  /* a raised deck's open sides get a glass balustrade; the sides against the house don't */
  const balustrade = (s: Space3D, f: Floor3D): THREE_NS.Object3D[] => {
    const walls = f.spaces.filter((x) => WALLED.has(x.kind)).flatMap((x) => x.pts.map((p, i) => [p, x.pts[(i + 1) % x.pts.length]] as [XZ, XZ]));
    const toSeg = (p: XZ, [a, b]: [XZ, XZ]) => {
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
      return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
    };
    const out: THREE_NS.Object3D[] = [];
    for (let k = 0; k < s.pts.length; k++) {
      const a = s.pts[k];
      const b = s.pts[(k + 1) % s.pts.length];
      const mid: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (walls.some((w) => toSeg(mid, w) < 0.3)) continue;
      out.push(...segBox(a, b, f.y0 - 0.03, 0.95, 0.012, glassMat, false));
      out.push(...segBox(a, b, f.y0 + 0.92, 0.05, 0.06, frameMat, false));
    }
    return out;
  };
  const standOn = new Map<THREE_NS.Object3D, string>();

  /* ── UNITS AS WHAT THEY ARE: real units are white; what hides in a cavity is galvanised ── */
  const unitWhite = M({ color: 0xf8fafc, roughness: 0.4 });
  const unitMetal = M({ color: 0xd1d5db, roughness: 0.45, metalness: 0.45 });
  const slotMat = M({ color: 0x374151, roughness: 0.7 });
  const unitEdge = own(new THREE.LineBasicMaterial({ color: 0x9ca3af }));
  const fanFace = own(
    new THREE.MeshBasicMaterial({
      map: canvasTex(128, 128, (c) => {
        c.fillStyle = "#4B5563";
        c.beginPath();
        c.arc(64, 64, 63, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#D1D5DB";
        c.lineWidth = 3;
        for (let r = 14; r < 64; r += 12) {
          c.beginPath();
          c.arc(64, 64, r, 0, Math.PI * 2);
          c.stroke();
        }
        for (let k = 0; k < 8; k++) {
          c.beginPath();
          c.moveTo(64, 64);
          c.lineTo(64 + 62 * Math.cos((k * Math.PI) / 4), 64 + 62 * Math.sin((k * Math.PI) / 4));
          c.stroke();
        }
      }),
    })
  );
  const cassetteFace = M({
    map: canvasTex(256, 256, (c) => {
      c.fillStyle = "#F8FAFC";
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = "#374151";
      c.fillRect(28, 20, 200, 16);
      c.fillRect(28, 220, 200, 16);
      c.fillRect(20, 28, 16, 200);
      c.fillRect(220, 28, 16, 200);
      c.strokeStyle = "#9CA3AF";
      c.lineWidth = 3;
      c.strokeRect(78, 78, 100, 100);
      c.strokeRect(92, 92, 72, 72);
    }),
    roughness: 0.5,
  });
  const edged = (mesh: THREE_NS.Mesh, mat: THREE_NS.LineBasicMaterial = unitEdge) => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), mat);
    e.position.copy(mesh.position);
    e.rotation.copy(mesh.rotation);
    return e;
  };
  /** a unit as what it is, off the pack's form factor, in its own frame: front to +z */
  const unitShape = (u: Unit3D): THREE_NS.Group => {
    const g = new THREE.Group();
    const add = (geo: THREE_NS.BufferGeometry, mat: THREE_NS.Material | THREE_NS.Material[], x: number, y: number, z: number, edges = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      if (edges) g.add(edged(m));
      return m;
    };
    const { w, h, d: dd, form } = u;
    if (form === "outdoor") {
      add(new THREE.BoxGeometry(w, h, dd), unitWhite, 0, h / 2 + 0.06, 0);
      const fans = h >= 1.2 ? 2 : 1;
      const r = Math.min(w * 0.3, (h / fans) * 0.4);
      for (let i = 0; i < fans; i++) {
        const fan = new THREE.Mesh(new THREE.CircleGeometry(r, 40), fanFace);
        fan.position.set(-w * 0.14, 0.06 + (fans === 1 ? h * 0.52 : h * (0.28 + 0.46 * i)), dd / 2 + 0.003);
        g.add(fan);
      }
      add(new THREE.BoxGeometry(0.08, 0.06, dd * 1.1), slotMat, -w / 2 + 0.1, 0.03, 0, false);
      add(new THREE.BoxGeometry(0.08, 0.06, dd * 1.1), slotMat, w / 2 - 0.1, 0.03, 0, false);
    } else if (form === "wall") {
      const prof = new THREE.Shape();
      prof.moveTo(0, 0);
      prof.lineTo(0, h);
      prof.lineTo(dd * 0.55, h);
      prof.quadraticCurveTo(dd, h, dd, h * 0.45);
      prof.quadraticCurveTo(dd, h * 0.08, dd * 0.7, 0);
      prof.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(prof, { depth: w, bevelEnabled: false, curveSegments: 10 });
      geo.translate(-dd / 2, 0, -w / 2);
      geo.rotateY(-Math.PI / 2);
      add(geo, unitWhite, 0, 0, 0);
      add(new THREE.BoxGeometry(w * 0.84, 0.03, 0.02), slotMat, 0, 0.045, dd * 0.36, false);
    } else if (form.startsWith("cassette")) {
      add(new THREE.BoxGeometry(w, h, dd), unitMetal, 0, h / 2, 0);
      const pw = w + 0.11;
      add(new THREE.BoxGeometry(pw, 0.035, pw), [unitWhite, unitWhite, unitWhite, cassetteFace, unitWhite, unitWhite], 0, -0.0175, 0);
    } else if (form === "under-ceiling" || form === "floor-console") {
      add(new THREE.BoxGeometry(w, h, dd), unitWhite, 0, h / 2, 0);
      add(new THREE.BoxGeometry(w * 0.84, 0.03, 0.02), slotMat, 0, form === "floor-console" ? h - 0.04 : 0.04, dd / 2, false);
    } else {
      /* ducted and bulkhead heads: a galvanised box in the cavity */
      add(new THREE.BoxGeometry(w, h, dd), unitMetal, 0, h / 2, 0);
    }
    return g;
  };

  /* ── DUCTS AS THEY ARE: their size's colour (duct-size.ts), flex ribbed,
     rigid smooth, straight legs turning on a bend as wide as the duct ── */
  const ribTex = new Map<string, THREE_NS.CanvasTexture>();
  const rigidMat = new Map<string, THREE_NS.Material>();
  const ductMaterial = (body: string, rib: string, flex: boolean, len: number) => {
    if (!flex) {
      if (!rigidMat.has(body)) rigidMat.set(body, M({ color: body, roughness: 0.35, metalness: 0.5 }));
      return rigidMat.get(body)!;
    }
    const tex =
      ribTex.get(`${body}:${rib}`) ??
      canvasTex(64, 8, (c) => {
        c.fillStyle = body;
        c.fillRect(0, 0, 64, 8);
        c.fillStyle = rib;
        c.fillRect(0, 0, 10, 8);
      });
    ribTex.set(`${body}:${rib}`, tex);
    const t = own(tex.clone());
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, len / 0.07), 1);
    t.needsUpdate = true;
    return M({ map: t, roughness: 0.7 });
  };
  const bentPath = (raw: THREE_NS.Vector3[], bend: number) => {
    const pts = raw.filter((p, i) => i === 0 || p.distanceTo(raw[i - 1]) > 1e-3);
    if (pts.length < 2) return null;
    const path = new THREE.CurvePath<THREE_NS.Vector3>();
    let prev = pts[0].clone();
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const ab = b.clone().sub(a);
      const bc = c.clone().sub(b);
      const r = Math.min(bend, ab.length() / 2, bc.length() / 2);
      const p1 = b.clone().sub(ab.normalize().multiplyScalar(r));
      const p2 = b.clone().add(bc.normalize().multiplyScalar(r));
      if (prev.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(prev, p1));
      path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
      prev = p2;
    }
    path.add(new THREE.LineCurve3(prev, pts[pts.length - 1].clone()));
    return path;
  };

  /* ── GRILLES ON THEIR FACE: white, the blades in ink ── */
  const grilleMat = {
    linear: own(
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: canvasTex(256, 64, (c) => {
          c.fillStyle = "#FFFFFF";
          c.fillRect(0, 0, 256, 64);
          c.fillStyle = "#374151";
          for (let y = 14; y < 56; y += 12) c.fillRect(10, y, 236, 5);
          c.strokeStyle = "#6B7280";
          c.lineWidth = 4;
          c.strokeRect(2, 2, 252, 60);
        }),
      })
    ),
    square: own(
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: canvasTex(128, 128, (c) => {
          c.fillStyle = "#FFFFFF";
          c.fillRect(0, 0, 128, 128);
          c.strokeStyle = "#374151";
          c.lineWidth = 5;
          for (let i = 0; i < 4; i++) c.strokeRect(14 + i * 13, 14 + i * 13, 100 - i * 26, 100 - i * 26);
          c.strokeStyle = "#6B7280";
          c.lineWidth = 4;
          c.strokeRect(2, 2, 124, 124);
        }),
      })
    ),
    round: own(
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        map: canvasTex(128, 128, (c) => {
          c.fillStyle = "#FFFFFF";
          c.beginPath();
          c.arc(64, 64, 62, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = "#374151";
          c.lineWidth = 5;
          for (let r = 16; r < 60; r += 13) {
            c.beginPath();
            c.arc(64, 64, r, 0, Math.PI * 2);
            c.stroke();
          }
        }),
      })
    ),
  };
  const grilleEdge = own(new THREE.LineBasicMaterial({ color: 0x374151 }));
  const grilleMesh = (gr: Grille3D) => {
    const geo = gr.style === "round" ? new THREE.CircleGeometry(gr.w / 2, 40) : new THREE.PlaneGeometry(gr.w, gr.h);
    const m = new THREE.Mesh(geo, grilleMat[gr.style]);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), grilleEdge));
    const [x, z] = P(gr.at);
    const turn = (-gr.rot * Math.PI) / 180;
    if (gr.mount === "ceiling" || gr.mount === "floor") {
      m.rotation.set(gr.mount === "ceiling" ? Math.PI / 2 : -Math.PI / 2, 0, 0);
      const holder = new THREE.Group();
      holder.position.set(x, gr.y, z);
      holder.rotation.y = turn;
      holder.add(m);
      return holder;
    }
    m.position.set(x, gr.y, z);
    m.rotation.set(0, turn, 0);
    return m;
  };

  /* ── NAMES ── */
  const labels: Label[] = [];
  const label = (text: string, at: THREE_NS.Vector3, group: THREE_NS.Group, floorIndex: number, kind: Label["kind"], dot?: string, base: THREE_NS.Vector3 | null = null, unit?: Unit3D) => {
    if (!text.trim()) return;
    const el = document.createElement("div");
    el.className = `ds3-lab ${kind}`;
    if (dot) {
      /* a dot in its system's colour beside its name (rule 18a) */
      const i = document.createElement("i");
      i.style.background = dot;
      el.appendChild(i);
    }
    el.appendChild(document.createTextNode(text));
    host.appendChild(el);
    labels.push({ el, at, base, group, floorIndex, kind, unitAt: unit?.at, outdoor: unit?.outdoor });
  };

  const groups = new Map<string, THREE_NS.Group>();
  /* add() with nothing to add complains: a wall wholly open, or too short to draw, is nothing */
  const addAll = (g: THREE_NS.Object3D, objs: THREE_NS.Object3D[]) => {
    if (objs.length) g.add(...objs);
  };
  /* each floor's roof, framing and ceilings ride with it, so Lift apart carries them */
  const roofG = new Map<string, THREE_NS.Group>();
  const frameG = new Map<string, THREE_NS.Group>();
  const ceilG = new Map<string, THREE_NS.Group>();
  const tileG = new Map<string, THREE_NS.Group>();
  scene3.floors.forEach((f, i) => {
    const g = new THREE.Group();
    groups.set(f.id, g);
    scene.add(g);
    for (const m of [roofG, frameG, ceilG, tileG]) {
      const sub = new THREE.Group();
      m.set(f.id, sub);
      g.add(sub);
    }
    for (const s of f.spaces) {
      if (s.kind === "void") continue;
      if (s.kind === "outdoor") {
        const fl = flat(s.pts, outMat, f.y0 - 0.02);
        outFlats.push(fl);
        g.add(fl, deck(s, f));
        if (f.y0 > 0.5) addAll(g, balustrade(s, f));
      } else if (s.existing) {
        g.add(flat(s.pts, oldMat, f.y0 + 0.005));
        for (let k = 0; k < s.pts.length; k++) addAll(g, segBox(s.pts[k], s.pts[(k + 1) % s.pts.length], f.y0, f.ceiling, 0.1, oldMat, false));
      } else if (WALLED.has(s.kind)) {
        /* a stair's well over its flight is open */
        if (!s.well) {
          const sl = slab(s, f);
          standOn.set(sl, f.id);
          g.add(sl);
        }
        const glass = !f.read;
        for (let k = 0; k < s.pts.length; k++) addAll(g, wall(s.pts[k], s.pts[(k + 1) % s.pts.length], f, glass ? zoneMat : wallMat, true));
      }
      if (s.kind !== "stair" && s.kind !== "cupboard") {
        const [lx, lz] = P(middleOf(s.pts));
        label(sentence(s.name), new THREE.Vector3(lx, f.y0 + 0.4, lz), g, i, "room");
      }
    }
    /* THE PLAN ON THE FLOOR: the floor's own drawing, laid where the design sits */
    for (const t of f.tiles) {
      if (!planUrl) break;
      void planUrl(t.ref)
        .then((url) => new THREE.TextureLoader().loadAsync(url))
        .then((tex) => {
          if (gone) {
            tex.dispose();
            return;
          }
          own(tex);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          const geo = new THREE.PlaneGeometry(t.x1 - t.x0, t.z1 - t.z0);
          /* the image's top is v 1 in three: the sheet's own top-left is (u0, v0) */
          const uv = geo.attributes.uv as THREE_NS.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, t.u0 + (t.u1 - t.u0) * uv.getX(k), 1 - (t.v0 + (t.v1 - t.v0) * (1 - uv.getY(k))));
          /* a little see-through, so what runs under the floor still shows */
          const mat = own(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, opacity: 0.8, depthWrite: false }));
          const m = new THREE.Mesh(geo, mat);
          m.rotation.x = -Math.PI / 2;
          const [x, z] = P([(t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2]);
          m.position.set(x, f.y0 + 0.003, z);
          tileG.get(f.id)!.add(m);
        })
        .catch(() => {});
    }
  });
  const hasTiles = scene3.floors.some((f) => f.tiles.length > 0) && !!planUrl;
  for (const u of scene3.units) {
    const g = groups.get(u.floorId);
    if (!g) continue;
    const i = scene3.floors.findIndex((f) => f.id === u.floorId);
    const m = unitShape(u);
    const [x, z] = P(u.at);
    m.position.set(x, u.y, z);
    m.rotation.y = (-u.rot * Math.PI) / 180;
    g.add(m);
    const topY = u.y + u.h + (u.outdoor ? 0.06 : 0);
    label(u.label, new THREE.Vector3(x, topY + STEM_M, z), g, i, "unit", u.colour, new THREE.Vector3(x, topY, z), u);
  }
  for (const dct of scene3.ducts) {
    const g = groups.get(dct.floorId);
    if (!g) continue;
    const path = bentPath(dct.pts.map(([x, y, z]) => new THREE.Vector3(x - cx, y, z - cz)), Math.max(0.25, dct.r * 2));
    if (!path) continue;
    const len = path.getLength();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, Math.ceil(len / 0.04)), dct.r, 16, false), ductMaterial(dct.body, dct.rib, dct.flex, len));
    tube.castShadow = true;
    g.add(tube);
  }
  for (const gr of scene3.grilles) groups.get(gr.floorId)?.add(grilleMesh(gr));
  const riserRing = M({ color: 0xbe123c, roughness: 0.5 });
  for (const r of scene3.risers) {
    const g = groups.get(r.floorId);
    if (!g) continue;
    const [x, z] = P(r.at);
    const lo = Math.min(r.y0, r.y1);
    const hi = Math.max(r.y0, r.y1);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(r.r, r.r, hi - lo, 20), r.duct ? ductMaterial(r.body, r.body, true, hi - lo) : pipeMat);
    tube.position.set(x, (lo + hi) / 2, z);
    tube.castShadow = true;
    g.add(tube);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r.r + 0.04, 0.025, 10, 32), riserRing);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, r.slab + 0.02, z);
    g.add(ring);
    label(r.duct ? "DR" : "PR", new THREE.Vector3(x, r.slab + 0.3, z), g, scene3.floors.findIndex((f) => f.id === r.floorId), "riser");
  }
  for (const r of scene3.pipes) {
    const g = groups.get(r.floorId);
    if (!g) continue;
    const path = bentPath(r.pts.map(([x, y, z]) => new THREE.Vector3(x - cx, y, z - cz)), 0.15);
    if (!path) continue;
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, Math.ceil(path.getLength() / 0.05)), 0.03, 10, false), pipeMat);
    pipe.castShadow = true;
    g.add(pipe);
  }

  /* A ROOF IN ITS FINISH: tiles in courses, metal in ribs down the fall, a flat roof's membrane; one kept stays see-through */
  const roofTiles = canvasTex(256, 256, (c) => {
    const rows = 4;
    const cols = 4;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const tone = 150 + Math.floor(rnd() * 26);
        c.fillStyle = `rgb(${tone + 22}, ${Math.round(tone * 0.55)}, ${Math.round(tone * 0.36)})`;
        c.fillRect(k * 64, r * 64, 64, 64);
        c.fillStyle = "rgba(255, 255, 255, 0.10)";
        c.fillRect(k * 64 + 6, r * 64 + 4, 22, 54);
        c.fillStyle = "rgba(40, 14, 6, 0.35)";
        c.fillRect(k * 64, r * 64, 2, 64);
      }
    for (let r = 0; r < rows; r++) {
      c.fillStyle = "rgba(40, 14, 6, 0.55)";
      c.fillRect(0, r * 64 + 56, 256, 8);
    }
  });
  const roofRibs = canvasTex(256, 16, (c) => {
    c.fillStyle = "#4B5563";
    c.fillRect(0, 0, 256, 16);
    for (let x = 0; x < 256; x += 26) {
      c.fillStyle = "rgba(255, 255, 255, 0.14)";
      c.fillRect(x, 0, 6, 16);
      c.fillStyle = "rgba(0, 0, 0, 0.18)";
      c.fillRect(x + 13, 0, 5, 16);
    }
  });
  for (const t of [roofTiles, roofRibs]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  roofTiles.repeat.set(1 / 1.2, 1 / 1.3);
  roofRibs.repeat.set(1 / 0.76, 1);
  const roofFinish = {
    tiled: M({ map: roofTiles, side: THREE.DoubleSide, roughness: 0.75 }),
    metal: M({ map: roofRibs, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.35 }),
    flat: M({ color: 0x9ca3af, side: THREE.DoubleSide, roughness: 0.9 }),
  };
  const keptRoof = new Map<THREE_NS.Material, THREE_NS.Material>();
  const kept = (m: THREE_NS.MeshStandardMaterial) => {
    if (!keptRoof.has(m)) keptRoof.set(m, own(Object.assign(m.clone(), { transparent: true, opacity: 0.5, depthWrite: false })));
    return keptRoof.get(m)!;
  };
  /** a roof's sheets with their texture laid in metres: across the fall, and down it */
  const roofGeo = (m: { verts: [number, number, number][]; tris: number[] }) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const n = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < m.tris.length; i += 3) {
      const [p, q, r] = [m.verts[m.tris[i]], m.verts[m.tris[i + 1]], m.verts[m.tris[i + 2]]];
      a.set(p[0] - cx, p[1], p[2] - cz);
      b.set(q[0] - cx, q[1], q[2] - cz);
      c.set(r[0] - cx, r[1], r[2] - cz);
      n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const fall = new THREE.Vector2(n.x, n.z);
      const steep = Math.max(0.2, Math.abs(n.y));
      if (fall.lengthSq() < 1e-6) fall.set(0, 1);
      fall.normalize();
      for (const v of [a, b, c]) {
        pos.push(v.x, v.y, v.z);
        uv.push(v.x * -fall.y + v.z * fall.x, (v.x * fall.x + v.z * fall.y) / steep);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  const roofFaces: { mesh: THREE_NS.Mesh; mat: THREE_NS.Material }[] = [];
  const insideRoof = M({ color: C.ceiling, side: THREE.DoubleSide, roughness: 0.9 });
  for (const r of scene3.roofs) {
    const g = roofG.get(r.floorId);
    if (!g) continue;
    const base = r.finish ? roofFinish[r.finish] : roofMat;
    const mat = r.existing ? (r.finish ? kept(base) : oldRoofMat) : base;
    const faces = new THREE.Mesh(roofGeo(r.faces), mat);
    roofFaces.push({ mesh: faces, mat });
    faces.castShadow = true;
    faces.receiveShadow = true;
    g.add(faces, new THREE.LineSegments(new THREE.EdgesGeometry(faces.geometry, 20), roofEdge));
    if (r.fills.verts.length) g.add(meshOf(r.fills, r.existing ? oldMat : fillMat));
  }
  const X1 = new THREE.Vector3(1, 0, 0);
  for (const m of scene3.framing) {
    const g = frameG.get(m.floorId);
    if (!g) continue;
    const a = new THREE.Vector3(m.a[0] - cx, m.a[1], m.a[2] - cz);
    const b = new THREE.Vector3(m.b[0] - cx, m.b[1], m.b[2] - cz);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.02) continue;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(len, m.h, m.w), timber[m.k]);
    beam.position.copy(a).add(b).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(X1, dir.normalize());
    beam.castShadow = true;
    g.add(beam);
  }
  for (const c of scene3.ceilings) {
    const g = ceilG.get(c.floorId);
    if (!g) continue;
    /* a ceiling shades the room under it, so standing in a room the sun comes in by its windows */
    for (const f of c.flat) {
      const m = flat(f.pts, ceilMat, f.y - 0.01);
      m.castShadow = true;
      g.add(m);
    }
    for (const r of c.raked) {
      const m = meshOf(r, ceilMat);
      m.castShadow = true;
      g.add(m);
    }
    /* the walls of a room that rakes up go on up to meet it; they're walls, so they stay when the ceilings lift off */
    for (const r of c.tops) {
      const m = meshOf(r, fillMat);
      m.castShadow = true;
      groups.get(c.floorId)?.add(m);
    }
  }

  /* ── WHAT STANDS IN THE ROOMS: off the drawing, else by the room's name ── */
  const pieceOf = pieceMaker(THREE, M);
  const furnG = new Map<string, THREE_NS.Group>();
  for (const f of scene3.floors) {
    const g = new THREE.Group();
    furnG.set(f.id, g);
    groups.get(f.id)!.add(g);
    for (const p of f.pieces) {
      const m = pieceOf(p);
      const [x, z] = P(p.at);
      m.position.set(x, f.y0 - (p.kind.startsWith("outdoor") ? 0.03 : 0), z);
      m.rotation.y = Math.atan2(p.facing[0], p.facing[1]);
      g.add(m);
    }
  }

  /* ── THE STAIRS AS STEPS: timber treads on white stringers ── */
  const treadMat = M({ color: 0xc9a27e, roughness: 0.6 });
  const stringerMat = M({ color: 0xf3f4f6, roughness: 0.6 });
  /* a stair in what the plan says it is: timber treads, concrete steps, carpet or tile on them */
  const treadOf = (f?: string) => (f === "concrete" ? finishMat.concrete : f === "carpet" ? finishMat.carpet : f === "tile" ? finishMat.tile : treadMat);
  for (const f of scene3.floors)
    for (const st of f.stairs) {
      const g = groups.get(f.id)!;
      const [ax, az] = P(st.from);
      const [bx, bz] = P(st.to);
      const run = Math.hypot(bx - ax, bz - az);
      if (run < 0.5) continue;
      const ux = (bx - ax) / run;
      const uz = (bz - az) / run;
      const treads = st.risers - 1;
      const going = run / treads;
      const turn = Math.atan2(ux, uz);
      /* each tread as wide as the stair's shape is where it sits; the stringers where every tread reaches */
      const spans = st.spans?.length === treads ? st.spans : Array.from({ length: treads }, (): [number, number] => [-st.w / 2, st.w / 2]);
      const lo = Math.max(...spans.map((sp) => sp[0]));
      const hi = Math.min(...spans.map((sp) => sp[1]));
      for (let i = 0; i < treads; i++) {
        const top = st.y0 + (st.rise * (i + 1)) / st.risers;
        const t = (i + 0.5) * going;
        const [a0, a1] = spans[i];
        const mid = (a0 + a1) / 2;
        /* concrete is a solid step to the floor; the others are treads on stringers */
        const solid = st.finish === "concrete";
        const deep = solid ? top - st.y0 : 0.05;
        const tread = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, a1 - a0 - (solid ? 0.04 : 0.14)), deep, going + (solid ? 0.002 : 0.03)), treadOf(st.finish));
        tread.position.set(ax + ux * t + uz * mid, top - deep / 2, az + uz * t - ux * mid);
        tread.rotation.y = turn;
        tread.castShadow = true;
        tread.receiveShadow = true;
        g.add(tread);
      }
      const climb = (st.rise * treads) / st.risers;
      const len = Math.hypot(run, climb);
      for (const off of st.finish === "concrete" || hi - lo < 0.3 ? [] : [lo + 0.05, hi - 0.05]) {
        const str = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, len), stringerMat);
        str.position.set(ax + (ux * run) / 2 + uz * off, st.y0 + climb / 2 - 0.05, az + (uz * run) / 2 - ux * off);
        str.rotation.order = "YXZ";
        str.rotation.y = turn;
        str.rotation.x = -Math.atan2(climb, run);
        str.castShadow = true;
        g.add(str);
      }
    }

  /* ── THE AIR LEAVING EACH HEAD AND GRILLE ── */
  const air = airMaker(THREE, scene3, P, own);
  for (const s of air.streams) groups.get(s.floorId)?.add(s.points);

  let current = look;
  /* standing in a room: where the view stood before, to step back out to */
  let walk: { pos: THREE_NS.Vector3; target: THREE_NS.Vector3; fov: number } | null = null;
  /* the room stood in, whose heads keep their names */
  let standRoom: Space3D | null = null;
  const apply = (l: Look3D) => {
    current = l;
    const plans = hasTiles && l.plans !== false;
    const out = !!l.outside;
    grid.visible = !plans && !out;
    catcher.visible = !out;
    lawn.visible = out;
    trees.visible = out;
    sky.visible = out;
    for (const s of slabs) (s.mesh.material as THREE_NS.Material[])[0] = plans ? plainTop : s.finish;
    for (const m of outFlats) m.visible = plans;
    for (const m of decks) m.visible = !plans;
    for (const s of air.streams) s.points.visible = !!l.air;
    /* standing in a room it has its ceiling, whole */
    bounce.intensity = walk ? 0.9 : 0;
    /* from inside, the roof's underside is the ceiling where it rakes up to it */
    for (const r of roofFaces) r.mesh.material = walk ? insideRoof : r.mat;
    ceilMat.opacity = walk ? 1 : 0.85;
    ceilMat.transparent = !walk;
    ceilMat.needsUpdate = true;
    scene3.floors.forEach((f, i) => {
      const g = groups.get(f.id)!;
      g.visible = l.floor === ALL_FLOORS || l.floor === f.id;
      g.position.y = l.apart && l.floor === ALL_FLOORS ? i * LIFT_M : 0;
      /* standing in a room the roof stays over it, so a raked ceiling meets its gables */
      roofG.get(f.id)!.visible = l.layer === "roof" || !!walk;
      frameG.get(f.id)!.visible = l.layer !== "inside" && !walk;
      /* the air runs under the ceilings, so showing it lifts them off; standing in a room keeps its own */
      ceilG.get(f.id)!.visible = walk ? true : l.layer !== "inside" && !l.air;
      tileG.get(f.id)!.visible = plans;
      furnG.get(f.id)!.visible = !plans;
    });
  };
  apply(look);

  /* a picture taller than it is wide (a phone held upright) sees less
     across, so until the house is first turned the view stands back by as
     much to take it in, whatever size the picture settles at */
  const home = camera.position.clone();
  let turned = false;
  controls.addEventListener("start", () => {
    turned = true;
  });
  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer?.setPixelRatio(renderer.getPixelRatio());
    composer?.setSize(w, h);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    camera.aspect = w / h;
    if (!turned) camera.position.copy(home).sub(controls.target).divideScalar(Math.min(1, camera.aspect)).add(controls.target);
    camera.updateProjectionMatrix();
  };
  const watch = new ResizeObserver(resize);
  watch.observe(host);
  resize();

  /* ── STAND IN A ROOM: double-click a floor to stand there at eye height,
     facing the room's head; drag looks round, the wheel steps, Back out or
     Escape returns ── */
  const ray = new THREE.Raycaster();
  const shown = (o: THREE_NS.Object3D | null) => {
    for (let x = o; x; x = x.parent) if (!x.visible) return false;
    return true;
  };
  for (const m of decks) standOn.set(m, "");
  const standAt = (p: THREE_NS.Vector3, floorId: string) => {
    if (!walk) walk = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
    const eye = p.clone();
    eye.y += 1.6;
    const lift = groups.get(floorId)?.position.y ?? 0;
    let ahead = controls.target.clone().sub(camera.position);
    ahead.y = 0;
    /* the head in the room you stand in, else the nearest on the floor */
    const fl = scene3.floors.find((f) => f.id === floorId);
    const here = fl?.spaces.find((s) => s.kind !== "void" && within([p.x + cx, p.z + cz], s.pts));
    standRoom = here ?? null;
    const heads = scene3.units.filter((u) => u.floorId === floorId && !u.outdoor);
    const inRoom = here ? heads.filter((u) => within(u.at, here.pts)) : [];
    const pick = (inRoom.length ? inRoom : heads).map((u) => ({ u, d: Math.hypot(u.at[0] - cx - p.x, u.at[1] - cz - p.z) })).sort((a, b) => a.d - b.d)[0];
    if (pick && pick.d < 9) ahead = new THREE.Vector3(pick.u.at[0] - cx - eye.x, pick.u.y + lift + pick.u.h / 2 - eye.y, pick.u.at[1] - cz - eye.z);
    if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);
    camera.position.copy(eye);
    controls.target.copy(eye).add(ahead.normalize().multiplyScalar(0.05));
    camera.fov = 66;
    camera.updateProjectionMatrix();
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = -0.35;
    onStand(true);
    apply(current);
  };
  const backOut = () => {
    if (!walk) return;
    camera.position.copy(walk.pos);
    controls.target.copy(walk.target);
    camera.fov = walk.fov;
    camera.updateProjectionMatrix();
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.rotateSpeed = 1;
    walk = null;
    standRoom = null;
    onStand(false);
    apply(current);
  };
  const onDouble = (ev: MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...standOn.keys()], false).find((h) => shown(h.object));
    if (!hit) return;
    const floorId = standOn.get(hit.object) || scene3.floors.find((f) => groups.get(f.id)!.children.includes(hit.object))?.id || scene3.floors[0]?.id;
    if (floorId) standAt(hit.point, floorId);
  };
  renderer.domElement.addEventListener("dblclick", onDouble);
  const onWheel = (ev: WheelEvent) => {
    if (!walk) return;
    ev.preventDefault();
    const step = controls.target.clone().sub(camera.position);
    step.y = 0;
    step.normalize().multiplyScalar(-Math.sign(ev.deltaY) * 0.3);
    camera.position.add(step);
    controls.target.add(step);
  };
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") backOut();
  };
  window.addEventListener("keydown", onKey);

  const v = new THREE.Vector3();
  const lines = new Map<Label, SVGLineElement>();
  const clock = new THREE.Clock();
  const eyeIn = new THREE.Vector3();
  let raf = 0;
  const frame = () => {
    controls.update();
    const dt = Math.min(0.05, clock.getDelta());
    if (current.air) air.tick(dt, (floorId) => eyeIn.copy(camera.position).setY(camera.position.y - (groups.get(floorId)?.position.y ?? 0)));
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
    const w = host.clientWidth;
    const h = host.clientHeight;
    /* a floor's room names hide under the roof, and under the floor above
       unless the floors are lifted apart */
    const covered = (i: number) =>
      (current.layer !== "inside" && scene3.roofs.length > 0) || (!current.apart && current.floor === ALL_FLOORS && scene3.floors.some((_, j) => j > i));
    /* names never sit on each other: a unit's rises off the one under it on
       its line, a room's steps down */
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const meets = (r: { x0: number; x1: number; y0: number; y1: number }) => taken.find((b) => b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0);
    const toScreen = (p: THREE_NS.Vector3, lift: number) => {
      v.copy(p);
      v.y += lift;
      v.project(camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, z: v.z };
    };
    for (const l of labels) {
      const s = toScreen(l.at, l.group.position.y);
      /* standing in a room, only its own heads keep their names */
      const mine = !walk || (l.kind === "unit" && !l.outdoor && (!standRoom || (l.unitAt && within(l.unitAt, standRoom.pts))));
      const on = current.labels && l.group.visible && s.z < 1 && mine && (l.kind !== "room" || (!covered(l.floorIndex) && !walk));
      /* hidden, or the sheet's own display (a unit's name is a row: dot, then words) */
      l.el.style.display = on ? "" : "none";
      const line = lines.get(l);
      if (!on) {
        if (line) line.style.display = "none";
        continue;
      }
      const lw = l.el.offsetWidth;
      const lh = l.el.offsetHeight;
      const x = s.x;
      let y = s.y;
      /* a unit's name stands on its line: its bottom at the point */
      const rect = () => (l.kind === "unit" ? { x0: x - lw / 2, x1: x + lw / 2, y0: y - lh, y1: y } : { x0: x - lw / 2, x1: x + lw / 2, y0: y - lh / 2, y1: y + lh / 2 });
      for (let hit = meets(rect()), n = 0; hit && n < 12; hit = meets(rect()), n++) {
        if (l.kind === "unit") y = hit.y0 - 2;
        else y = hit.y1 + lh / 2 + 2;
      }
      taken.push(rect());
      l.el.style.left = `${x}px`;
      l.el.style.top = `${y}px`;
      if (l.base) {
        const b = toScreen(l.base, l.group.position.y);
        let ln = line;
        if (!ln) {
          ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
          svg.appendChild(ln);
          lines.set(l, ln);
        }
        ln.style.display = "";
        ln.setAttribute("x1", String(b.x));
        ln.setAttribute("y1", String(b.y));
        ln.setAttribute("x2", String(x));
        ln.setAttribute("y2", String(y));
      }
    }
    raf = requestAnimationFrame(frame);
  };
  frame();

  return {
    apply,
    backOut,
    dispose: () => {
      gone = true;
      cancelAnimationFrame(raf);
      watch.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("dblclick", onDouble);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      composer?.dispose();
      for (const l of labels) l.el.remove();
      svg.remove();
      scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        m.geometry?.dispose?.();
      });
      for (const x of disposables) x.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function View3D({ scene, look, onLook, planUrl }: { scene: Scene3D; look: Look3D; onLook?: (l: Look3D) => void; planUrl?: (ref: string) => Promise<string> }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const urlRef = useRef(planUrl);
  useEffect(() => {
    urlRef.current = planUrl;
  }, [planUrl]);
  const builtRef = useRef<Built | null>(null);
  const lookRef = useRef(look);
  const [noGl, setNoGl] = useState(false);
  const [standing, setStanding] = useState(false);

  useEffect(() => {
    lookRef.current = look;
    builtRef.current?.apply(look);
  }, [look]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let gone = false;
    const url = urlRef.current ? (ref: string) => urlRef.current!(ref) : undefined;
    void build(host, scene, lookRef.current, url, setStanding).then((b) => {
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
      setStanding(false);
    };
  }, [scene]);

  const tiles = scene.floors.some((f) => f.tiles.length > 0) && !!planUrl;
  const air = scene.units.some((u) => !u.outdoor) || scene.grilles.length > 0;
  const toggle = (on: boolean, word: string, next: Partial<Look3D>) => (
    <button key={word} type="button" className={`ds-ctl-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => onLook?.({ ...look, ...next })}>
      {word}
    </button>
  );
  return (
    <div className="ds3" ref={hostRef} aria-label="The design in 3D" role="img">
      {noGl && <p className="ds3-none">The 3D view needs WebGL, which this browser has turned off.</p>}
      {/* what the picture shows, over its corner (mock, 8 November 2026): the
          drawing on the floors, the outside, the air, the names; and, standing
          in a room, the way back out */}
      {onLook && !noGl && (
        <div className="ds3-show" role="group" aria-label="Show">
          {standing && (
            <button type="button" className="ds-ctl-btn" onClick={() => builtRef.current?.backOut()}>
              Back out
            </button>
          )}
          {tiles && toggle(look.plans !== false, "Plans", { plans: look.plans === false })}
          {toggle(!!look.outside, "Outside", { outside: !look.outside })}
          {air && toggle(!!look.air, "Airflow", { air: !look.air })}
          {toggle(look.labels, "Labels", { labels: !look.labels })}
        </div>
      )}
    </div>
  );
}
