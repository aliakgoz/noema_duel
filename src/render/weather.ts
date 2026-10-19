import * as THREE from 'three';
import type { Level } from '../core/types';
import type { StudioAssets } from './objects';
import { sampleWeatherTargets } from './weatherCycle';

export type WeatherMode = 'auto' | 'clear' | 'rain';
export interface AtmosphereSnapshot {
  phase: 'clear' | 'cloudy' | 'rain';
  rain: number;
  wind: number;
  cloudCover: number;
  wetness: number;
  sunlight: number;
  mode: WeatherMode;
}
interface Cloth { geometry: THREE.PlaneGeometry; rest: Float32Array; phase: number }
interface Tree { root: THREE.Group; branches: THREE.Group[]; phase: number }
interface Leaf { branch: THREE.Group; position: THREE.Vector3; scale: THREE.Vector3; rotation: THREE.Euler; phase: number }

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const fract = (value: number): number => value - Math.floor(value);

/** Cosmetic weather has its own seeded clock; it never reads or changes simulation RNG. */
export class GardenAtmosphere {
  readonly root = new THREE.Group();
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private ownedTextures: THREE.Texture[] = [];
  private cloths: Cloth[] = [];
  private trees: Tree[] = [];
  private leaves: Leaf[] = [];
  private leafMesh!: THREE.InstancedMesh;
  private fallingLeaves!: THREE.InstancedMesh;
  private clouds!: THREE.InstancedMesh;
  private cloudMaterial!: THREE.MeshStandardMaterial;
  private rain!: THREE.LineSegments;
  private rainPositions!: THREE.BufferAttribute;
  private rainSeeds!: Float32Array;
  private rainMaterial!: THREE.LineBasicMaterial;
  private ripples!: THREE.InstancedMesh;
  private rippleSeeds!: Float32Array;
  private rippleLife!: THREE.InstancedBufferAttribute;
  private rippleMaterial!: THREE.ShaderMaterial;
  private dummy = new THREE.Object3D();
  private tempMatrix = new THREE.Matrix4();
  private tempQuaternion = new THREE.Quaternion();
  private leafEuler = new THREE.Euler();
  private mode: WeatherMode = 'auto';
  private rng: number;
  private quality: 'high' | 'balanced';
  private reducedMotion: boolean;
  private lastPublish = -2;
  private disposed = false;
  private time = 0;
  private snapshot: AtmosphereSnapshot = { phase: 'cloudy', rain: 0, wind: 0.38, cloudCover: 0.36, wetness: 0, sunlight: 0.7, mode: 'auto' };
  private readonly cycleLength: number;
  private readonly width: number;
  private readonly depth: number;
  private readonly rainCount = 420;
  private readonly rippleCount = 44;
  private readonly fallingCount = 28;
  private readonly leafColorA = new THREE.Color('#4d8e7c');
  private readonly leafColorB = new THREE.Color('#94ac86');
  private readonly clearCloudColor = new THREE.Color('#fff2df');
  private readonly rainCloudColor = new THREE.Color('#87989d');

  constructor(parent: THREE.Group, private readonly assets: StudioAssets, level: Level, options: { quality: 'high' | 'balanced'; reducedMotion: boolean; onChange?: (snapshot: AtmosphereSnapshot) => void }) {
    this.width = level.width;
    this.depth = level.height;
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    this.onChange = options.onChange;
    let seed = level.seed ?? 0x71ac;
    for (let i = 0; i < level.id.length; i++) seed = Math.imul(seed ^ level.id.charCodeAt(i), 16777619);
    this.rng = seed >>> 0 || 1;
    this.cycleLength = 112 + this.rng % 17;
    Object.assign(this.snapshot, sampleWeatherTargets(0, this.cycleLength, this.mode));
    this.root.name = 'NOEMA living garden atmosphere — cosmetic only';
    parent.add(this.root);
    this.makeFlags();
    this.makeTrees();
    this.makeFallingLeaves();
    this.makeClouds();
    this.makeRain(level);
    this.setQuality(options.quality);
    this.update(0, 0);
  }

  private onChange?: (snapshot: AtmosphereSnapshot) => void;
  private random(): number { this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0; return this.rng / 4294967296; }
  private geometry<T extends THREE.BufferGeometry>(value: T): T { this.ownedGeometries.push(value); return value; }
  private material<T extends THREE.Material>(value: T): T { this.ownedMaterials.push(value); return value; }

  private makeFlags(): void {
    for (const side of [-1, 1]) {
      const pole = new THREE.Group();
      pole.position.set(side * (this.width / 2 + 1.21), -0.1, this.depth * 0.035);
      if (side < 0) pole.rotation.y = Math.PI;
      this.root.add(pole);
      this.assets.cylinder(pole, 0.055, 0.11, 0.18, 'navy', 0, 0.1, 0, 16);
      this.assets.cylinder(pole, 0.024, 0.038, 2.95, 'copper', 0, 1.6, 0, 12);
      this.assets.sphere(pole, 0.05, 'cyanDim', 0, 3.1, 0);
      const crossbar = this.assets.cylinder(pole, 0.02, 0.02, 0.89, 'copper', 0.4, 2.91, 0, 12);
      crossbar.rotation.z = Math.PI / 2;
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      if (side < 0) { ctx.translate(384, 0); ctx.scale(-1, 1); }
      ctx.fillStyle = side < 0 ? '#304f50' : '#996f63';
      ctx.fillRect(0, 0, 384, 512);
      ctx.strokeStyle = '#d6bc8a';
      ctx.lineWidth = 7;
      ctx.strokeRect(26, 25, 332, 456);
      ctx.fillStyle = '#d9e2cc';
      ctx.beginPath();
      ctx.moveTo(112, 322); ctx.lineTo(112, 190); ctx.lineTo(145, 190); ctx.lineTo(242, 272); ctx.lineTo(242, 190); ctx.lineTo(275, 190); ctx.lineTo(275, 322); ctx.lineTo(242, 322); ctx.lineTo(145, 240); ctx.lineTo(145, 322); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9ae0c7';
      ctx.beginPath(); ctx.arc(193, 143, 8, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i++) ctx.fillRect(151 + i * 24, 389, 9, 4);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.ownedTextures.push(texture);
      const geometry = this.geometry(new THREE.PlaneGeometry(0.76, 1.16, 10, 16));
      geometry.translate(0.38, -0.58, 0);
      (geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      const cloth = new THREE.Mesh(geometry, this.material(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, color: '#ffffff' })));
      cloth.position.set(0.045, 2.86, 0);
      cloth.castShadow = true;
      cloth.receiveShadow = true;
      pole.add(cloth);
      this.cloths.push({ geometry, rest: new Float32Array(geometry.attributes.position.array), phase: this.random() * 8 });
      for (let i = 0; i < 4; i++) this.assets.ring(pole, 0.024, 0.007, 'copper', 0.075 + i * 0.23, 2.89, 0);
    }
  }

  private makeTrees(): void {
    const bark = this.material(new THREE.MeshStandardMaterial({ color: '#89735b', roughness: 0.96 }));
    const trunkGeometry = this.geometry(new THREE.CylinderGeometry(0.045, 0.09, 1.55, 10));
    const branchGeometry = this.geometry(new THREE.CylinderGeometry(0.015, 0.04, 0.68, 8));
    const leafGeometry = this.geometry(new THREE.IcosahedronGeometry(0.22, 1));
    const leafMaterial = this.material(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.83, metalness: 0.02 }));
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(side * (this.width / 2 + 1.02), 0.2, -this.depth / 2 - 1.08);
      root.rotation.y = side * 0.4;
      this.root.add(root);
      this.assets.cylinder(root, 0.29, 0.23, 0.45, 'ceramic', 0, 0, 0, 20);
      this.assets.ring(root, 0.285, 0.02, 'copper', 0, 0.225, 0, true);
      this.assets.cylinder(root, 0.26, 0.26, 0.02, 'soil', 0, 0.22, 0);
      const trunkRoot = new THREE.Group();
      root.add(trunkRoot);
      const trunk = new THREE.Mesh(trunkGeometry, bark);
      trunk.position.y = 0.98;
      trunk.castShadow = true;
      trunkRoot.add(trunk);
      const branches: THREE.Group[] = [];
      for (let i = 0; i < 4; i++) {
        const angle = i * 2.399 + side;
        const branch = new THREE.Group();
        branch.position.set(Math.cos(angle) * 0.16, 1.23 + i * 0.16, Math.sin(angle) * 0.16);
        branch.rotation.set(Math.sin(angle) * 0.52, angle, Math.cos(angle) * 0.52);
        trunkRoot.add(branch);
        const stem = new THREE.Mesh(branchGeometry, bark);
        stem.position.y = 0.21;
        stem.castShadow = true;
        branch.add(stem);
        branches.push(branch);
        for (let j = 0; j < 10; j++) {
          const around = j * 2.399 + angle;
          const radius = 0.16 + this.random() * 0.25;
          this.leaves.push({ branch, position: new THREE.Vector3(Math.cos(around) * radius, 0.29 + this.random() * 0.46, Math.sin(around) * radius), scale: new THREE.Vector3(0.8 + this.random() * 0.65, 0.32 + this.random() * 0.26, 1.1 + this.random() * 0.7), rotation: new THREE.Euler(this.random() * 0.8, around, this.random() * 0.7), phase: this.random() * Math.PI * 2 });
        }
      }
      this.trees.push({ root: trunkRoot, branches, phase: this.random() * 9 });
    }
    this.leafMesh = new THREE.InstancedMesh(leafGeometry, leafMaterial, this.leaves.length);
    this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leafMesh.castShadow = true;
    this.leafMesh.receiveShadow = true;
    this.leafMesh.frustumCulled = false;
    this.leaves.forEach((_, i) => this.leafMesh.setColorAt(i, this.leafColorA.clone().lerp(this.leafColorB, this.random())));
    this.root.add(this.leafMesh);
  }

  private makeFallingLeaves(): void {
    this.fallingLeaves = new THREE.InstancedMesh(this.geometry(new THREE.IcosahedronGeometry(0.055, 0)), this.material(new THREE.MeshStandardMaterial({ color: '#c5ac6e', roughness: 0.85, side: THREE.DoubleSide })), this.fallingCount);
    this.fallingLeaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fallingLeaves.frustumCulled = false;
    this.root.add(this.fallingLeaves);
  }

  private makeClouds(): void {
    this.cloudMaterial = this.material(new THREE.MeshStandardMaterial({ color: '#eadcce', transparent: true, opacity: 0.3, roughness: 1, depthWrite: false }));
    this.clouds = new THREE.InstancedMesh(this.geometry(new THREE.IcosahedronGeometry(1, 2)), this.cloudMaterial, 18);
    this.clouds.frustumCulled = false;
    // Decorative translucent clouds use a separate soft solar-transmission
    // effect, never opaque geometry in the arena's shadow map.
    this.clouds.castShadow = false;
    this.clouds.receiveShadow = false;
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.clouds);
  }

  private makeRain(level: Level): void {
    const positions = new Float32Array(this.rainCount * 6);
    this.rainSeeds = new Float32Array(this.rainCount * 4);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainSeeds[i * 4] = (this.random() - 0.5) * (this.width + 3.1);
      this.rainSeeds[i * 4 + 1] = (this.random() - 0.5) * (this.depth + 2.8);
      this.rainSeeds[i * 4 + 2] = this.random();
      this.rainSeeds[i * 4 + 3] = 0.8 + this.random() * 0.5;
    }
    const geometry = this.geometry(new THREE.BufferGeometry());
    this.rainPositions = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.rainPositions);
    this.rainMaterial = this.material(new THREE.LineBasicMaterial({ color: '#c3dce0', transparent: true, opacity: 0, depthWrite: false }));
    this.rain = new THREE.LineSegments(geometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
    const rippleGeometry = this.geometry(new THREE.RingGeometry(0.84, 1, 18));
    this.rippleLife = new THREE.InstancedBufferAttribute(new Float32Array(this.rippleCount), 1).setUsage(THREE.DynamicDrawUsage);
    rippleGeometry.setAttribute('rippleLife', this.rippleLife);
    this.rippleMaterial = this.material(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { rain: { value: 0 } },
      vertexShader: 'attribute float rippleLife; varying float vLife; void main(){vLife=rippleLife;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float rain;varying float vLife;void main(){gl_FragColor=vec4(0.67,0.86,0.84,rain*0.42*pow(1.0-vLife,1.5));}',
    }));
    this.ripples = new THREE.InstancedMesh(rippleGeometry, this.rippleMaterial, this.rippleCount);
    this.ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ripples.frustumCulled = false;
    this.rippleSeeds = new Float32Array(this.rippleCount * 3);
    const floor: Array<{ x: number; z: number }> = [];
    level.tiles.forEach((row, z) => [...row].forEach((tile, x) => { if (tile === '.') floor.push({ x, z }); }));
    for (let i = 0; i < this.rippleCount; i++) {
      const p = floor[Math.floor(this.random() * floor.length)] ?? level.start;
      this.rippleSeeds[i * 3] = p.x - (level.width - 1) / 2 + (this.random() - 0.5) * 0.65;
      this.rippleSeeds[i * 3 + 1] = p.z - (level.height - 1) / 2 + (this.random() - 0.5) * 0.65;
      this.rippleSeeds[i * 3 + 2] = this.random();
    }
    this.root.add(this.ripples);
  }

  setWeather(mode: WeatherMode): void { this.mode = mode; this.snapshot.mode = mode; }
  setQuality(quality: 'high' | 'balanced'): void {
    this.quality = quality;
    this.rain.geometry.setDrawRange(0, (quality === 'high' ? this.rainCount : 170) * 2);
    this.ripples.count = quality === 'high' ? this.rippleCount : 20;
    this.fallingLeaves.count = quality === 'high' ? this.fallingCount : 12;
    // One instanced draw keeps both crowns equally full on mobile too.
    this.leafMesh.count = this.leaves.length;
  }
  setReducedMotion(value: boolean): void { this.reducedMotion = value; }
  getSnapshot(): AtmosphereSnapshot { return { ...this.snapshot }; }

  update(dt: number, elapsed: number): AtmosphereSnapshot {
    if (this.disposed) return this.snapshot;
    this.time = elapsed;
    const targets = sampleWeatherTargets(elapsed, this.cycleLength, this.mode);
    const blend = 1 - Math.exp(-dt * 1.3);
    this.snapshot.rain += (targets.rain - this.snapshot.rain) * blend;
    this.snapshot.cloudCover += (targets.cloudCover - this.snapshot.cloudCover) * blend;
    this.snapshot.sunlight += (targets.sunlight - this.snapshot.sunlight) * blend;
    const wind = clamp(0.38 + Math.sin(elapsed * 0.32) * 0.13 + Math.sin(elapsed * 0.87 + 1.4) * 0.09 + this.snapshot.cloudCover * 0.25);
    this.snapshot.wind = wind;
    this.snapshot.wetness += (this.snapshot.rain - this.snapshot.wetness) * (1 - Math.exp(-dt * (this.snapshot.rain > this.snapshot.wetness ? 0.38 : 0.038)));
    this.snapshot.phase = this.snapshot.rain > 0.12 ? 'rain' : this.snapshot.cloudCover > 0.3 ? 'cloudy' : 'clear';
    const motion = this.reducedMotion ? 0 : 1;
    this.updateCloth(elapsed * motion, this.reducedMotion ? 0.38 : wind, motion);
    this.updateTrees(elapsed * motion, wind, motion);
    this.updateLeaves(elapsed * motion, wind, motion);
    this.updateClouds(elapsed * motion, this.snapshot.cloudCover);
    this.updateRain(elapsed, wind, this.snapshot.rain, motion);
    if (elapsed - this.lastPublish >= 1 || this.lastPublish < 0) {
      this.lastPublish = elapsed;
      this.onChange?.(this.getSnapshot());
    }
    return this.snapshot;
  }

  private updateCloth(t: number, wind: number, motion: number): void {
    this.cloths.forEach(cloth => {
      const position = cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        const x = cloth.rest[i * 3], y = cloth.rest[i * 3 + 1];
        const free = Math.pow(-y / 1.16, 1.35);
        const wave = Math.sin(t * 3.5 - y * 5.2 + x * 3.8 + cloth.phase);
        const flutter = Math.sin(t * 7.3 + x * 9 - y * 4 + cloth.phase) * 0.018;
        position.setXYZ(i, x + Math.sin(t * 1.7 + cloth.phase) * 0.024 * free * wind * motion, y + Math.sin(x * 4 + t * 2.7 + cloth.phase) * 0.025 * free * wind * motion, free * (0.06 + wind * 0.12) + (wave * (0.065 + wind * 0.12) + flutter) * free * motion);
      }
      position.needsUpdate = true;
      cloth.geometry.computeVertexNormals();
    });
  }

  private updateTrees(t: number, wind: number, motion: number): void {
    this.trees.forEach(tree => {
      tree.root.rotation.z = Math.sin(t * 1.3 + tree.phase) * 0.035 * wind * motion;
      tree.root.rotation.x = Math.cos(t * 0.9 + tree.phase) * 0.024 * wind * motion;
      tree.branches.forEach((branch, i) => {
        const angle = i * 2.399 + (this.trees.indexOf(tree) === 0 ? -1 : 1);
        branch.rotation.z = Math.cos(angle) * 0.52 + Math.sin(t * 2.5 + i + tree.phase) * wind * 0.07 * motion;
        branch.rotation.x = Math.sin(angle) * 0.52 + Math.sin(t * 1.8 + i) * wind * 0.04 * motion;
      });
      tree.root.updateWorldMatrix(true, true);
    });
    for (let i = 0; i < this.leafMesh.count; i++) {
      const leaf = this.leaves[i];
      this.leafEuler.set(leaf.rotation.x + Math.sin(t * 5 + leaf.phase) * wind * 0.14 * motion, leaf.rotation.y, leaf.rotation.z + Math.sin(t * 3.7 + leaf.phase) * wind * 0.1 * motion);
      this.tempQuaternion.setFromEuler(this.leafEuler);
      this.tempMatrix.compose(leaf.position, this.tempQuaternion, leaf.scale).premultiply(leaf.branch.matrixWorld);
      this.leafMesh.setMatrixAt(i, this.tempMatrix);
    }
    this.leafMesh.instanceMatrix.needsUpdate = true;
  }

  private updateLeaves(t: number, wind: number, motion: number): void {
    this.fallingLeaves.visible = motion > 0;
    for (let i = 0; i < this.fallingLeaves.count; i++) {
      const life = fract(i * 0.381966 + t * (0.066 + i % 3 * 0.009));
      const side = i % 2 ? 1 : -1;
      const drift = Math.sin(i * 19.31) * 0.35;
      this.dummy.position.set(side * (this.width / 2 + 0.9) + Math.sin(life * 8 + i) * 0.22 + life * wind * 2.1, 2.55 - life * 3, -this.depth / 2 - 0.9 + drift + life * (1.5 + wind));
      this.dummy.rotation.set(life * 12 + i, life * 7, life * 9 + i);
      this.dummy.scale.set(1, 0.28, 1.7);
      this.dummy.updateMatrix();
      this.fallingLeaves.setMatrixAt(i, this.dummy.matrix);
    }
    this.fallingLeaves.instanceMatrix.needsUpdate = true;
  }

  private updateClouds(t: number, cloud: number): void {
    for (let i = 0; i < 18; i++) {
      const group = Math.floor(i / 6), lobe = i % 6;
      const travel = Math.sin(t * 0.018 + group * 1.9) * 3.5;
      this.dummy.position.set(-this.width * 0.6 + group * this.width * 0.59 + (lobe % 3 - 1) * 1.6 + travel, 3.8 + group % 2 * 1.5 + Math.sin(i * 4.2) * 0.28, -this.depth / 2 - 5 - group * 1.2 + Math.floor(lobe / 3) * 0.6);
      this.dummy.rotation.set(0, i * 0.6, 0);
      this.dummy.scale.set(1.9 + lobe % 2 * 0.5, 0.34 + cloud * 0.22, 0.9);
      this.dummy.updateMatrix();
      this.clouds.setMatrixAt(i, this.dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.cloudMaterial.color.copy(this.clearCloudColor).lerp(this.rainCloudColor, cloud);
    this.cloudMaterial.opacity = 0.32 + cloud * 0.34;
  }

  private updateRain(t: number, wind: number, rain: number, motion: number): void {
    this.rain.visible = rain > 0.018 && motion > 0;
    this.ripples.visible = rain > 0.018 && motion > 0;
    if (!this.rain.visible) return;
    this.rainMaterial.opacity = rain * 0.42;
    const count = this.quality === 'high' ? this.rainCount : 170;
    for (let i = 0; i < count; i++) {
      const s = i * 4;
      const life = fract(this.rainSeeds[s + 2] + t * this.rainSeeds[s + 3] * 1.45);
      const y = 6.5 * (1 - life) + 0.1;
      const x = this.rainSeeds[s] + wind * (1 - life) * 0.8;
      const z = this.rainSeeds[s + 1];
      this.rainPositions.setXYZ(i * 2, x, y, z);
      this.rainPositions.setXYZ(i * 2 + 1, x + wind * 0.024, y + 0.12 + this.rainSeeds[s + 3] * 0.07, z + 0.012);
    }
    this.rainPositions.needsUpdate = true;
    this.rippleMaterial.uniforms.rain.value = rain;
    for (let i = 0; i < this.ripples.count; i++) {
      const life = fract(this.rippleSeeds[i * 3 + 2] + t * 1.1);
      this.dummy.position.set(this.rippleSeeds[i * 3], 0.095, this.rippleSeeds[i * 3 + 1]);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.setScalar(0.015 + life * 0.16);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(i, this.dummy.matrix);
      this.rippleLife.setX(i, life);
    }
    this.ripples.instanceMatrix.needsUpdate = true;
    this.rippleLife.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.ownedGeometries.forEach(geometry => geometry.dispose());
    this.ownedMaterials.forEach(material => material.dispose());
    this.ownedTextures.forEach(texture => texture.dispose());
  }
}
