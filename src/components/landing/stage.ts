import type * as THREE_NS from "three";
import { CHEVRON_STROKES } from "@/components/logo";
import { FLIGHT, flightAt } from "@/lib/brand/tiff-flight-path";

/* THE FRONT PAGE'S STAGE: Tiff's mark in black chrome, in 3D, behind the
   giant words and the app's own screens (Isaac, 26 November 2026, after five
   rounds of mocks: "your first loud one was still best", then "With app's
   flight"). The mock is https://claude.ai/artifact/BRVbBq25HzeQk7r46LQaAb.

   The chevron is the logo's own outline (CHEVRON_STROKES), extruded and
   bevelled; the boomerang is its stroke as a tube. It lives on a fixed canvas
   and moves between scenes as the page scrolls, and its boomerang flies the
   app's flight (lib/brand/tiff-flight-path): one lap as the page opens, a lap
   now and then while you read the first screen, lap after lap while you
   scroll through the parts, as she does while she works, and home at the end.

   three.js is the one the Studio's 3D already uses, loaded only here. */

type THREE = typeof THREE_NS;

/** Where the mark stands in a scene: x and y as shares of the visible width
    and height, the turn, the tilt and the size. */
export type Pose = { x: number; y: number; ry: number; rx: number; s: number };

export type StageInput = {
  /** which scene is on screen, and how far into the next one: 1.5 is halfway from the second to the third */
  scene: () => number;
  /** the mark's place in each scene, wide and narrow */
  poses: { wide: Pose[]; narrow: Pose[] };
  /** scenes in this range are the parts: she's working, so the boomerang keeps flying */
  working: [number, number];
  reduced: boolean;
};

/* The loop is thrown further than the app's, so it goes out and comes home */
const REACH = 1.25;
/* one lap's time at the opening's pace, longer for the further reach */
const OPEN_LAP = FLIGHT.OPEN_MS * 1.35;
const WORK_LAP = OPEN_LAP * FLIGHT.SLOWER;
const IDLE_EVERY = 10_000;
const CATCH_MS = 380;
/* logo units (the 100 box) to the stage's */
const K = 0.028;

/** Starts the stage; resolves to its stop, or null where WebGL can't run (the page then shows the flat mark). */
export async function startStage(canvas: HTMLCanvasElement, input: StageInput): Promise<(() => void) | null> {
  const THREE: THREE = await import("three");
  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 8);

  /* THE ROOM THE CHROME REFLECTS: dark, with softboxes, so the mark is mostly
     shadow and its edges catch long white lines of light */
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: 0x020202, side: THREE.BackSide })));
  const box = (w: number, h: number, x: number, y: number, z: number, v: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  box(14, 1.6, 0, 9, 5, 6);
  box(1.4, 12, -10, 0, 3, 4);
  box(8, 0.8, 6, -5, 8, 3);
  box(2, 2, 8, 4, -6, 2);
  box(16, 5, -2, 5, 14, 1.4);
  box(3, 9, 9, 0, 12, 2.2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.02).texture;
  pmrem.dispose();
  scene.environment = env;

  /* THE MARK, from the logo's own numbers, centred on the chevron's middle */
  const CX = 56, CY = 50;
  const at = (x: number, y: number) => new THREE.Vector2((x - CX) * K, -(y - CY) * K);
  const outline = CHEVRON_STROKES[0].d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const corners: THREE_NS.Vector2[] = [];
  for (let i = 0; i + 1 < outline.length; i += 2) corners.push(at(outline[i], outline[i + 1]));
  const chevGeo = new THREE.ExtrudeGeometry(new THREE.Shape(corners), {
    depth: 0.32, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.085, bevelSegments: 8, curveSegments: 4,
  });
  chevGeo.translate(0, 0, -0.16);
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0x16171b, metalness: 1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const grey = new THREE.MeshPhysicalMaterial({ color: 0x8d939c, metalness: 1, roughness: 0.3, clearcoat: 0.6 });

  const mark = new THREE.Group();
  scene.add(mark);
  const chev = new THREE.Mesh(chevGeo, chrome);
  mark.add(chev);

  /* the boomerang turns about its own middle, the app's HOME */
  const home = at(FLIGHT.HOME[0], FLIGHT.HOME[1]);
  const pivot = new THREE.Group();
  pivot.position.set(home.x, home.y, 0);
  mark.add(pivot);
  const boom = new THREE.Group();
  pivot.add(boom);
  const stroke = CHEVRON_STROKES[1].d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const pts = [at(stroke[0], stroke[1]), at(stroke[2], stroke[3]), at(stroke[4], stroke[5])];
  const R = (CHEVRON_STROKES[1].width / 2) * K;
  const geos: THREE_NS.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
    const g = new THREE.CylinderGeometry(R, R, len, 24, 1, true);
    geos.push(g);
    const m = new THREE.Mesh(g, grey);
    m.position.set((p.x + q.x) / 2 - home.x, (p.y + q.y) / 2 - home.y, 0);
    m.rotation.z = Math.atan2(q.y - p.y, q.x - p.x) - Math.PI / 2;
    boom.add(m);
  }
  const ball = new THREE.SphereGeometry(R, 24, 16);
  geos.push(ball);
  for (const p of pts) {
    const m = new THREE.Mesh(ball, grey);
    m.position.set(p.x - home.x, p.y - home.y, 0);
    boom.add(m);
  }

  /* dust in the light */
  const N = 500, dustAt = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    dustAt[i * 3] = (Math.random() - 0.5) * 16;
    dustAt[i * 3 + 1] = (Math.random() - 0.5) * 10;
    dustAt[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustAt, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.018, transparent: true, opacity: 0.4, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  let W = 1, H = 1;
  const size = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    H = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    W = H * camera.aspect;
  };
  size();
  window.addEventListener("resize", size);

  let mx = 0, my = 0, tx = 0, ty = 0;
  const point = (e: PointerEvent) => {
    tx = e.clientX / window.innerWidth - 0.5;
    ty = e.clientY / window.innerHeight - 0.5;
  };
  window.addEventListener("pointermove", point, { passive: true });

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* THE FLIGHT'S CLOCK: rest, a lap (the opening, a lap now and then, or lap
     after lap while she works), and the catch as it comes home */
  type Lap = { start: number; ms: number };
  let lap: Lap | null = null;
  let lastHome = performance.now();
  let caughtAt = -1e9;
  if (!input.reduced) lap = { start: performance.now() + 350, ms: OPEN_LAP };

  let cur: Pose | null = null;
  let raf = 0;
  const frame = (now: number) => {
    const narrow = camera.aspect < 0.85;
    const poses = narrow ? input.poses.narrow : input.poses.wide;
    const last = poses.length - 1;
    const s = Math.max(0, Math.min(last, input.scene()));
    const i = Math.floor(s), f = ease(s - i);
    const A = poses[Math.min(i, last)], B = poses[Math.min(i + 1, last)];
    const goal: Pose = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, ry: A.ry + (B.ry - A.ry) * f, rx: A.rx + (B.rx - A.rx) * f, s: A.s + (B.s - A.s) * f };
    if (!cur || input.reduced) cur = { ...goal };
    else for (const k of ["x", "y", "ry", "rx", "s"] as const) cur[k] += (goal[k] - cur[k]) * 0.09;

    mx += (tx - mx) * 0.06;
    my += (ty - my) * 0.06;
    const bob = input.reduced ? 0 : Math.sin(now / 1400) * 0.05;
    mark.position.set(cur.x * W, cur.y * H + bob, 0);
    mark.scale.setScalar(cur.s);
    mark.rotation.set(cur.rx + my * 0.35, cur.ry + mx * 0.55, 0);

    const working = s > input.working[0] && s < input.working[1];
    if (!input.reduced) {
      if (!lap && working) lap = { start: now, ms: WORK_LAP };
      if (!lap && !working && s < 0.5 && now - lastHome > IDLE_EVERY) lap = { start: now, ms: WORK_LAP };
    }
    if (lap && now >= lap.start) {
      let u = (now - lap.start) / lap.ms;
      if (u >= 1) {
        if (working) {
          lap = { start: lap.start + lap.ms, ms: WORK_LAP };
          u = (now - lap.start) / lap.ms;
        } else {
          lap = null;
          lastHome = now;
          caughtAt = now;
        }
      }
      if (lap) {
        const p = flightAt(u, REACH);
        boom.position.set(p.x * K, -p.y * K, p.z * K);
        boom.rotation.set(p.rx, p.ry, -p.spin);
      }
    }
    if (!lap) {
      boom.position.set(0, 0, 0);
      boom.rotation.set(0, 0, 0);
    }
    /* the catch: the chevron gives a little as it lands, as the app's does */
    const g = (now - caughtAt) / CATCH_MS;
    chev.position.x = g >= 0 && g < 1 ? -0.07 * Math.sin(Math.PI * g) : 0;

    dust.rotation.y = now / 60000;
    dust.position.y = -s * 0.6;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", size);
    window.removeEventListener("pointermove", point);
    chevGeo.dispose();
    for (const g of geos) g.dispose();
    dustGeo.dispose();
    dustMat.dispose();
    chrome.dispose();
    grey.dispose();
    env.dispose();
    renderer.dispose();
  };
}
