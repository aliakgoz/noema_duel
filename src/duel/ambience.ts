import * as THREE from 'three';
import type { AtmosphereSnapshot, WeatherMode } from '../render/weather';
import { sampleWeatherTargets } from '../render/weatherCycle';

export type DuelWeather = WeatherMode;
export interface DuelAmbience {
  update(dt: number, elapsed: number, weather?: DuelWeather): void;
  getSnapshot(): AtmosphereSnapshot;
  dispose(): void;
}

type Branch = { root: THREE.Group; angle: number; phase: number };
type Tree = { root: THREE.Group; branches: Branch[]; phase: number };
type Leaf = { branch: THREE.Group; position: THREE.Vector3; scale: THREE.Vector3; rotation: THREE.Euler; phase: number };
const fract = (value: number) => value - Math.floor(value);

/** A separate cosmetic clock never consumes the match's random numbers. */
export function createDuelAmbience(scene: THREE.Scene, options: { mobile: boolean }): DuelAmbience {
  const root = new THREE.Group(); root.name = 'NOEMA Duel living garden and distant city'; scene.add(root);
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.push(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.push(value); return value; };
  let seed = 0x6e6f656d;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const dummy = new THREE.Object3D(), matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler();
  const textures: THREE.Texture[] = [];
  const trees: Tree[] = [], leaves: Leaf[] = [];
  const bark = material(new THREE.MeshStandardMaterial({ color: '#786353', roughness: .96 }));
  const trunkGeometry = geometry(new THREE.CylinderGeometry(.12, .24, 3.45, 7));
  const branchGeometry = geometry(new THREE.CylinderGeometry(.025, .1, 1.75, 6));
  // Pointed, slightly folded leaf silhouettes replace the former spherical shrubs.
  const leafGeometry = geometry(new THREE.BufferGeometry());
  leafGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -.65, -.32, 0, -.08, 0, .09, 0, .32, 0, -.08, 0, 0, .65], 3));
  leafGeometry.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]); leafGeometry.computeVertexNormals();
  const foliageMaterial = material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .88, side: THREE.DoubleSide }));
  const positions = options.mobile
    ? [[-17.6, -8], [17.6, -8], [-17.6, 6], [17.6, 6], [-14, -22], [14, -22], [-5, -24], [6, -25]]
    : [[-19.5, -9], [19.5, -9], [-20, 1], [20, 1], [-21, 11], [21, 11], [-15, -22], [15, -22], [-6, -25], [6, -25], [-25, -24], [25, -24]];
  const leafCount = options.mobile ? 15 : 22;
  for (const [x, z] of positions) {
    const treeRoot = new THREE.Group(); treeRoot.position.set(x, -.48, z); treeRoot.rotation.y = random() * Math.PI;
    const size = z < -20 ? .82 + random() * .3 : 1 + random() * .18; treeRoot.scale.setScalar(size); root.add(treeRoot);
    const trunk = new THREE.Mesh(trunkGeometry, bark); trunk.position.y = 1.72; treeRoot.add(trunk);
    const tree: Tree = { root: treeRoot, branches: [], phase: random() * 8 }; trees.push(tree);
    for (let b = 0; b < 5; b++) {
      const angle = b * 2.399 + random() * .28, branch = new THREE.Group(); branch.position.set(Math.cos(angle) * .12, 2.05 + b * .28, Math.sin(angle) * .12);
      branch.rotation.set(Math.sin(angle) * .7, angle, Math.cos(angle) * .7); treeRoot.add(branch);
      const stem = new THREE.Mesh(branchGeometry, bark); stem.position.y = .7; branch.add(stem);
      tree.branches.push({ root: branch, angle, phase: random() * 6 });
      for (let n = 0; n < leafCount; n++) {
        const around = n * 2.399, radius = .22 + random() * 1.05;
        leaves.push({ branch, position: new THREE.Vector3(Math.cos(around) * radius, .4 + random() * 1.55, Math.sin(around) * radius * .8), scale: new THREE.Vector3(.65 + random() * .55, 1, .65 + random() * .55), rotation: new THREE.Euler((random() - .5) * .9, around, (random() - .5) * .8), phase: random() * 9 });
      }
    }
  }
  const foliage = new THREE.InstancedMesh(leafGeometry, foliageMaterial, leaves.length); foliage.name = 'Wind animated individual leaves';
  foliage.instanceMatrix.setUsage(THREE.DynamicDrawUsage); foliage.frustumCulled = false;
  const leafA = new THREE.Color('#174c45'), leafB = new THREE.Color('#5c853f'), color = new THREE.Color();
  leaves.forEach((_, i) => foliage.setColorAt(i, color.copy(leafA).lerp(leafB, random()))); root.add(foliage);
  const fallingCount = options.mobile ? 22 : 40;
  const falling = new THREE.InstancedMesh(leafGeometry, material(new THREE.MeshStandardMaterial({ color: '#c4a76c', roughness: .9, side: THREE.DoubleSide })), fallingCount);
  falling.instanceMatrix.setUsage(THREE.DynamicDrawUsage); falling.frustumCulled = false; root.add(falling);
  const fallingSeeds = Float32Array.from({ length: fallingCount * 4 }, () => random());

  const cloths: { geometry: THREE.PlaneGeometry; rest: Float32Array; phase: number }[] = [];
  const cameras: { head: THREE.Group; phase: number; baseAngle: number }[] = [];
  const poleGeometry = geometry(new THREE.CylinderGeometry(.045, .075, 5.7, 7));
  const poleMaterial = material(new THREE.MeshStandardMaterial({ color: '#8e9da9', metalness: .72, roughness: .38 }));
  const cameraCase = material(new THREE.MeshStandardMaterial({ color: '#c7d0dd', metalness: .35, roughness: .55 }));
  const cameraDark = material(new THREE.MeshStandardMaterial({ color: '#172c44', roughness: .5, metalness: .4 }));
  const cameraStatus = material(new THREE.MeshBasicMaterial({ color: '#ff746c', toneMapped: false }));
  const unitBox = geometry(new THREE.BoxGeometry(1, 1, 1));
  const addBox = (parent: THREE.Group, size: [number, number, number], position: [number, number, number], finish: THREE.Material) => {
    const mesh = new THREE.Mesh(unitBox, finish); mesh.scale.set(...size); mesh.position.set(...position); parent.add(mesh); return mesh;
  };
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1, z = i < 2 ? -15.5 : 14.5;
    const pole = new THREE.Group(); pole.position.set(side * (options.mobile ? 16.9 : 18.3), -.5, z); root.add(pole);
    const mast = new THREE.Mesh(poleGeometry, poleMaterial); mast.position.y = 2.85; pole.add(mast);
    addBox(pole, [1.6, .055, .055], [side * .76, 5.42, 0], poleMaterial);
    const bannerCanvas = document.createElement('canvas'); bannerCanvas.width = 256; bannerCanvas.height = 512;
    const bannerContext = bannerCanvas.getContext('2d')!;
    bannerContext.fillStyle = side < 0 ? '#375cd0' : '#9461c5'; bannerContext.fillRect(0, 0, 256, 512);
    bannerContext.strokeStyle = '#e6d9b8'; bannerContext.lineWidth = 5; bannerContext.strokeRect(17, 17, 222, 478);
    bannerContext.fillStyle = '#edf0ff'; bannerContext.font = '600 98px sans-serif'; bannerContext.textAlign = 'center'; bannerContext.fillText('N', 128, 217);
    bannerContext.font = '500 22px sans-serif'; bannerContext.fillText('NOEMA', 128, 291); bannerContext.font = '400 14px sans-serif'; bannerContext.fillText('DUEL CAMPUS', 128, 320);
    bannerContext.fillStyle = '#f3b995'; bannerContext.fillRect(69, 367, 118, 3);
    const texture = new THREE.CanvasTexture(bannerCanvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
    const clothGeometry = geometry(new THREE.PlaneGeometry(1.48, 2.25, 7, 12)); clothGeometry.translate(side * .77, -1.125, 0);
    (clothGeometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const cloth = new THREE.Mesh(clothGeometry, material(new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: .95 })));
    cloth.position.y = 5.35; pole.add(cloth); cloths.push({ geometry: clothGeometry, rest: new Float32Array(clothGeometry.attributes.position.array), phase: i * 1.4 });
    // A small visible observation camera, with a lens and status LED. Its pan
    // is decorative and cannot see or influence the learned policy.
    const head = new THREE.Group(); head.position.set(-side * .4, 3.65, 0); pole.add(head);
    addBox(pole, [.5, .08, .1], [-side * .2, 3.51, 0], poleMaterial);
    addBox(head, [.55, .3, .76], [0, 0, 0], cameraCase);
    addBox(head, [.39, .23, .04], [0, 0, .4], cameraDark);
    const lens = new THREE.Mesh(geometry(new THREE.CylinderGeometry(.08, .08, .09, 10)), material(new THREE.MeshStandardMaterial({ color: '#476c9d', emissive: '#154077', emissiveIntensity: .55, metalness: .7, roughness: .2 })));
    lens.rotation.x = Math.PI / 2; lens.position.set(0, 0, .44); head.add(lens);
    addBox(head, [.045, .035, .015], [.17, .075, .43], cameraStatus);
    const baseAngle = Math.atan2(-side * 18.3, -z); head.rotation.y = baseAngle; head.rotation.x = .18;
    cameras.push({ head, phase: i * 2, baseAngle });
  }

  // A real valley, streets and inhabited buildings anchor the campus in a
  // continuous world. Every architectural finish is instanced across the city;
  // glazing on all four sides lets a diagonal camera reveal its actual volume.
  const city = new THREE.Group(); city.name = 'Distant valley city with layered architecture'; root.add(city);
  const cityBatches = new Map<string, { transforms: THREE.Matrix4[]; colors: THREE.Color[]; material: THREE.Material }>();
  const cityFinishes: Record<string, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial> = {
    stone: material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .83, metalness: .06 })),
    glass: material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .27, metalness: .56, emissive: '#243b53', emissiveIntensity: .22 })),
    trim: material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .48, metalness: .38 })),
    roof: material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .92, metalness: .08 })),
    road: material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .98 })),
    light: material(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })),
  };
  const cityBox = (finish: string, x: number, y: number, z: number, w: number, h: number, d: number, tint: string, angle = 0, pitch = 0) => {
    let batch = cityBatches.get(finish);
    if (!batch) { batch = { transforms: [], colors: [], material: cityFinishes[finish] }; cityBatches.set(finish, batch); }
    dummy.position.set(x, y, z); dummy.rotation.set(pitch, angle, 0); dummy.scale.set(w, h, d); dummy.updateMatrix();
    batch.transforms.push(dummy.matrix.clone()); batch.colors.push(new THREE.Color(tint));
  };
  const valleyHeight = (x: number, z: number) => -9.5 - (-z - 24) * .47 + Math.sin(x * .045) * .85 + Math.cos(z * .055) * .4;
  const terrainGeometry = geometry(new THREE.PlaneGeometry(180, 130, options.mobile ? 20 : 30, 22)); terrainGeometry.rotateX(-Math.PI / 2); terrainGeometry.translate(0, 0, -87);
  const terrainPositions = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
  const terrainColors = new Float32Array(terrainPositions.count * 3);
  const earthA = new THREE.Color('#354c50'), earthB = new THREE.Color('#697e82');
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i), z = terrainPositions.getZ(i);
    const hills = Math.pow(Math.max(0, Math.abs(x) - 47) / 43, 1.5) * (6 + Math.sin(z * .13 + x * .06) * 3);
    terrainPositions.setY(i, valleyHeight(x, z) - .5 + hills);
    color.copy(earthA).lerp(earthB, Math.min(1, (-z - 22) / 135 + hills * .024));
    terrainColors.set([color.r, color.g, color.b], i * 3);
  }
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3)); terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))); terrain.name = 'Sloping valley and distant hills'; city.add(terrain);

  const windowGeometry = geometry(new THREE.PlaneGeometry(1, 1));
  const windowMaterial = material(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .83, toneMapped: false }));
  const windowTransforms: THREE.Matrix4[] = [], windowColors: THREE.Color[] = [];
  const warmWindow = new THREE.Color('#e8bd85'), coolWindow = new THREE.Color('#85a9bd');
  const cityWindow = (x: number, y: number, z: number, w: number, h: number, angle: number, layer: number) => {
    dummy.position.set(x, y, z); dummy.rotation.set(0, angle, 0); dummy.scale.set(w, h, 1); dummy.updateMatrix(); windowTransforms.push(dummy.matrix.clone());
    windowColors.push(warmWindow.clone().lerp(coolWindow, random() > .76 ? .92 : random() * .24).multiplyScalar(1 - layer * .12));
  };
  const facade = (x: number, base: number, z: number, width: number, depth: number, height: number, layer: number, style: number) => {
    const rows = Math.max(2, Math.floor(height / .82)), cols = Math.max(2, Math.floor(width / .65)), sideCols = Math.max(2, Math.floor(depth / .75));
    for (let row = 0; row < rows; row++) {
      const y = base + .28 + (row + .5) * (height - .45) / rows;
      // Continuous dark floor bands carry the office scale even when its
      // illuminated windows are sparse; every facade has different occupancy.
      if (style === 0 || style === 2) {
        cityBox('trim', x, y - .3, z, width + .055, .065, depth + .055, '#536676');
      }
      for (let col = 0; col < cols; col++) {
        const px = x - width / 2 + (col + .5) * width / cols;
        if (random() > .65) cityWindow(px, y, z + depth / 2 + .013, width / cols * .61, .38, 0, layer);
        if (random() > .76) cityWindow(px, y, z - depth / 2 - .013, width / cols * .61, .38, Math.PI, layer);
      }
      for (let col = 0; col < sideCols; col++) {
        const pz = z - depth / 2 + (col + .5) * depth / sideCols;
        if (random() > .72) cityWindow(x - width / 2 - .013, y, pz, depth / sideCols * .61, .38, -Math.PI / 2, layer);
        if (random() > .72) cityWindow(x + width / 2 + .013, y, pz, depth / sideCols * .61, .38, Math.PI / 2, layer);
      }
    }
    if (style === 0 || style === 3) for (const side of [-1, 1]) {
      cityBox('trim', x + side * (width / 2 - .08), base + height / 2, z + depth / 2 + .035, .1, height + .08, .1, '#6d7b84');
      cityBox('trim', x + side * (width / 2 + .035), base + height / 2, z, .09, height + .08, depth * .9, '#586a79');
    }
  };
  const roadRows = [-30, -45, -61, -79];
  for (let layer = 0; layer < 4; layer++) {
    const z = roadRows[layer], roadY = valleyHeight(0, z) + .025;
    cityBox('road', 0, roadY, z, 124, .16, 2.3, layer < 2 ? '#293b47' : '#455b68');
    for (let lane = -56; lane <= 56; lane += 3.5) cityBox('trim', lane, roadY + .095, z, 1.1, .018, .035, '#9a9c96');
    for (let x = -54; x <= 54; x += 8) {
      const y = roadY + 1.8;
      cityBox('trim', x, y - .8, z - 1.35, .045, 1.7, .045, '#657683');
      cityBox('trim', x + .2, y + .04, z - 1.35, .45, .045, .045, '#657683');
      cityBox('light', x + .38, y, z - 1.35, .18, .055, .12, layer < 2 ? '#eac89c' : '#a3b6be');
    }
    // Cross streets descend between the district terraces rather than ending
    // abruptly at each row. Their inclination follows the valley floor.
    if (layer < 3) for (const x of [-36, -12, 12, 36]) {
      const next = roadRows[layer + 1], mid = (z + next) / 2;
      cityBox('road', x, valleyHeight(x, mid) + .04, mid, 1.8, .12, Math.abs(next - z) * 1.105, '#344754', 0, -Math.atan(.47));
    }
    const count = options.mobile ? 8 : 11;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * (options.mobile ? 12.2 : 9.7) + (layer % 2 ? 3 : -1), bz = z - 7.6 - random() * 1.8;
      const base = valleyHeight(x, bz) - .05;
      const style = (i + layer * 3) % 4;
      const w = 3.8 + random() * 2.5, d = 3.8 + random() * 2.8;
      const h = (layer === 0 ? 6.2 : layer === 1 ? 8.5 : 5.8) + random() * (layer === 1 ? 8 : 6);
      const tint = layer < 2 ? (style % 2 ? '#697986' : '#78838a') : (style % 2 ? '#6c8192' : '#81919e');
      // Low masonry podiums, occupied glass towers and recesses between tiers
      // produce a readable roof line instead of a wall of equal-depth blocks.
      cityBox('stone', x, base + .64, bz, w + 1.1, 1.28, d + 1, tint);
      cityBox('roof', x, base + 1.32, bz, w + 1.18, .16, d + 1.08, '#546572');
      const towerBase = base + 1.4;
      cityBox(style === 1 ? 'stone' : 'glass', x, towerBase + h / 2, bz, w, h, d, style === 1 ? tint : layer < 2 ? '#3e5a70' : '#607c91');
      facade(x, towerBase, bz, w, d, h, layer, style);
      cityBox('roof', x, towerBase + h + .085, bz, w + .14, .17, d + .14, '#78858b');
      if (style === 0 || style === 2) {
        const topH = 1.4 + random() * 2.7, topW = w * .63, topD = d * .72, topBase = towerBase + h + .17;
        cityBox('glass', x + w * .08, topBase + topH / 2, bz - d * .06, topW, topH, topD, '#526e82');
        facade(x + w * .08, topBase, bz - d * .06, topW, topD, topH, layer, 1);
        cityBox('roof', x + w * .08, topBase + topH + .06, bz - d * .06, topW + .13, .13, topD + .13, '#829098');
        if (style === 0) {
          cityBox('trim', x + w * .08, topBase + topH + .95, bz - d * .06, .055, 1.7, .055, '#84929e');
          cityBox('light', x + w * .08, topBase + topH + 1.83, bz - d * .06, .09, .09, .09, '#d59387');
        }
      } else {
        cityBox('trim', x - w * .18, towerBase + h + .36, bz - d * .1, w * .37, .55, d * .36, '#637681');
        cityBox('roof', x - w * .18, towerBase + h + .65, bz - d * .1, w * .4, .055, d * .39, '#879298');
        if (style === 3) cityBox('trim', x + w * .24, towerBase + h + .55, bz + d * .2, w * .18, .9, d * .18, '#9b988d');
      }
      // Horizontal lobby lights are deliberately dimmer and smaller than the
      // arena LEDs so the background keeps a sense of scale and distance.
      cityBox('light', x, base + .76, bz + (d + 1) / 2 + .015, w * .7, .08, .022, layer < 2 ? '#bfae92' : '#899eac');
    }
  }
  for (const [finish, batch] of cityBatches) {
    const mesh = new THREE.InstancedMesh(unitBox, batch.material, batch.transforms.length); mesh.name = `City ${finish} architectural details`;
    batch.transforms.forEach((transform, i) => { mesh.setMatrixAt(i, transform); mesh.setColorAt(i, batch.colors[i]); }); city.add(mesh);
  }
  const cityWindows = new THREE.InstancedMesh(windowGeometry, windowMaterial, windowTransforms.length); cityWindows.name = 'Occupied windows on four city facades';
  windowTransforms.forEach((transform, i) => { cityWindows.setMatrixAt(i, transform); cityWindows.setColorAt(i, windowColors[i]); }); city.add(cityWindows);
  const trafficCount = options.mobile ? 18 : 30;
  const traffic = new THREE.InstancedMesh(unitBox, material(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })), trafficCount);
  traffic.name = 'Distant slow moving city traffic'; traffic.instanceMatrix.setUsage(THREE.DynamicDrawUsage); traffic.frustumCulled = false; city.add(traffic);
  const trafficSeeds = Float32Array.from({ length: trafficCount * 3 }, () => random());
  for (let i = 0; i < trafficCount; i++) traffic.setColorAt(i, color.set(i % 2 ? '#c19d86' : '#bec9cc').multiplyScalar(.8));
  city.userData = { cosmetic: true, districts: 4, buildings: options.mobile ? 32 : 44, architecturalBatches: cityBatches.size, windows: windowTransforms.length };

  const rainCount = options.mobile ? 240 : 520;
  const rainPositions = new THREE.BufferAttribute(new Float32Array(rainCount * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const rainGeometry = geometry(new THREE.BufferGeometry()); rainGeometry.setAttribute('position', rainPositions);
  const rainMaterial = material(new THREE.LineBasicMaterial({ color: '#cee3ff', transparent: true, opacity: 0, depthWrite: false }));
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial); rain.frustumCulled = false; root.add(rain);
  const rainSeeds = Float32Array.from({ length: rainCount * 4 }, () => random());

  const clouds = new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(1, 1)), material(new THREE.MeshBasicMaterial({ color: '#a7b5d8', transparent: true, opacity: .12, depthWrite: false })), options.mobile ? 8 : 14);
  clouds.frustumCulled = false; root.add(clouds);
  const cloudSeeds = Float32Array.from({ length: clouds.count * 3 }, () => random());
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const skyTexture = new THREE.CanvasTexture(canvas); skyTexture.colorSpace = THREE.SRGBColorSpace;
  const previousBackground = scene.background; scene.background = skyTexture;
  const snapshot: AtmosphereSnapshot = { phase: 'cloudy', rain: 0, wind: .4, cloudCover: .35, sunlight: .7, wetness: 0, mode: 'auto' };
  let cloud = .35, rainAmount = 0, lastSky = -1, disposed = false;
  const clearColors = ['#1d3556', '#536b87', '#829aaf', '#b9c4cd'];
  const rainColors = ['#273e56', '#526a80', '#8296a8', '#b0bbc4'];
  const skyColor = new THREE.Color(), otherColor = new THREE.Color();

  const update = (dt: number, elapsed: number, weather: DuelWeather = 'auto') => {
    if (disposed) return;
    const blend = 1 - Math.exp(-Math.max(0, dt) * .9);
    const targets = sampleWeatherTargets(elapsed, 120, weather);
    cloud += (targets.cloudCover - cloud) * blend;
    rainAmount += (targets.rain - rainAmount) * blend;
    const wind = .45 + .35 * cloud + Math.sin(elapsed * .11) * .13;
    snapshot.mode = weather; snapshot.rain = rainAmount; snapshot.cloudCover = cloud; snapshot.wind = wind;
    snapshot.sunlight += (targets.sunlight - snapshot.sunlight) * blend;
    snapshot.wetness += (rainAmount - snapshot.wetness) * (1 - Math.exp(-dt * (rainAmount > snapshot.wetness ? .35 : .04)));
    snapshot.phase = rainAmount > .12 ? 'rain' : cloud > .3 ? 'cloudy' : 'clear';
    for (let i = 0; i < trafficCount; i++) {
      const s = i * 3, direction = i % 2 ? 1 : -1, lane = i % roadRows.length;
      const x = (fract(trafficSeeds[s] + elapsed * direction * (.005 + trafficSeeds[s + 1] * .003)) - .5) * 118;
      const z = roadRows[lane] + direction * .47;
      dummy.position.set(x, valleyHeight(0, roadRows[lane]) + .24, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(.52 + trafficSeeds[s + 2] * .2, .14, .25); dummy.updateMatrix(); traffic.setMatrixAt(i, dummy.matrix);
    }
    traffic.instanceMatrix.needsUpdate = true;
    for (const cloth of cloths) {
      const points = cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < points.count; i++) {
        const x = cloth.rest[i * 3], y = cloth.rest[i * 3 + 1], free = Math.min(1, -y / 2.25);
        points.setXYZ(i, x + Math.sin(elapsed * 2.1 + y * 2 + cloth.phase) * .04 * free * wind, y, (Math.sin(elapsed * 3.1 + x * 2.8 + y * 2 + cloth.phase) * .16 + Math.sin(elapsed * 1.7 + y) * .1) * free * wind);
      }
      points.needsUpdate = true;
    }
    for (const camera of cameras) camera.head.rotation.y = camera.baseAngle + Math.sin(elapsed * .18 + camera.phase) * .42;
    for (const tree of trees) {
      tree.root.rotation.z = Math.sin(elapsed * 1.12 + tree.phase) * .022 * wind;
      tree.root.rotation.x = Math.cos(elapsed * .79 + tree.phase) * .015 * wind;
      for (const branch of tree.branches) {
        branch.root.rotation.z = Math.cos(branch.angle) * .7 + Math.sin(elapsed * 2.1 + branch.phase) * .09 * wind;
        branch.root.rotation.x = Math.sin(branch.angle) * .7 + Math.cos(elapsed * 1.65 + branch.phase) * .055 * wind;
      }
      tree.root.updateWorldMatrix(true, true);
    }
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i]; euler.set(leaf.rotation.x + Math.sin(elapsed * 4.4 + leaf.phase) * .16 * wind, leaf.rotation.y, leaf.rotation.z + Math.sin(elapsed * 3.3 + leaf.phase) * .12 * wind);
      quaternion.setFromEuler(euler); matrix.compose(leaf.position, quaternion, leaf.scale).premultiply(leaf.branch.matrixWorld); foliage.setMatrixAt(i, matrix);
    }
    foliage.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < fallingCount; i++) {
      const s = i * 4, life = fract(fallingSeeds[s] + elapsed * (.06 + fallingSeeds[s + 1] * .025)), origin = positions[i % positions.length];
      dummy.position.set(origin[0] + Math.sin(life * 10 + fallingSeeds[s + 2] * 6) * .65 + life * wind * 3, .03 + (1 - life) * (3.8 + fallingSeeds[s + 3] * 2), origin[1] + Math.cos(life * 7 + i) * 1.3);
      dummy.rotation.set(elapsed * .7 + i, elapsed * .5 + i, Math.sin(life * 14 + i)); dummy.scale.set(.14, .14, .2); dummy.updateMatrix(); falling.setMatrixAt(i, dummy.matrix);
    }
    falling.instanceMatrix.needsUpdate = true;
    rain.visible = rainAmount > .015; rainMaterial.opacity = .38 * rainAmount;
    if (rain.visible) {
      for (let i = 0; i < rainCount; i++) {
        const s = i * 4, life = fract(rainSeeds[s + 2] + elapsed * (1.15 + rainSeeds[s + 3] * .6));
        const x = (rainSeeds[s] - .5) * 48 + (1 - life) * wind, y = .1 + (1 - life) * 17, z = (rainSeeds[s + 1] - .5) * 44;
        rainPositions.setXYZ(i * 2, x, y, z); rainPositions.setXYZ(i * 2 + 1, x - .08 * wind, y + .34 + rainSeeds[s + 3] * .18, z);
      }
      rainPositions.needsUpdate = true;
    }
    for (let i = 0; i < clouds.count; i++) {
      const s = i * 3; dummy.position.set((cloudSeeds[s] - .5) * 100 + Math.sin(elapsed * .014 + i) * 5, 15 + cloudSeeds[s + 1] * 10, -55 - cloudSeeds[s + 2] * 20);
      dummy.rotation.set(0, 0, 0); dummy.scale.set(8 + cloudSeeds[s] * 9, 1.1 + cloudSeeds[s + 1] * 1.6, 4); dummy.updateMatrix(); clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    (clouds.material as THREE.MeshBasicMaterial).opacity = .11 + cloud * .12;
    windowMaterial.opacity = .88 + cloud * .12;
    if (lastSky < 0 || Math.abs(cloud - lastSky) > .025) {
      const gradient = context.createLinearGradient(0, 0, 0, 512);
      for (let i = 0; i < clearColors.length; i++) gradient.addColorStop(i / 3, skyColor.set(clearColors[i]).lerp(otherColor.set(rainColors[i]), cloud).getStyle());
      context.fillStyle = gradient; context.fillRect(0, 0, 256, 512);
      const sunlight = Math.max(0, 1 - cloud * 1.2);
      const halo = context.createRadialGradient(55, 150, 5, 55, 150, 112);
      halo.addColorStop(0, `rgba(255,224,176,${sunlight * .22})`); halo.addColorStop(1, 'rgba(255,224,176,0)');
      context.fillStyle = halo; context.fillRect(0, 0, 256, 512);
      skyTexture.needsUpdate = true; lastSky = cloud;
      if (scene.fog instanceof THREE.Fog) { scene.fog.color.set('#536788').lerp(otherColor.set('#5c7189'), cloud); scene.fog.near = 55 - cloud * 5; scene.fog.far = 155 - cloud * 30; }
    }
  };
  update(0, 0);
  return { update, getSnapshot: () => ({ ...snapshot }), dispose() {
    if (disposed) return; disposed = true; root.removeFromParent();
    geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); skyTexture.dispose();
    if (scene.background === skyTexture) scene.background = previousBackground;
  } };
}
