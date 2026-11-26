import type * as THREE_NS from "three";
import { CHEVRON_STROKES } from "@/components/logo";
import { FLIGHT, orbitAt, throwAt } from "@/lib/brand/tiff-flight-path";

/* THE FRONT PAGE'S STAGE: Tiff's mark in 3D, a pearl chevron and a metal boomerang, behind the
   giant words and the app's own screens (Isaac, 26 November 2026, after five
   rounds of mocks: "your first loud one was still best", then "With app's
   flight"). The mock is https://claude.ai/artifact/BRVbBq25HzeQk7r46LQaAb.

   The chevron is the logo's own outline (CHEVRON_STROKES), extruded and
   bevelled; the boomerang is its stroke as a tube. It lives on a fixed canvas
   and moves between scenes as the page scrolls, and its boomerang flies the
   app's flight (lib/brand/tiff-flight-path): thrown as the page opens, then
   round its loop for as long as the page is open, as hers flies while she
   works.

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
  reduced: boolean;
};

/* The loop is thrown further than the app's, so it goes out wide and round */
const REACH = 1.1;
/* the throw out onto the loop, then each lap of it, at the app's thinking pace */
const LAP_MS = FLIGHT.OPEN_MS * 1.35 * FLIGHT.SLOWER;
const THROW_MS = LAP_MS * 0.62;
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
  /* a soft fill and a key from the top left, so the pearl reads white and not grey; the softboxes still draw its edges */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1c1c22, 0.7));
  const key = new THREE.DirectionalLight(0xfff8f2, 1.4);
  key.position.set(-4, 5, 6);
  scene.add(key);

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
  /* THE LOGO'S COLOURS on the ink: the chevron white and the boomerang its
     grey (Isaac, 27 November 2026: "Make the logo its correct colors. Don't
     change the actual 3D itself. Give it that same light capturing
     reflection ... like a pearlescent white and a metallic grey"). The same
     room and softboxes light it, so the edges still catch their long lines
     of light; the white is a pearl, a clearcoat over a pale sheen with a
     little iridescence, and the grey is a metal. */
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xf6f4f0, metalness: 0.45, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8,
    sheen: 0.6, sheenColor: new THREE.Color(0xeee6f4), sheenRoughness: 0.4, iridescence: 0.35, iridescenceIOR: 1.3,
  });
  const grey = new THREE.MeshPhysicalMaterial({ color: 0x9ea3ab, metalness: 1, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 1.6 });

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

  /* THE FLIGHT'S CLOCK: thrown once as the page opens, then round the loop for
     as long as the page is open, never coming home (Isaac, 27 November 2026:
     "The boomerang keeps returning to the chevron and stopping instead of
     just continuing to circle around"). The spin runs at the app's thinking
     rate the whole way, so it never jolts between the throw and the laps. */
  const thrownAt = performance.now() + 350;

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

    const since = now - thrownAt;
    if (input.reduced || since < 0) {
      boom.position.set(0, 0, 0);
      boom.rotation.set(0, 0, 0);
    } else {
      const spin = 2 * Math.PI * FLIGHT.THINK_RATE * since;
      const p = since < THROW_MS ? throwAt(since / THROW_MS, REACH, spin) : orbitAt((since - THROW_MS) / LAP_MS, REACH, spin);
      boom.position.set(p.x * K, -p.y * K, p.z * K);
      boom.rotation.set(p.rx, p.ry, -p.spin);
    }

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
