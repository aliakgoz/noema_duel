import * as THREE from 'three';

export type Finish = 'ceramic' | 'ceramicLight' | 'stone' | 'sand' | 'navy' | 'joint' | 'copper' | 'amber' | 'cyan' | 'cyanDim' | 'rose' | 'leaf' | 'leafLight' | 'soil' | 'glass' | 'white';

/** Shared geometries and finishes keep the diorama inexpensive to animate. */
export class StudioAssets {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private textures: THREE.Texture[] = [];

  material(name: Finish): THREE.MeshStandardMaterial {
    const existing = this.materials.get(name);
    if (existing) return existing as THREE.MeshStandardMaterial;
    const finishes: Record<Finish, THREE.MeshStandardMaterialParameters> = {
      ceramic: { color: '#e9dfc9', roughness: 0.47, metalness: 0.14 },
      ceramicLight: { color: '#fff5de', roughness: 0.31, metalness: 0.12 },
      stone: { color: '#aaa59a', roughness: 0.88 },
      sand: { color: '#cbb99b', roughness: 0.74, metalness: 0.1 },
      navy: { color: '#233743', roughness: 0.43, metalness: 0.42 },
      joint: { color: '#172632', roughness: 0.6, metalness: 0.38 },
      copper: { color: '#b9804b', roughness: 0.33, metalness: 0.74 },
      amber: { color: '#e3a84e', emissive: '#f2a134', emissiveIntensity: 0.24, roughness: 0.36, metalness: 0.3 },
      cyan: { color: '#84f4e4', emissive: '#50e9dc', emissiveIntensity: 1.4, roughness: 0.28, metalness: 0.16 },
      cyanDim: { color: '#58998f', emissive: '#40b5aa', emissiveIntensity: 0.2, roughness: 0.46, metalness: 0.3 },
      rose: { color: '#b9847d', roughness: 0.8 },
      leaf: { color: '#457f79', roughness: 0.9 },
      leafLight: { color: '#84a18b', roughness: 0.8 },
      soil: { color: '#4a4b41', roughness: 1 },
      glass: { color: '#8ddbd1', transparent: true, opacity: 0.23, roughness: 0.2, metalness: 0.1, depthWrite: false },
      white: { color: '#fff8ea', emissive: '#ffe4b0', emissiveIntensity: 0.7 },
    };
    const material = new THREE.MeshStandardMaterial(finishes[name]);
    this.materials.set(name, material);
    return material;
  }

  /** Stateful mechanisms own their finish so one pressed plate cannot tint another. */
  materialInstance(name: Finish, overrides: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const material = this.material(name).clone();
    material.setValues(overrides);
    this.materials.set(`instance:${this.materials.size}`, material);
    return material;
  }

  /** Soft additive light spill without a fullscreen bloom pass. Shared immutable texture. */
  glowMaterial(color: THREE.ColorRepresentation, opacity = 0): THREE.MeshBasicMaterial {
    let texture = this.textures.find(item => item.name === 'mechanism light spill');
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
      gradient.addColorStop(0.36, 'rgba(255,255,255,0.48)');
      gradient.addColorStop(0.65, 'rgba(255,255,255,0.17)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      texture = new THREE.CanvasTexture(canvas);
      texture.name = 'mechanism light spill';
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(texture);
    }
    const material = new THREE.MeshBasicMaterial({ map: texture, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.materials.set(`glow:${this.materials.size}`, material);
    return material;
  }

  geometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    if (!this.geometries.has(key)) this.geometries.set(key, create());
    return this.geometries.get(key)!;
  }

  roundedGeometry(w: number, h: number, d: number, bevel = 0.035): THREE.BufferGeometry {
    const b = Math.min(bevel, w / 5, h / 5, d / 5);
    return this.geometry(`box:${w}:${h}:${d}:${b}`, () => {
      // Extruding an inset rectangle gives actual beveled edges, rather than painted lines.
      const shape = new THREE.Shape();
      const x = -w / 2 + b, y = -h / 2 + b;
      const sw = w - b * 2, sh = h - b * 2;
      shape.moveTo(x, y);
      shape.lineTo(x + sw, y);
      shape.lineTo(x + sw, y + sh);
      shape.lineTo(x, y + sh);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d - b * 2, bevelEnabled: b > 0, bevelSegments: 2, steps: 1, bevelSize: b, bevelThickness: b, curveSegments: 2 });
      geo.translate(0, 0, -d / 2 + b);
      geo.computeVertexNormals();
      return geo;
    });
  }

  box(parent: THREE.Object3D, w: number, h: number, d: number, finish: Finish, x = 0, y = 0, z = 0, bevel = 0.035): THREE.Mesh {
    const mesh = new THREE.Mesh(this.roundedGeometry(w, h, d, bevel), this.material(finish));
    mesh.position.set(x, y, z);
    mesh.castShadow = finish !== 'glass' && finish !== 'cyan';
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  cylinder(parent: THREE.Object3D, top: number, bottom: number, height: number, finish: Finish, x = 0, y = 0, z = 0, segments = 20): THREE.Mesh {
    const key = `cylinder:${top}:${bottom}:${height}:${segments}`;
    const mesh = new THREE.Mesh(this.geometry(key, () => new THREE.CylinderGeometry(top, bottom, height, segments)), this.material(finish));
    mesh.position.set(x, y, z);
    mesh.castShadow = finish !== 'cyan' && finish !== 'glass';
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  sphere(parent: THREE.Object3D, radius: number, finish: Finish, x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(`sphere:${radius}`, () => new THREE.SphereGeometry(radius, 16, 12)), this.material(finish));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  ring(parent: THREE.Object3D, radius: number, thickness: number, finish: Finish, x = 0, y = 0, z = 0, horizontal = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(`ring:${radius}:${thickness}`, () => new THREE.TorusGeometry(radius, thickness, 8, 48)), this.material(finish));
    mesh.position.set(x, y, z);
    if (horizontal) mesh.rotation.x = -Math.PI / 2;
    parent.add(mesh);
    return mesh;
  }

  tube(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, finish: Finish): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points);
    const key = `tube:${points.map(p => p.toArray().join(',')).join(';')}:${radius}`;
    const mesh = new THREE.Mesh(this.geometry(key, () => new THREE.TubeGeometry(curve, 16, radius, 6, false)), this.material(finish));
    parent.add(mesh);
    return mesh;
  }

  label(parent: THREE.Object3D, text: string, w: number, h: number, x: number, y: number, z: number, color = '#cfdfd6'): THREE.Mesh {
    const canvas = document.createElement('canvas');
    const compact = text.length < 8;
    canvas.width = compact ? Math.max(128, text.length * 110) : 1024;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.textAlign = compact ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    let size = compact ? 128 : 64;
    ctx.font = `500 ${size}px "Segoe UI", sans-serif`;
    while (ctx.measureText(text).width > canvas.width - 24 && size > 16) ctx.font = `500 ${size -= 2}px "Segoe UI", sans-serif`;
    ctx.fillText(text, compact ? canvas.width / 2 : 20, 90);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.materials.set(`label:${this.materials.size}`, material);
    const mesh = new THREE.Mesh(this.geometry(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h)), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  dispose(): void {
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.geometries.clear();
    this.materials.clear();
  }
}

export interface RobotRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  hips: THREE.Group[];
  knees: THREE.Group[];
  shoulders: THREE.Group[];
  elbows: THREE.Group[];
  eyes: THREE.Mesh[];
}

export function makeRobot(assets: StudioAssets): RobotRig {
  const root = new THREE.Group();
  root.name = 'NOEMA ceramic learning robot';
  const body = new THREE.Group();
  root.add(body);
  assets.box(body, 0.34, 0.15, 0.23, 'ceramic', 0, 0.49, 0);
  assets.cylinder(body, 0.115, 0.115, 0.11, 'joint', 0, 0.59, 0);
  assets.box(body, 0.4, 0.39, 0.25, 'ceramicLight', 0, 0.83, 0);
  assets.box(body, 0.29, 0.22, 0.035, 'navy', 0, 0.83, 0.143, 0.016);
  assets.ring(body, 0.051, 0.009, 'copper', 0, 0.86, 0.167);
  assets.sphere(body, 0.027, 'cyan', 0, 0.86, 0.169);
  assets.box(body, 0.13, 0.018, 0.015, 'cyanDim', 0, 0.75, 0.166, 0.005);
  assets.box(body, 0.22, 0.27, 0.07, 'joint', 0, 0.84, -0.165);
  assets.box(body, 0.15, 0.18, 0.035, 'copper', 0, 0.84, -0.216, 0.014);
  for (let i = 0; i < 3; i++) assets.box(body, 0.12, 0.012, 0.01, 'joint', 0, 0.8 + i * 0.04, -0.238, 0.003);
  assets.cylinder(body, 0.08, 0.1, 0.09, 'joint', 0, 1.06, 0);
  assets.ring(body, 0.095, 0.014, 'copper', 0, 1.035, 0, true);

  const head = new THREE.Group();
  head.position.y = 1.2;
  body.add(head);
  assets.box(head, 0.37, 0.28, 0.31, 'ceramicLight', 0, 0, 0, 0.065);
  assets.box(head, 0.305, 0.145, 0.04, 'joint', 0, -0.005, 0.155, 0.035);
  assets.box(head, 0.25, 0.08, 0.012, 'cyanDim', 0, -0.007, 0.179, 0.02);
  const eyes = [-0.065, 0.065].map(x => assets.box(head, 0.041, 0.038, 0.014, 'cyan', x, 0.002, 0.19, 0.01));
  assets.box(head, 0.052, 0.01, 0.01, 'cyan', 0, -0.041, 0.189, 0.003);
  assets.box(head, 0.23, 0.018, 0.13, 'ceramic', 0, 0.145, -0.015, 0.008);
  for (const side of [-1, 1]) {
    const ear = assets.cylinder(head, 0.07, 0.07, 0.045, 'copper', side * 0.195, 0, 0, 16);
    ear.rotation.z = Math.PI / 2;
    const inset = assets.cylinder(head, 0.045, 0.045, 0.048, 'joint', side * 0.199, 0, 0, 16);
    inset.rotation.z = Math.PI / 2;
  }
  assets.cylinder(head, 0.008, 0.009, 0.13, 'copper', 0.115, 0.204, -0.05, 8);
  assets.sphere(head, 0.022, 'cyan', 0.115, 0.273, -0.05);

  const hips: THREE.Group[] = [], knees: THREE.Group[] = [], shoulders: THREE.Group[] = [], elbows: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.115, 0.46, 0);
    body.add(hip);
    hips.push(hip);
    assets.sphere(hip, 0.068, 'joint');
    assets.box(hip, 0.116, 0.18, 0.13, 'ceramic', 0, -0.12, 0, 0.025);
    assets.box(hip, 0.012, 0.1, 0.03, 'copper', side * 0.06, -0.12, 0.025, 0.005);
    const knee = new THREE.Group();
    knee.position.y = -0.22;
    hip.add(knee);
    knees.push(knee);
    assets.sphere(knee, 0.052, 'joint');
    assets.box(knee, 0.11, 0.15, 0.12, 'ceramicLight', 0, -0.095, 0.006, 0.023);
    assets.box(knee, 0.143, 0.075, 0.23, 'navy', 0, -0.19, 0.041, 0.02);
    assets.box(knee, 0.14, 0.05, 0.19, 'ceramic', 0, -0.17, 0.05, 0.02);
    assets.box(knee, 0.07, 0.008, 0.015, 'cyanDim', 0, -0.16, 0.15, 0.003);

    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.254, 0.96, 0);
    body.add(shoulder);
    shoulders.push(shoulder);
    assets.sphere(shoulder, 0.078, 'joint');
    assets.box(shoulder, 0.16, 0.12, 0.19, 'ceramic', side * 0.015, 0.015, 0, 0.03);
    assets.box(shoulder, 0.103, 0.19, 0.12, 'ceramicLight', 0, -0.145, 0, 0.025);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.25, 0);
    shoulder.add(elbow);
    elbows.push(elbow);
    assets.sphere(elbow, 0.046, 'joint');
    assets.box(elbow, 0.108, 0.16, 0.13, 'ceramic', 0, -0.105, 0.015, 0.025);
    assets.box(elbow, 0.045, 0.045, 0.013, 'copper', 0, -0.09, 0.085, 0.01);
    assets.sphere(elbow, 0.047, 'joint', 0, -0.205, 0.017);
    for (const finger of [-1, 1]) assets.box(elbow, 0.024, 0.067, 0.05, 'ceramicLight', finger * 0.029, -0.245, 0.025, 0.008);
  }
  return { root, body, head, hips, knees, shoulders, elbows, eyes };
}

export function makeCrate(assets: StudioAssets, kind: 'amber' | 'cyan'): THREE.Group {
  const group = new THREE.Group();
  assets.box(group, 0.53, 0.48, 0.53, 'navy', 0, 0.25, 0, 0.045);
  assets.box(group, 0.455, 0.37, 0.548, kind, 0, 0.255, 0, 0.025);
  assets.box(group, 0.55, 0.37, 0.455, kind, 0, 0.255, 0, 0.025);
  assets.box(group, 0.45, 0.045, 0.45, 'ceramic', 0, 0.496, 0, 0.014);
  assets.box(group, 0.37, 0.008, 0.37, 'joint', 0, 0.522, 0, 0.008);
  assets.ring(group, 0.105, 0.012, kind, 0, 0.532, 0, true);
  if (kind === 'cyan') {
    const emblem = assets.box(group, 0.075, 0.012, 0.075, 'white', 0, 0.54, 0, 0.008);
    emblem.rotation.y = Math.PI / 4;
  } else assets.cylinder(group, 0.026, 0.026, 0.012, 'white', 0, 0.54, 0, 16);
  for (const x of [-0.235, 0.235]) for (const z of [-0.235, 0.235]) {
    assets.box(group, 0.07, 0.46, 0.07, 'copper', x, 0.25, z, 0.013);
    assets.box(group, 0.09, 0.06, 0.09, 'ceramic', x, 0.466, z, 0.012);
  }
  for (const z of [-0.287, 0.287]) {
    assets.box(group, 0.19, 0.07, 0.025, 'joint', 0, 0.32, z, 0.012);
    assets.box(group, 0.11, 0.018, 0.014, 'white', 0, 0.17, z, 0.005);
    if (kind === 'cyan') assets.box(group, 0.11, 0.018, 0.014, 'white', 0, 0.13, z, 0.005);
  }
  return group;
}

export function makePlant(assets: StudioAssets, x: number, z: number, scale = 1): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  assets.cylinder(group, 0.24, 0.18, 0.34, 'ceramic', 0, 0.17, 0);
  assets.ring(group, 0.235, 0.025, 'copper', 0, 0.335, 0, true);
  assets.cylinder(group, 0.2, 0.2, 0.018, 'soil', 0, 0.335, 0);
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.399;
    const leaf = assets.sphere(group, 0.16, i % 3 ? 'leaf' : 'leafLight', Math.cos(angle) * 0.11, 0.55 + (i % 3) * 0.11, Math.sin(angle) * 0.11);
    leaf.scale.set(0.43, 1.8 + (i % 2) * 0.6, 0.55);
    leaf.rotation.set(Math.sin(angle) * 0.45, angle, Math.cos(angle) * 0.5);
  }
  return group;
}
