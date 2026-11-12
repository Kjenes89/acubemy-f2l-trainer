// 3D-kube som følger den fysiske kuben: animerte lagtrekk og orientering fra gyroen.
// Modellen bygges i kubens egen ramme (hvit opp, grønn foran, rød høyre = three.js +Y, +Z, +X).
// Uten gyro (eller før kalibrering) vises den slik Vegard holder den: z2 → gul opp, oransje høyre.
import * as THREE from "three";
import { STICKERS, FACES, COLORS } from "./cube.js";

const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const GREY = 0x3a3d42;
const HELD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI); // z2

export class Cube3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(4.6, 5.2, 7.6);
    this.camera.lookAt(0, 0, 0);
    this.root = new THREE.Group();
    this.root.quaternion.copy(HELD);
    this.scene.add(this.root);
    this.target = HELD.clone();
    this.gyro = null;

    // Kubebiter (sorte kropper) og klistremerker, ett mesh per klistremerke-indeks.
    this.cubies = [];
    const body = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const m = new THREE.Mesh(body, bodyMat);
      m.position.set(x, y, z);
      m.userData.pos = [x, y, z];
      this.root.add(m);
      this.cubies.push(m);
    }
    const plane = new THREE.PlaneGeometry(0.84, 0.84);
    this.stickers = STICKERS.map((s) => {
      const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide }));
      const [x, y, z] = s.pos, [nx, ny, nz] = s.n;
      mesh.position.set(x + nx * 0.485, y + ny * 0.485, z + nz * 0.485);
      mesh.lookAt(mesh.position.x + nx, mesh.position.y + ny, mesh.position.z + nz);
      mesh.userData.pos = s.pos;
      mesh.userData.home = { p: mesh.position.clone(), q: mesh.quaternion.clone() };
      this.root.add(mesh);
      return mesh;
    });
    this.queue = [];
    this.anim = null;
    this.facelets = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.container.clientWidth || 260, h = this.container.clientHeight || 260;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Farger fra fasetter. Brikker med gult grås ut når dim er på. */
  paint(facelets, dim) {
    this.facelets = facelets;
    const grey = new Set();
    if (dim) {
      const byPos = new Map();
      STICKERS.forEach((s, i) => { const k = s.pos.join(","); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(i); });
      for (const idx of byPos.values()) if (idx.some((i) => facelets[i] === "D")) idx.forEach((i) => grey.add(i));
    }
    const map = this.colorMap || {};
    this.stickers.forEach((m, i) => m.material.color.set(grey.has(i) ? GREY : COLORS[map[facelets[i]] || facelets[i]]));
  }

  /** Nytt trekk: animer laget, og mal den nye tilstanden når animasjonen er ferdig. */
  move(face, amt, newFacelets, dim) {
    this.queue.push({ face, amt, facelets: newFacelets, dim });
    if (this.queue.length > 3) { // henger etter: hopp rett til siste tilstand
      const last = this.queue[this.queue.length - 1];
      this.queue = [];
      this.endAnim();
      this.paint(last.facelets, last.dim);
    }
  }

  set(facelets, dim) {
    this.queue = [];
    this.endAnim();
    this.paint(facelets, dim);
  }

  /** Fargebytte på skjermen: sidefargene roteres som om kuben var snudd (y), hvit/gul står. */
  setColorShift(k) {
    const ring = ["F", "L", "B", "R"]; // grønn, oransje, blå, rød rundt kuben slik den holdes
    this.colorMap = Object.fromEntries(ring.map((c, i) => [c, ring[(i + k) % 4]]));
  }

  /** Bytt grå/full farge uten å avbryte animasjon. */
  redim(dim) {
    if (this.anim) this.anim.job.dim = dim;
    this.queue.forEach((j) => (j.dim = dim));
    if (!this.anim && !this.queue.length && this.facelets) this.paint(this.facelets, dim);
  }

  /** Grepet nå, lest fra gyroen: { U: sensorflate, F: …, R: … } for flatene som vender opp, mot deg, til høyre osv. */
  grip() {
    if (!this.gyro) return null;
    // Robust mot vipping i hånda: opp = flaten som peker mest opp; front = den av sideflatene som,
    // sett ovenfra, peker mest mot deg. Grepet byttes bare når den nye flaten er tydelig (hysterese),
    // så en vipp på 30–45° mens du dreier ikke leses som en rotasjon.
    const v = {};
    for (const [s, n] of Object.entries(NORMALS)) v[s] = new THREE.Vector3(...n).applyQuaternion(this.target);
    const OPP = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
    const last = this.lastGrip;
    let up = Object.keys(v).reduce((a, b) => (v[b].y > v[a].y ? b : a));
    // Opp byttes først når den gamle opp-flaten er vippet over ca. 78° (før 60°). Ved F2/R2 og omgrep vippes
    // kuben mye mot deg, og det ble lest som en x-rotasjon (Gc avvist 3 ganger 12.11. 21:55, «(rotert)»).
    // En ekte x/x' er 90°, så den fanges fortsatt.
    if (last && v[last.U].y > 0.2) up = last.U;
    const sides = Object.keys(v).filter((s) => s !== up && s !== OPP[up]);
    const horiz = (s) => { const h = new THREE.Vector2(v[s].x, v[s].z); return h.length() > 1e-6 ? h.normalize() : h; };
    let front = sides.reduce((a, b) => (horiz(b).y > horiz(a).y ? b : a));
    if (last && last.U === up && sides.includes(last.F) && horiz(last.F).y > 0.5) front = last.F;
    const right = sides.filter((s) => s !== front && s !== OPP[front]).reduce((a, b) => (horiz(b).x > horiz(a).x ? b : a));
    const g = { U: up, D: OPP[up], F: front, B: OPP[front], R: right, L: OPP[right] };
    this.lastGrip = g;
    return g;
  }

  setGyro(q) { this.gyro = new THREE.Quaternion(q.x, q.y, q.z, q.w); }

  startAnim(job) {
    const n = new THREE.Vector3(...NORMALS[job.face]);
    const axis = ["x", "y", "z"][NORMALS[job.face].findIndex((v) => v !== 0)];
    const layer = NORMALS[job.face][{ x: 0, y: 1, z: 2 }[axis]];
    const pick = (o) => o.userData.pos[{ x: 0, y: 1, z: 2 }[axis]] === layer;
    const pivot = new THREE.Group();
    this.root.add(pivot);
    const members = [...this.cubies.filter(pick), ...this.stickers.filter(pick)];
    members.forEach((m) => pivot.attach(m));
    const angle = (job.amt === 2 ? -Math.PI : job.amt === 3 ? Math.PI / 2 : -Math.PI / 2);
    this.anim = { job, pivot, members, n, angle, t0: performance.now(), dur: job.amt === 2 ? 160 : 110 };
  }

  endAnim() {
    if (!this.anim) return;
    const { pivot, members } = this.anim;
    members.forEach((m) => this.root.attach(m));
    for (const m of members) {
      if (m.userData.home) { m.position.copy(m.userData.home.p); m.quaternion.copy(m.userData.home.q); }
      else { m.position.set(...m.userData.pos); m.quaternion.identity(); }
    }
    this.root.remove(pivot);
    this.anim = null;
  }

  frame(now) {
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (performance.now() - a.t0) / a.dur);
      a.pivot.quaternion.setFromAxisAngle(a.n, a.angle * (1 - (1 - t) * (1 - t)));
      if (t >= 1) { const job = a.job; this.endAnim(); this.paint(job.facelets, job.dim); }
    }
    if (!this.anim && this.queue.length) this.startAnim(this.queue.shift());
    // acubemy oppgir orienteringen relativt til kalibreringsgrepet (hvit ned, grønn foran) → HELD · q.
    if (this.fixed) this.target.copy(HELD); // fast visning (Review): kuben følger ikke gyroen
    else if (this.gyro) this.target.multiplyQuaternions(HELD, this.gyro);
    this.root.quaternion.slerp(this.target, 0.35);
    this.renderer.render(this.scene, this.camera);
  }
}

export { FACES };
