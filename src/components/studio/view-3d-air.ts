import type * as THREE_NS from "three";
import { within, reach } from "@/lib/studio/furnish3d";
import type { Scene3D, XZ } from "@/lib/studio/scene3d";

/* THE AIR, IN 3D (mock, Isaac 8 November 2026: "Push mock further"). The
   air leaving each head and each supply grille, as the Simulate overlay
   draws it on the plan: a wall split throws forward and the cool air
   sinks; a cassette and a ceiling diffuser throw along the ceiling, then
   fall; a floor or kicker grille throws low and rises. Its colour is the
   supply blue (airflow-marks.ts) where it leaves, through the overlay's
   ramp (sim-overlay.tsx PLUME_RAMP), paling to the room as it mixes. Each
   stream stops at its room's walls.

   AS A CAR'S CLIMATE SCREEN DRAWS IT (Isaac, 8 November 2026, a video of
   one: "Airflow should look like this"): soft see-through ribbons, bright
   down the middle and feathered at the edges, narrow at the outlet and
   widening as they go, a few strands to a stream that sway a little, with
   brightness running along them the way the air goes. Each ribbon turns
   its face to you, so it reads from any side. */

type Three = typeof THREE_NS;
type Mode = "fall" | "ceiling" | "low";
type Emitter = { floorId: string; at: XZ; y: number; dirs: XZ[]; mode: Mode; throwM: number; ceiling: number; floorY: number };

/** supply blue, the overlay's blue, a pale blue: where the air leaves, on its way, mixing */
const LEAVES = 0x2563eb;
const ON_ITS_WAY = 0x5ca0f0;
const MIXED = 0x9cc8f2;
const SAMPLES = 32;
/** each stream's strands: a turn off its line (degrees), a lift (metres), how wide it ends (metres) */
const STRANDS: [number, number, number][] = [
  [-15, 0.14, 0.7],
  [0, -0.06, 1.0],
  [16, 0.05, 0.6],
];

const turnOf = (rot: number): XZ => {
  const t = (-rot * Math.PI) / 180;
  return [Math.sin(t), Math.cos(t)];
};
const rotate = (v: XZ, deg: number): XZ => {
  const a = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
};
const side = (v: XZ): XZ => [v[1], -v[0]];
const neg = (v: XZ): XZ => [-v[0], -v[1]];

function emitters(scene: Scene3D): Emitter[] {
  const out: Emitter[] = [];
  const floor = new Map(scene.floors.map((f) => [f.id, f]));
  /* a ducted or bulkhead head throws through its grilles, below */
  for (const u of scene.units) {
    const f = floor.get(u.floorId);
    if (!f || u.outdoor) continue;
    const front = turnOf(u.rot);
    const base = { floorId: u.floorId, ceiling: f.y0 + f.ceiling, floorY: f.y0 };
    if (u.form === "wall") {
      out.push({ ...base, at: [u.at[0] + front[0] * (u.d / 2), u.at[1] + front[1] * (u.d / 2)], y: u.y + 0.05, dirs: [front], mode: "fall", throwM: 4.2 });
    } else if (u.form.startsWith("cassette")) {
      const ways = /1way|1-way/.test(u.form) ? [front] : /2way|2-way/.test(u.form) ? [front, neg(front)] : [front, neg(front), side(front), neg(side(front))];
      out.push({ ...base, at: u.at, y: u.y - 0.04, dirs: ways, mode: "ceiling", throwM: 3.2 });
    } else if (u.form === "under-ceiling") {
      out.push({ ...base, at: [u.at[0] + front[0] * (u.d / 2), u.at[1] + front[1] * (u.d / 2)], y: u.y + 0.06, dirs: [front], mode: "ceiling", throwM: 5 });
    } else if (u.form === "floor-console") {
      out.push({ ...base, at: [u.at[0] + front[0] * (u.d / 2), u.at[1] + front[1] * (u.d / 2)], y: u.y + u.h, dirs: [front], mode: "low", throwM: 3 });
    }
  }
  for (const g of scene.grilles) {
    const f = floor.get(g.floorId);
    if (!f || g.stream !== "supply") continue;
    const base = { floorId: g.floorId, ceiling: f.y0 + f.ceiling, floorY: f.y0 };
    const face = turnOf(g.rot);
    if (g.mount === "ceiling") {
      const dirs = g.style === "round" ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => rotate(face, a)) : g.style === "linear" ? [face, neg(face)] : [face, neg(face), side(face), neg(side(face))];
      out.push({ ...base, at: g.at, y: g.y - 0.02, dirs, mode: "ceiling", throwM: 2.6 });
    } else if (g.mount === "wall") {
      const high = g.y > f.y0 + 1.2;
      out.push({ ...base, at: g.at, y: g.y, dirs: [face], mode: high ? "fall" : "low", throwM: 3.6 });
    } else {
      /* floor and kicker grilles throw low, along the floor, and rise */
      out.push({ ...base, at: g.at, y: g.y + 0.02, dirs: g.mount === "kicker" ? [face] : [face, neg(face)], mode: "low", throwM: 2.4 });
    }
  }
  return out;
}

/** a stream's height along it, 0 to 1 */
function heightAt(e: Emitter, t: number): number {
  if (e.mode === "fall") return e.y - (e.y - (e.floorY + 1.0)) * Math.pow(t, 1.7);
  if (e.mode === "ceiling") {
    const s = Math.max(0, (t - 0.5) / 0.5);
    return e.y - (e.y - (e.floorY + 1.3)) * s * s * (3 - 2 * s);
  }
  return e.y + (e.floorY + 1.5 - e.y) * Math.pow(t, 0.8);
}

/** The air's streams, one set of moving dots per floor, ready to add to the floor's group. */
export function airMaker(THREE: Three, scene: Scene3D, P: (p: XZ) => [number, number], own: <T extends { dispose: () => void }>(x: T) => T) {
  const spaces = new Map(scene.floors.map((f) => [f.id, f.spaces.filter((s) => s.kind !== "void" && s.kind !== "outdoor")]));
  /* a strand: its line in the floor's frame, the level way across it for the sway, how wide it gets, its own time */
  type Strand = { pts: Float32Array; across: Float32Array; wide: number; seed: number; first: number };
  const byFloor = new Map<string, Strand[]>();
  for (const e of emitters(scene)) {
    const room = spaces.get(e.floorId)?.find((s) => within(e.at, s.pts));
    const strands = e.mode === "ceiling" ? STRANDS.slice(0, 2) : STRANDS;
    const narrow = e.mode === "ceiling" ? 0.7 : 1;
    e.dirs.forEach((dir, di) =>
      strands.forEach(([turn, lift, wide], k) => {
        const d = rotate(dir, turn);
        const start: XZ = [e.at[0] + d[0] * 0.1, e.at[1] + d[1] * 0.1];
        const wall = room ? reach(start, d, room.pts) : Infinity;
        const L = Math.max(0.6, Math.min(e.throwM * (1 - 0.08 * k), wall - 0.15));
        const pts = new Float32Array((SAMPLES + 1) * 3);
        const across = new Float32Array((SAMPLES + 1) * 3);
        const [sx, sz] = [-d[1], d[0]];
        for (let i = 0; i <= SAMPLES; i++) {
          const t = i / SAMPLES;
          const [x, z] = P([start[0] + d[0] * L * t, start[1] + d[1] * L * t]);
          pts.set([x, heightAt(e, t) + lift * t, z], i * 3);
          across.set([sx, 0, sz], i * 3);
        }
        if (!byFloor.has(e.floorId)) byFloor.set(e.floorId, []);
        byFloor.get(e.floorId)!.push({ pts, across, wide: wide * narrow, seed: (di * 3 + k) * 0.618, first: 0 });
      })
    );
  }

  const material = own(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLeaves: { value: new THREE.Color(LEAVES) },
        uOnItsWay: { value: new THREE.Color(ON_ITS_WAY) },
        uMixed: { value: new THREE.Color(MIXED) },
      },
      vertexShader: `
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uLeaves;
        uniform vec3 uOnItsWay;
        uniform vec3 uMixed;
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          float along = vUv.x;
          float off = abs(vUv.y * 2.0 - 1.0);
          /* bright down the middle, feathered to nothing at the edges */
          float body = pow(1.0 - off, 1.4);
          /* it comes out of the outlet and thins away as it mixes */
          float life = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.62, 1.0, along));
          /* brightness running along it, the way the air goes */
          float run = 0.62 + 0.38 * sin(6.2831 * (along * 1.8 - uTime * 0.45) + vSeed * 5.0);
          vec3 c = along < 0.5 ? mix(uLeaves, uOnItsWay, along * 2.0) : mix(uOnItsWay, uMixed, along * 2.0 - 1.0);
          c = mix(c, vec3(1.0), pow(1.0 - off, 8.0) * 0.35);
          gl_FragColor = vec4(c, body * life * run * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  const streams: { floorId: string; points: THREE_NS.Mesh; strands: Strand[]; pos: Float32Array }[] = [];
  for (const [floorId, strands] of byFloor) {
    const per = (SAMPLES + 1) * 2;
    const pos = new Float32Array(strands.length * per * 3);
    const uv = new Float32Array(strands.length * per * 2);
    const seed = new Float32Array(strands.length * per);
    const index: number[] = [];
    strands.forEach((st, n) => {
      st.first = n * per;
      for (let i = 0; i <= SAMPLES; i++) {
        const v = st.first + i * 2;
        uv.set([i / SAMPLES, 0, i / SAMPLES, 1], v * 2);
        seed[v] = st.seed;
        seed[v + 1] = st.seed;
        if (i < SAMPLES) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    streams.push({ floorId, points: mesh, strands, pos });
  }

  let time = 0;
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const look = new THREE.Vector3();
  const w = new THREE.Vector3();
  /** move the air on by `dt` seconds; each ribbon turns its face to the camera, at `eye` in its floor's frame */
  const tick = (dt: number, eye: (floorId: string) => THREE_NS.Vector3) => {
    time += dt;
    material.uniforms.uTime.value = time;
    for (const s of streams) {
      const cam = eye(s.floorId);
      for (const st of s.strands) {
        for (let i = 0; i <= SAMPLES; i++) {
          const f = i / SAMPLES;
          const a = Math.max(0, i - 1) * 3;
          const b = Math.min(SAMPLES, i + 1) * 3;
          /* a little sway, more the further it has gone */
          const sway = Math.sin(f * 7 - time * 1.3 + st.seed * 4) * 0.07 * f;
          p.set(st.pts[i * 3] + st.across[i * 3] * sway, st.pts[i * 3 + 1] + Math.sin(f * 5 - time + st.seed) * 0.03 * f, st.pts[i * 3 + 2] + st.across[i * 3 + 2] * sway);
          t.set(st.pts[b] - st.pts[a], st.pts[b + 1] - st.pts[a + 1], st.pts[b + 2] - st.pts[a + 2]);
          look.copy(cam).sub(p);
          w.crossVectors(t, look).normalize();
          /* narrow at the outlet, widening as it goes */
          const half = (0.1 + (st.wide - 0.1) * Math.pow(f, 0.75)) / 2;
          const v = (st.first + i * 2) * 3;
          s.pos[v] = p.x + w.x * half;
          s.pos[v + 1] = p.y + w.y * half;
          s.pos[v + 2] = p.z + w.z * half;
          s.pos[v + 3] = p.x - w.x * half;
          s.pos[v + 4] = p.y - w.y * half;
          s.pos[v + 5] = p.z - w.z * half;
        }
      }
      (s.points.geometry.attributes.position as THREE_NS.BufferAttribute).needsUpdate = true;
    }
  };
  return { streams, tick };
}
