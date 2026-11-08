import type * as THREE_NS from "three";
import type { Piece3D } from "@/lib/studio/furnish3d";

/* WHAT STANDS IN THE ROOMS, PAINTED (mock, Isaac 8 November 2026: "Push
   mock further"). Each piece in its own frame: across it on x, front to
   back on z with its front to +z, standing on y 0. Plain shapes in the
   colours furniture is: timber, linen, charcoal, white joinery under a stone
   top, so the house reads as lived in and the units stay what you look at. */

type Three = typeof THREE_NS;
type Mat = THREE_NS.Material;

export function pieceMaker(THREE: Three, M: (o: THREE_NS.MeshStandardMaterialParameters) => THREE_NS.MeshStandardMaterial) {
  const mat = {
    timber: M({ color: 0xc9a27e, roughness: 0.6 }),
    outdoor: M({ color: 0x9c7b5b, roughness: 0.8 }),
    black: M({ color: 0x1f2937, roughness: 0.5, metalness: 0.4 }),
    charcoal: M({ color: 0x52525b, roughness: 1 }),
    cushion: M({ color: 0x63636c, roughness: 1 }),
    linen: M({ color: 0xf5f5f4, roughness: 1 }),
    duvet: M({ color: 0xe7e5e4, roughness: 1 }),
    throw: M({ color: 0x64748b, roughness: 1 }),
    rug: M({ color: 0xd6d3d1, roughness: 1 }),
    carcass: M({ color: 0xf5f5f4, roughness: 0.5 }),
    stone: M({ color: 0xe7e5e4, roughness: 0.25 }),
    kick: M({ color: 0x6b7280, roughness: 0.8 }),
    steel: M({ color: 0xd1d5db, roughness: 0.3, metalness: 0.8 }),
    ceramic: M({ color: 0xffffff, roughness: 0.15 }),
    screen: M({ color: 0x111827, roughness: 0.15, metalness: 0.2 }),
    groove: M({ color: 0xa8a29e, roughness: 0.8 }),
    paint: M({ color: 0x475569, roughness: 0.3, metalness: 0.6 }),
    glass: M({ color: 0x1f2937, roughness: 0.1, metalness: 0.3 }),
    tyre: M({ color: 0x111111, roughness: 0.9 }),
    lamp: M({ color: 0xf5f5f4, roughness: 0.9 }),
    mirror: M({ color: 0xe5e7eb, roughness: 0.05, metalness: 1 }),
    basin: M({ color: 0xe5e7eb, roughness: 0.3 }),
  };

  return (p: Piece3D): THREE_NS.Group => {
    const g = new THREE.Group();
    const bx = (w: number, h: number, d: number, m: Mat, x: number, y: number, z: number, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const cyl = (r: number, h: number, m: Mat, x: number, y: number, z: number, along: "y" | "x" | "z" = "y", seg = 24) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
      if (along === "x") mesh.rotation.z = Math.PI / 2;
      if (along === "z") mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const legs = (w: number, d: number, h: number, m: Mat, t = 0.04, inset = 0.06) => {
      for (const sx of [1, -1]) for (const sz of [1, -1]) bx(t, h, t, m, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset));
    };
    /* door lines down a run of joinery, about every 600 mm */
    const doors = (w: number, y0: number, y1: number, z: number) => {
      const n = Math.max(1, Math.round(w / 0.6));
      for (let i = 1; i < n; i++) bx(0.006, y1 - y0, 0.004, mat.groove, -w / 2 + (w * i) / n, (y0 + y1) / 2, z, false);
    };
    const { w, d } = p;
    const text = (p.text ?? "").toLowerCase();
    switch (p.kind) {
      case "bed": {
        bx(w, 0.3, d, mat.timber, 0, 0.15, 0);
        bx(w - 0.04, 0.22, d - 0.06, mat.linen, 0, 0.41, 0);
        bx(w + 0.02, 0.05, d * 0.66, mat.duvet, 0, 0.545, d / 2 - d * 0.33);
        bx(w + 0.04, 0.06, 0.45, mat.throw, 0, 0.555, d / 2 - 0.32);
        bx(w + 0.1, 1.05, 0.08, mat.timber, 0, 0.525, -d / 2 - 0.02);
        const pillows = w > 1.2 ? 2 : 1;
        for (let i = 0; i < pillows; i++) bx(w / pillows - 0.12, 0.12, 0.4, mat.linen, -w / 2 + (w / pillows) * (i + 0.5), 0.58, -d / 2 + 0.3);
        break;
      }
      case "bedside":
        bx(w, 0.5, d, mat.timber, 0, 0.25, 0);
        cyl(0.03, 0.18, mat.black, 0, 0.59, 0);
        cyl(0.11, 0.2, mat.lamp, 0, 0.78, 0);
        break;
      case "sofa": {
        bx(w, 0.42, d, mat.charcoal, 0, 0.21, 0);
        bx(w, 0.42, 0.2, mat.charcoal, 0, 0.63, -d / 2 + 0.1);
        for (const s of [1, -1]) bx(0.18, 0.62, d, mat.charcoal, s * (w / 2 - 0.09), 0.31, 0);
        const n = w > 2 ? 3 : 2;
        const cw = (w - 0.36) / n;
        for (let i = 0; i < n; i++) bx(cw - 0.02, 0.12, d - 0.26, mat.cushion, -w / 2 + 0.18 + cw * (i + 0.5), 0.48, 0.11);
        break;
      }
      case "coffee":
        bx(w, 0.04, d, mat.timber, 0, 0.4, 0);
        bx(w - 0.16, 0.36, d - 0.16, mat.black, 0, 0.19, 0);
        break;
      case "rug":
        bx(w, 0.012, d, mat.rug, 0, 0.006, 0, false);
        break;
      case "dining":
      case "outdoor-table":
      case "table": {
        const top = p.kind === "outdoor-table" ? mat.outdoor : mat.timber;
        bx(w, 0.04, d, top, 0, 0.74, 0);
        legs(w, d, 0.72, p.kind === "outdoor-table" ? mat.outdoor : mat.black, 0.05, 0.1);
        break;
      }
      case "chair":
      case "outdoor-chair": {
        const m = p.kind === "chair" ? mat.charcoal : mat.outdoor;
        bx(w - 0.02, 0.05, d - 0.02, m, 0, 0.45, 0);
        bx(w - 0.02, 0.4, 0.04, m, 0, 0.67, -d / 2 + 0.03);
        legs(w - 0.02, d - 0.02, 0.43, p.kind === "chair" ? mat.black : mat.outdoor, 0.03, 0.03);
        break;
      }
      case "tv": {
        if (d < 0.3) {
          /* on the wall */
          const sw = Math.min(w, 1.9);
          bx(sw, sw * 0.5625, 0.04, mat.screen, 0, 1.25, -d / 2 + 0.04);
        } else {
          bx(w, 0.45, d, mat.timber, 0, 0.225, 0);
          const sw = Math.min(1.45, w * 0.8);
          bx(sw, sw * 0.5625, 0.04, mat.screen, 0, 0.5 + (sw * 0.5625) / 2, -d / 2 + 0.1);
        }
        break;
      }
      case "fridge":
        bx(w, 1.8, d, mat.steel, 0, 0.9, 0);
        bx(0.008, 1.7, 0.006, mat.black, 0, 0.9, d / 2);
        for (const s of [1, -1]) bx(0.02, 0.5, 0.03, mat.black, s * 0.05, 1.1, d / 2 + 0.015);
        break;
      case "washer": {
        bx(w, 0.85, d, mat.ceramic, 0, 0.425, 0);
        const door = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), mat.screen);
        door.position.set(0, 0.42, d / 2 + 0.002);
        g.add(door);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 10, 32), mat.steel);
        ring.position.set(0, 0.42, d / 2 + 0.01);
        g.add(ring);
        break;
      }
      case "desk":
        bx(w, 0.04, d, mat.timber, 0, 0.74, 0);
        legs(w, d, 0.72, mat.black, 0.04, 0.05);
        break;
      case "car": {
        /* its length on z, nose to +z: a body, the glass over it, a roof, four wheels */
        const side = (pts: [number, number][], wide: number, m: Mat, bevel: number) => {
          const s = new THREE.Shape();
          pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
          const geo = new THREE.ExtrudeGeometry(s, { depth: wide - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
          geo.translate(0, 0, -(wide - bevel * 2) / 2);
          geo.rotateY(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, m);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          g.add(mesh);
        };
        const L = d / 2;
        const k = d / 4.6;
        side([[-L, 0.24], [L, 0.24], [L, 0.72], [L - 0.2 * k, 0.86], [0.95 * k, 0.95], [-1.9 * k, 0.98], [-L, 0.9]], w - 0.02, mat.paint, 0.06);
        side([[0.95 * k, 0.93], [0.28 * k, 1.36], [-1.2 * k, 1.36], [-1.9 * k, 0.96]], w - 0.3, mat.glass, 0.02);
        side([[0.3 * k, 1.34], [-1.18 * k, 1.34], [-1.16 * k, 1.42], [0.24 * k, 1.42]], w - 0.32, mat.paint, 0.02);
        for (const sx of [1, -1])
          for (const sz of [1.45 * k, -1.38 * k]) {
            cyl(0.33, 0.22, mat.tyre, sx * (w / 2 - 0.13), 0.33, sz, "x", 28);
            cyl(0.2, 0.01, mat.steel, sx * (w / 2 - 0.018), 0.33, sz, "x", 28);
          }
        for (const sx of [1, -1]) bx(0.32, 0.08, 0.02, mat.lamp, sx * (w / 2 - 0.3), 0.72, L + 0.035, false);
        break;
      }
      case "toilet": {
        bx(w, 0.4, 0.18, mat.ceramic, 0, 0.6, -d / 2 + 0.09);
        const pan = cyl(0.19, 0.4, mat.ceramic, 0, 0.2, 0.08, "y", 28);
        pan.scale.set(1, 1, 1.35);
        const seat = cyl(0.2, 0.03, mat.ceramic, 0, 0.415, 0.08, "y", 28);
        seat.scale.set(1, 1, 1.35);
        break;
      }
      case "bath":
        bx(w, 0.55, d, mat.ceramic, 0, 0.275, 0);
        bx(w - 0.16, 0.012, d - 0.16, mat.basin, 0, 0.552, 0, false);
        break;
      case "bench":
      case "island":
      case "joinery": {
        const h = p.h ?? 0.9;
        const body = p.kind === "island" ? mat.timber : mat.carcass;
        const topped = h <= 1.0;
        const ch = h - (topped ? 0.04 : 0) - 0.1;
        bx(w, ch, d - 0.02, body, 0, 0.1 + ch / 2, -0.01);
        bx(w - 0.04, 0.1, d - 0.08, mat.kick, 0, 0.05, -0.04, false);
        if (topped) bx(w + 0.02, 0.04, d + 0.02, mat.stone, 0, h - 0.02, 0);
        doors(w, 0.12, h - 0.06, d / 2 - 0.009);
        if (/cooktop|hob/.test(text)) bx(0.6, 0.006, Math.min(0.5, d - 0.1), mat.screen, 0, h + 0.003, 0, false);
        if (/sink|tub/.test(text)) bx(0.7, 0.006, Math.min(0.42, d - 0.12), mat.steel, w > 1.6 ? -w / 4 : 0, h + 0.003, 0, false);
        break;
      }
      case "tall": {
        const h = p.h ?? 2.1;
        bx(w, h - 0.1, d, mat.carcass, 0, 0.1 + (h - 0.1) / 2, 0);
        bx(w - 0.04, 0.1, d - 0.06, mat.kick, 0, 0.05, -0.03, false);
        doors(w, 0.12, h - 0.02, d / 2 + 0.002);
        break;
      }
      case "vanity": {
        bx(w, 0.45, d - 0.05, mat.timber, 0, 0.58, -0.025);
        bx(w, 0.04, d, mat.ceramic, 0, 0.825, 0);
        const bowl = cyl(0.2, 0.1, mat.ceramic, 0, 0.89, 0.02, "y", 28);
        bowl.scale.set(Math.min(1.4, w / 0.5), 1, 1);
        bx(Math.min(1.2, w * 0.8), 0.8, 0.02, mat.mirror, 0, 1.5, -d / 2 + 0.012, false);
        break;
      }
    }
    return g;
  };
}
