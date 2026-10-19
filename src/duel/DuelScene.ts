import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DuelState, DuelRobot, DuelWall, Vec2 } from './types';
import { COURT } from './types';
import { buildVenue } from './venue';
import { createDuelAmbience } from './ambience';
import type { DuelAmbience, DuelWeather } from './ambience';
import type { AtmosphereSnapshot } from '../render/weather';
import { createSunlightMask } from '../render/sunlight';

const CYAN = '#59eddf';
const ORANGE = '#ff9862';
const SHOT_Y = 1.1;
type RobotVisual = { root: THREE.Group; body: THREE.Group; cannon: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; leftArm: THREE.Group; eye: THREE.MeshStandardMaterial; armor: THREE.MeshStandardMaterial; muzzle: THREE.Sprite; muzzleRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; muzzleLife: number; lastShot: number; health: THREE.Line; lastHp: number };
type ProjectileVisual = { root: THREE.Group; rock: THREE.Group; trail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; positions: Float32Array; colors: Float32Array; history: { x: number; z: number; time: number }[]; goneAt: number | null; color: THREE.Color };
type Particle = { position: THREE.Vector3; velocity: THREE.Vector3; color: THREE.Color; life: number; maxLife: number };
type Pulse = { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; life: number; duration: number; size: number };

/** Rendering and pointer input only. The simulation owns all combat rules. */
export class DuelScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly arena = new THREE.Group();
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(38, 1, .1, 400);
  private readonly overheadCamera = new THREE.OrthographicCamera(-18, 18, 12, -12, .1, 180);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspectiveCamera;
  private readonly observer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly rayPoint = new THREE.Vector3();
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly robots: [RobotVisual, RobotVisual];
  private readonly walls = new Map<string, THREE.Group>();
  private readonly crates = new Map<string, THREE.Group>();
  private readonly projectiles = new Map<number, ProjectileVisual>();
  private readonly mobile = window.matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  private readonly particleBudget = this.mobile ? 256 : 768;
  private readonly particles: Particle[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly particlePositions = new Float32Array(this.particleBudget * 3);
  private readonly particleColors = new Float32Array(this.particleBudget * 3);
  private readonly particleGeometry = new THREE.BufferGeometry();
  private readonly particlePoints: THREE.Points;
  private readonly eventIds = new Set<number>();
  private state: DuelState;
  private frameId = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private disposed = false;
  private interactive = false;
  private aimPointer: number | null = null;
  private presentationPaused = false;
  private view: 'perspective' | 'overhead' = 'perspective';
  private wallSignature = '';
  private lastSeed: number;
  private lastTime = 0;
  private readonly ambience: DuelAmbience;
  private atmosphereElapsed = 0;
  private lastClimatePublish = -1;
  private weather: DuelWeather = 'auto';
  private readonly sunlight = new THREE.DirectionalLight('#ffe4b5', 3.7);
  private readonly warmSun = new THREE.Color('#ffe0a5');
  private readonly skylight = new THREE.HemisphereLight('#cee4ff', '#40434b', 2.15);
  private readonly sunlightMask = createSunlightMask();
  private readonly floorMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(private readonly container: HTMLElement, initial: DuelState, private readonly options: { onAim?: (point: Vec2) => void; onTap?: (point: Vec2) => void; onAtmosphere?: (climate: AtmosphereSnapshot) => void } = {}) {
    this.state = initial;
    this.lastSeed = initial.seed;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.25 : 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    this.canvas.setAttribute('aria-label', 'İki robotun karşı karşıya mücadele ettiği üç boyutlu arena');
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.scene.background = new THREE.Color('#142634');
    this.scene.fog = new THREE.Fog('#182c39', COURT.width * 1.5, COURT.width * 3.5);
    this.glowTexture = this.makeGlow();
    this.scene.add(this.arena);
    this.buildArena();
    buildVenue(this.arena);
    this.ambience = createDuelAmbience(this.scene, { mobile: this.mobile });
    this.robots = [this.makeRobot(0), this.makeRobot(1)];
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    this.particleGeometry.setDrawRange(0, 0);
    this.particlePoints = new THREE.Points(this.particleGeometry, new THREE.PointsMaterial({ size: .11, vertexColors: true, transparent: true, opacity: .92, depthWrite: false, blending: THREE.AdditiveBlending, map: this.glowTexture }));
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);
    window.addEventListener('blur', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.update(initial);
    this.resize();
    this.frameId = requestAnimationFrame(this.render);
  }

  update(state: DuelState): void {
    if (this.disposed) return;
    if ((state.seed !== this.lastSeed && state.time === 0) || state.time < this.lastTime) {
      this.eventIds.clear();
      this.particles.length = 0;
      for (const pulse of this.pulses) this.removeObject(pulse.mesh);
      this.pulses.length = 0;
      for (const projectile of this.projectiles.values()) { this.removeObject(projectile.root); this.removeObject(projectile.trail); }
      this.projectiles.clear();
      this.lastSeed = state.seed;
    }
    this.lastTime = state.time;
    this.state = state;
    const signature = state.walls.map(w => `${w.id}:${w.x}:${w.z}:${w.width}:${w.depth}:${w.kind}`).join('|');
    if (signature !== this.wallSignature) {
      for (const wall of this.walls.values()) this.removeObject(wall);
      this.walls.clear();
      for (const wall of state.walls) {
        const visual = this.makeWall(wall);
        this.walls.set(wall.id, visual);
        this.scene.add(visual);
      }
      this.wallSignature = signature;
    }
    const crateIds = new Set(state.crates.map(c => c.id));
    for (const [id, visual] of this.crates) if (!crateIds.has(id)) { this.removeObject(visual); this.crates.delete(id); }
    for (const crate of state.crates) {
      let visual = this.crates.get(crate.id);
      if (!visual) { visual = this.makeCrate(crate.size, crate.owner); this.crates.set(crate.id, visual); this.scene.add(visual); }
      visual.position.set(crate.x, crate.carriedBy === null ? crate.size * .5 + .03 : .85, crate.z);
      visual.rotation.y = crate.carriedBy === null ? 0 : this.state.robots[crate.carriedBy].angle;
      visual.scale.setScalar(.94 + .06 * crate.hp / crate.maxHp);
    }
    this.updateProjectiles(0);
    for (const event of state.events) {
      if (this.eventIds.has(event.id)) continue;
      this.eventIds.add(event.id);
      if (state.time - event.time > .6 || event.kind === 'shot') continue;
      const count = event.kind === 'destroy' || event.kind === 'win' ? 36 : 12;
      const color = event.kind === 'bounce' ? '#ffc269' : event.kind === 'cover' || event.kind === 'destroy' ? '#ccd6d1' : event.side ? ORANGE : CYAN;
      this.emit(event.x, event.z, color, count);
      this.addPulse(event.x, SHOT_Y, event.z, color, event.kind === 'destroy' ? 1.4 : .72, event.kind === 'destroy' ? .55 : .3);
    }
    if (this.eventIds.size > 1000) { this.eventIds.clear(); for (const event of state.events) this.eventIds.add(event.id); }
  }

  setCamera(view: 'perspective' | 'overhead'): void { this.view = view; this.resize(); }
  setInteractive(enabled: boolean): void { this.interactive = enabled; this.canvas.style.cursor = enabled ? 'crosshair' : 'default'; if (!enabled) this.onPointerUp(); }

  private updateProjectiles(dt: number): void {
    const live = new Set(this.state.projectiles.map(projectile => projectile.id));
    for (const projectile of this.state.projectiles) {
      let visual = this.projectiles.get(projectile.id);
      if (!visual) {
        const color = new THREE.Color(projectile.owner ? ORANGE : CYAN);
        const root = new THREE.Group(), rock = new THREE.Group(); root.add(rock);
        const radius = (projectile.radius || .2) * 1.23;
        const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), new THREE.MeshStandardMaterial({ color: '#b4c0bb', roughness: .65, metalness: .35, emissive: color, emissiveIntensity: .23, flatShading: true }));
        stone.scale.set(1.16, .88, .96); stone.castShadow = true; rock.add(stone);
        const facets = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.02, 0), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .6 })); rock.add(facets);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, color, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(1.05); root.add(glow);
        const positions = new Float32Array(63 * 6 * 3), colors = new Float32Array(63 * 6 * 3);
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const trail = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: .62, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        trail.frustumCulled = false; this.scene.add(root, trail);
        const history = projectile.trail.map(point => ({ ...point, time: this.state.time - .04 }));
        visual = { root, rock, trail, positions, colors, history, goneAt: null, color }; this.projectiles.set(projectile.id, visual);
      }
      visual.goneAt = null; visual.root.visible = true;
      visual.root.position.set(projectile.x, SHOT_Y, projectile.z);
      visual.rock.rotation.x += dt * 12; visual.rock.rotation.z += dt * 8; visual.rock.rotation.y += dt * 4;
      const last = visual.history.at(-1);
      if (!last || Math.hypot(projectile.x - last.x, projectile.z - last.z) > .025) visual.history.push({ x: projectile.x, z: projectile.z, time: this.state.time });
    }
    for (const [id, visual] of this.projectiles) {
      if (!live.has(id)) {
        visual.root.visible = false;
        visual.goneAt = (visual.goneAt ?? 0) + dt;
        if (visual.goneAt > .22 || this.state.phase === 'ready') { this.removeObject(visual.root); this.removeObject(visual.trail); this.projectiles.delete(id); continue; }
      }
      visual.history = visual.history.filter(point => this.state.time - point.time < .34).slice(-64);
      const points = visual.history, count = points.length;
      let vertex = 0;
      const fade = visual.goneAt === null ? 1 : 1 - visual.goneAt / .22;
      const put = (x: number, y: number, z: number, intensity: number) => {
        visual.positions[vertex * 3] = x; visual.positions[vertex * 3 + 1] = y; visual.positions[vertex * 3 + 2] = z;
        visual.colors[vertex * 3] = visual.color.r * intensity; visual.colors[vertex * 3 + 1] = visual.color.g * intensity; visual.colors[vertex * 3 + 2] = visual.color.b * intensity; vertex++;
      };
      for (let i = 0; i < count - 1; i++) {
        const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
        const tail = i / Math.max(1, count - 1), next = (i + 1) / Math.max(1, count - 1);
        const widthA = .012 + tail * .115, widthB = .012 + next * .115;
        const px = -dz / length, pz = dx / length;
        const ya = SHOT_Y, yb = SHOT_Y;
        const brightnessA = tail * tail * fade, brightnessB = next * next * fade;
        put(a.x + px * widthA, ya, a.z + pz * widthA, brightnessA); put(a.x - px * widthA, ya, a.z - pz * widthA, brightnessA); put(b.x + px * widthB, yb, b.z + pz * widthB, brightnessB);
        put(b.x + px * widthB, yb, b.z + pz * widthB, brightnessB); put(a.x - px * widthA, ya, a.z - pz * widthA, brightnessA); put(b.x - px * widthB, yb, b.z - pz * widthB, brightnessB);
      }
      visual.trail.geometry.setDrawRange(0, vertex); visual.trail.geometry.attributes.position.needsUpdate = true; visual.trail.geometry.attributes.color.needsUpdate = true;
    }
  }

  private addPulse(x: number, y: number, z: number, color: string, size: number, duration: number, grounded = false): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(.22, .255, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(x, grounded ? .075 : y, z);
    if (grounded) mesh.rotation.x = -Math.PI / 2; else mesh.quaternion.copy(this.camera.quaternion);
    this.scene.add(mesh); this.pulses.push({ mesh, life: duration, duration, size });
  }

  private makeGlow(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.16, 'rgba(255,255,255,.9)'); gradient.addColorStop(.44, 'rgba(255,255,255,.22)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  private standard(color: string, metalness = .25, roughness = .55): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    this.sunlightMask.apply(material);
    return material;
  }
  private box(parent: THREE.Object3D, width: number, height: number, depth: number, material: THREE.Material, x = 0, y = 0, z = 0, shadow = false): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private lineOnFloor(points: number[][], color: string, opacity = 1): void {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p[0], .055, p[1])));
    this.arena.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
  }

  /** Static panels with one finish share a draw call; their parent still moves. */
  private batchStaticBoxes(group: THREE.Group): void {
    const batches = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.Material>[]>();
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BoxGeometry) || Array.isArray(child.material)) continue;
      const key = `${child.material.uuid}:${Number(child.castShadow)}:${Number(child.receiveShadow)}:${child.renderOrder}`;
      const batch = batches.get(key) ?? [];
      batch.push(child);
      batches.set(key, batch);
    }
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map(mesh => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix); });
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      const first = meshes[0], combined = new THREE.Mesh(merged, first.material);
      combined.castShadow = first.castShadow; combined.receiveShadow = first.receiveShadow; combined.renderOrder = first.renderOrder;
      for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      group.add(combined);
    }
  }

  private buildArena(): void {
    this.arena.scale.set(COURT.width / 24, 1, COURT.depth / 14);
    this.scene.add(this.skylight);
    const key = this.sunlight; key.position.set(-18, 30, 12); key.castShadow = true;
    const shadowSize = this.mobile ? 1024 : 2048;
    key.shadow.mapSize.set(shadowSize, shadowSize); key.shadow.camera.left = -28; key.shadow.camera.right = 28; key.shadow.camera.top = 24; key.shadow.camera.bottom = -24; key.shadow.camera.far = 85; key.shadow.normalBias = .04; key.shadow.bias = -.0003;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#8fbeff', .8); rim.position.set(12, 8, -14); this.scene.add(rim);
    this.box(this.arena, 32, .6, 29, this.standard('#4b555f', .1, .85), 0, -.74, 0);
    this.box(this.arena, 27, .55, 17, this.standard('#d0bda0', .12, .7), 0, -.32, 0);
    this.box(this.arena, 26.3, .13, 16.3, this.standard('#ede3cc', .15, .55), 0, -.035, 0);
    const ground = this.standard('#40546b', .12, .68); this.floorMaterials.push(ground);
    this.box(this.arena, 24, .045, 14, ground, 0, .025, 0);
    // Research courtyard paving replaces sport-court markings and service boxes.
    for (let x = -10.5; x < 12; x += 1.5) this.lineOnFloor([[x, -7], [x, 7]], '#d7d9dd', .12);
    for (let z = -5.5; z < 7; z += 1.5) this.lineOnFloor([[-12, z], [12, z]], '#d7d9dd', .12);
    const cyan = new THREE.MeshBasicMaterial({ color: '#72c8ff' }), coral = new THREE.MeshBasicMaterial({ color: '#ffac8c' });
    for (const side of [-1, 1]) {
      const light = side < 0 ? cyan : coral;
      this.box(this.arena, 12.2, .035, .055, light, side * 6.2, .074, -7.45);
      this.box(this.arena, 12.2, .035, .055, light, side * 6.2, .074, 7.45);
      this.box(this.arena, .055, .035, 14.9, light, side * 12.3, .074, 0);
    }
    // A lit boundary communicates the split without a tennis net.
    for (let z = -6.8; z <= 7; z += .55) this.box(this.arena, .055, .025, .22, cyan, 0, .07, z);
    for (const z of [-7.25, 7.25]) {
      this.box(this.arena, .18, .42, .18, this.standard('#ba8d62', .65), 0, .21, z, true);
      this.box(this.arena, .2, .055, .2, cyan, 0, .45, z);
    }
    this.floorType('ATLAS', -8.7, 4.8, '#b6d5e8', 3, .55);
    this.floorType('KOR', 8.7, -4.8, '#f5c1ac', 2.2, .55);
    this.floorType('N O E M A  /  D U E L', 0, 7.9, '#465264', 8, .5);
  }

  private floorType(text: string, x: number, z: number, color: string, width = 2.8, depth = 1.8): void {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.globalAlpha = .46; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = text.length > 3 ? '500 56px sans-serif' : 'bold 190px sans-serif'; context.fillText(text, 512, 138);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: .7 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .061, z); this.arena.add(mesh);
  }

  private makeRobot(side: number): RobotVisual {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body); this.scene.add(root);
    const color = side ? ORANGE : CYAN;
    const armor = this.standard(side ? '#dc6949' : '#4cbeb6', .65, .3);
    const white = this.standard('#c7d7d7', .55, .35), dark = this.standard('#172b39', .7, .36);
    const eye = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, metalness: .4, roughness: .3 });
    const joint = this.standard('#0d1824', .55, .5);
    const torso = this.box(body, .68, .65, .43, armor, 0, 1.05, 0, true);
    torso.rotation.z = side ? -.025 : .025;
    this.box(body, .5, .28, .08, dark, 0, 1.14, .25, true);
    this.box(body, .08, .19, .09, eye, 0, 1.14, .299);
    this.box(body, .44, .18, .35, dark, 0, .65, 0, true);
    this.box(body, .16, .17, .16, joint, 0, 1.45, 0, true);
    this.box(body, .54, .41, .45, white, 0, 1.69, 0, true);
    this.box(body, .5, .17, .08, dark, 0, 1.72, .245);
    this.box(body, .36, .07, .09, eye, 0, 1.73, .285);
    this.box(body, .12, .12, .3, armor, -.31, 1.67, 0, true);
    this.box(body, .12, .12, .3, armor, .31, 1.67, 0, true);
    this.box(body, .04, .28, .04, dark, -.19, 2.02, -.05);
    this.box(body, .065, .065, .065, eye, -.19, 2.17, -.05);
    const leftLeg = new THREE.Group(), rightLeg = new THREE.Group();
    for (const [leg, x] of [[leftLeg, -.2], [rightLeg, .2]] as [THREE.Group, number][]) {
      leg.position.set(x, .67, 0); body.add(leg);
      this.box(leg, .22, .36, .26, dark, 0, -.18, 0, true);
      this.box(leg, .24, .3, .28, white, 0, -.45, .02, true);
      this.box(leg, .18, .07, .05, armor, 0, -.43, .18);
      this.box(leg, .29, .15, .44, dark, 0, -.58, .1, true);
    }
    const leftArm = new THREE.Group(); leftArm.position.set(-.46, 1.27, 0); body.add(leftArm);
    this.box(leftArm, .27, .28, .33, armor, 0, -.03, 0, true);
    this.box(leftArm, .2, .4, .23, dark, 0, -.35, .05, true);
    this.box(leftArm, .23, .21, .23, white, 0, -.57, .05, true);
    this.box(body, .27, .26, .34, armor, .46, 1.25, 0, true);
    const cannon = new THREE.Group(); body.add(cannon);
    this.box(cannon, .24, .24, .55, dark, .46, 1.08, .25, true);
    this.box(cannon, .52, .16, .22, dark, .22, 1.03, .28, true);
    this.box(cannon, .34, .32, .4, white, 0, SHOT_Y, .22, true);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.14, .16, .3, 12), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, SHOT_Y, .48); barrel.castShadow = true; cannon.add(barrel);
    const barrelRing = new THREE.Mesh(new THREE.TorusGeometry(.15, .03, 6, 16), eye); barrelRing.position.set(0, SHOT_Y, .64); cannon.add(barrelRing);
    const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#e4fff7', map: this.glowTexture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); muzzle.position.set(0, SHOT_Y, .68); muzzle.scale.setScalar(0); cannon.add(muzzle);
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(.19, .022, 6, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); muzzleRing.position.set(0, SHOT_Y, .7); cannon.add(muzzleRing);
    const ringPoints = Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2) * .76, .085, Math.sin(i / 64 * Math.PI * 2) * .76));
    const backing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color: '#344951', transparent: true, opacity: .7 })); root.add(backing);
    const health = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .9 })); root.add(health);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.65, 32), new THREE.MeshBasicMaterial({ color: '#02080d', transparent: true, opacity: .28, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .045; root.add(shadow);
    return { root, body, cannon, leftLeg, rightLeg, leftArm, eye, armor, muzzle, muzzleRing, muzzleLife: 0, lastShot: 0, health, lastHp: -1 };
  }

  private makeCrate(size: number, side: number): THREE.Group {
    const group = new THREE.Group();
    const metal = this.standard('#526771', .8, .4), panel = this.standard('#243a46', .6, .52), trim = this.standard('#91a7ae', .8, .4);
    const glow = new THREE.MeshBasicMaterial({ color: side ? ORANGE : CYAN });
    this.box(group, size, size, size, metal, 0, 0, 0, true);
    for (const sign of [-1, 1]) {
      this.box(group, size * .78, size * .73, .035, panel, 0, 0, sign * (size / 2 + .01));
      this.box(group, .035, size * .73, size * .78, panel, sign * (size / 2 + .01), 0, 0);
      this.box(group, size * 1.04, .07, size * 1.04, trim, 0, sign * size * .42, 0);
      this.box(group, size * .42, .05, .04, glow, 0, size * .2, sign * (size / 2 + .04));
      for (const xsign of [-1, 1]) this.box(group, .09, size, .08, trim, xsign * size * .43, 0, sign * size * .49);
    }
    this.box(group, size * .58, .035, size * .58, panel, 0, size / 2 + .01, 0);
    this.batchStaticBoxes(group);
    return group;
  }

  private makeWall(wall: DuelWall): THREE.Group {
    const group = new THREE.Group(); group.position.set(wall.x, 0, wall.z);
    const phase = wall.kind === 'phase', color = phase ? CYAN : '#ffc36d';
    const height = phase ? 1.54 : 1.27;
    const metal = this.standard('#45515a', .8, .4);
    const luminous = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: phase ? .72 : 1 });
    if (phase) {
      this.box(group, wall.width, height, wall.depth, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: .13, emissive: color, emissiveIntensity: .35, metalness: .15, roughness: .2, depthWrite: false }), 0, height / 2, 0);
      const horizontal = wall.width >= wall.depth, span = horizontal ? wall.width : wall.depth;
      for (let i = -.5 * span + .14; i < .5 * span; i += .38) {
        this.box(group, horizontal ? .12 : .045, .07, horizontal ? .045 : .12, luminous, horizontal ? i : 0, height, horizontal ? 0 : i);
        for (let y = .3; y < height; y += .32) this.box(group, horizontal ? .06 : .035, .055, horizontal ? .035 : .06, luminous, horizontal ? i : 0, y, horizontal ? 0 : i);
      }
    } else {
      this.box(group, wall.width, height, wall.depth, this.standard('#735947', .7, .4), 0, height / 2, 0, true);
      this.box(group, wall.width + .04, .095, wall.depth + .04, luminous, 0, height, 0);
      const horizontal = wall.width >= wall.depth;
      const length = horizontal ? wall.width : wall.depth;
      const stripeMaterial = this.standard('#d6a061', .6);
      for (let i = -length / 2 + .2; i < length / 2; i += .46) {
        const stripe = this.box(group, horizontal ? .13 : wall.width + .02, .5, horizontal ? wall.depth + .02 : .13, stripeMaterial, horizontal ? i : 0, .7, horizontal ? 0 : i);
        if (horizontal) stripe.rotation.z = -.36; else stripe.rotation.x = .36;
      }
    }
    this.box(group, wall.width + .16, .14, wall.depth + .16, metal, 0, .09, 0, true);
    const horizontal = wall.width >= wall.depth;
    for (const sign of [-1, 1]) {
      const x = horizontal ? sign * wall.width / 2 : 0, z = horizontal ? 0 : sign * wall.depth / 2;
      this.box(group, .14, height + .12, .14, metal, x, height / 2, z, true);
      this.box(group, .16, .07, .16, luminous, x, height + .03, z);
    }
    this.batchStaticBoxes(group);
    return group;
  }

  private emit(x: number, z: number, color: string, count: number): void {
    for (let i = 0; i < count && this.particles.length < this.particleBudget; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 1 + Math.random() * 3;
      const life = .35 + Math.random() * .5;
      this.particles.push({ position: new THREE.Vector3(x, SHOT_Y, z), velocity: new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 3, Math.sin(angle) * speed), color: new THREE.Color(color), life, maxLife: life });
    }
  }

  private animateRobot(visual: RobotVisual, robot: DuelRobot, dt: number): void {
    visual.root.position.set(robot.x, 0, robot.z);
    const targetAngle = Math.atan2(robot.decision.aim.x - robot.x, robot.decision.aim.z - robot.z);
    const delta = Math.atan2(Math.sin(targetAngle - visual.body.rotation.y), Math.cos(targetAngle - visual.body.rotation.y));
    visual.body.rotation.y += delta * Math.min(1, dt * 13);
    const walking = Math.min(1, Math.hypot(robot.vx, robot.vz) / 2.8);
    const stride = Math.sin(this.elapsed * 12 + robot.id * 2) * .36 * walking;
    visual.leftLeg.rotation.x = stride; visual.rightLeg.rotation.x = -stride; visual.leftArm.rotation.x = -stride * .65;
    visual.body.position.y = Math.abs(Math.sin(this.elapsed * 12)) * .045 * walking;
    visual.body.rotation.z = -robot.vx * .014;
    visual.armor.emissive.set(robot.hitFlash > 0 ? '#ffffff' : '#000000'); visual.armor.emissiveIntensity = robot.hitFlash > 0 ? Math.min(.8, robot.hitFlash * 5) : 0;
    visual.eye.emissiveIntensity = 1.3 + .3 * Math.sin(this.elapsed * 3);
    if (robot.shots > visual.lastShot) {
      visual.muzzleLife = .22;
      const dx = Math.sin(targetAngle), dz = Math.cos(targetAngle);
      for (let i = 0; i < 9 && this.particles.length < this.particleBudget; i++) {
        const life = .15 + Math.random() * .13;
        this.particles.push({ position: new THREE.Vector3(robot.x + dx * .68, SHOT_Y, robot.z + dz * .68), velocity: new THREE.Vector3(dx * (3 + Math.random() * 3) + (Math.random() - .5), (Math.random() - .3) * 2, dz * (3 + Math.random() * 3) + (Math.random() - .5)), color: new THREE.Color(robot.id ? ORANGE : CYAN), life, maxLife: life });
      }
    }
    visual.lastShot = robot.shots; visual.muzzleLife = Math.max(0, visual.muzzleLife - dt);
    const flash = visual.muzzleLife / .22;
    visual.muzzle.scale.setScalar(flash * 1.45); visual.cannon.position.z = -Math.sin(flash * Math.PI) * .13;
    visual.muzzleRing.visible = flash > 0; visual.muzzleRing.scale.setScalar(1 + (1 - flash) * 2.5); visual.muzzleRing.material.opacity = flash * .8; visual.muzzleRing.position.z = .7 + (1 - flash) * .5;
    if (robot.hp !== visual.lastHp) { visual.health.geometry.setDrawRange(0, Math.max(0, Math.round(65 * robot.hp / robot.maxHp))); visual.lastHp = robot.hp; }
    if (robot.hp <= 0) { visual.body.rotation.z = -.48; visual.body.position.y = -.18; visual.eye.emissiveIntensity = .08; }
  }

  private render = (now: number): void => {
    if (this.disposed) return;
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, .05) : 1 / 60; this.lastFrame = now;
    if (this.state.phase === 'running') this.elapsed += dt;
    if (!this.presentationPaused && !document.hidden) this.advanceAtmosphere(dt);
    this.robots.forEach((visual, index) => this.animateRobot(visual, this.state.robots[index], dt));
    this.updateProjectiles(dt);
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i]; pulse.life -= dt;
      if (pulse.life <= 0) { this.removeObject(pulse.mesh); this.pulses.splice(i, 1); continue; }
      const progress = 1 - pulse.life / pulse.duration; pulse.mesh.scale.setScalar(1 + progress * pulse.size * 4); pulse.mesh.material.opacity = (1 - progress) * .8;
    }
    let alive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i]; particle.life -= dt;
      if (particle.life <= 0) continue;
      particle.position.addScaledVector(particle.velocity, dt); particle.velocity.y -= dt * 5;
      const fade = particle.life / particle.maxLife;
      this.particles[alive] = particle;
      this.particlePositions[alive * 3] = particle.position.x; this.particlePositions[alive * 3 + 1] = particle.position.y; this.particlePositions[alive * 3 + 2] = particle.position.z;
      this.particleColors[alive * 3] = particle.color.r * fade; this.particleColors[alive * 3 + 1] = particle.color.g * fade; this.particleColors[alive * 3 + 2] = particle.color.b * fade;
      alive++;
    }
    this.particles.length = alive;
    this.particleGeometry.setDrawRange(0, this.particles.length); this.particleGeometry.attributes.position.needsUpdate = true; this.particleGeometry.attributes.color.needsUpdate = true;
    if (!this.presentationPaused) this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.render);
  };

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight), aspect = width / height;
    const portrait = aspect < 1.1;
    if (this.view === 'overhead') {
      const camera = this.overheadCamera;
      const vertical = Math.max(COURT.depth + 5, (COURT.width + 5.8) / aspect);
      camera.left = -vertical * aspect / 2; camera.right = vertical * aspect / 2; camera.top = vertical / 2; camera.bottom = -vertical / 2;
      camera.position.set(0, 50, .01); camera.lookAt(0, 0, 0);
      this.camera = camera;
    } else {
      const camera = this.perspectiveCamera;
      camera.aspect = aspect;
      // A gentle diagonal exposes the sides of campus buildings. Real perspective
      // lets distant city districts recede without scaling the combat simulation.
      const direction = new THREE.Vector3(portrait ? 7 : 9, portrait ? 43 : 28, portrait ? 34 : 42).normalize();
      const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right);
      const target = new THREE.Vector3(0, .8, portrait ? -.3 : -.5);
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov * .5));
      const horizontal = tangent * aspect * (portrait ? .94 : .91);
      const vertical = tangent * (portrait ? .86 : .83);
      const corner = new THREE.Vector3();
      let distance = 1;
      // Fit both the arena rim and robot heads, rather than a guessed fixed zoom.
      // This keeps every playable corner visible through portrait/landscape changes.
      for (const x of [-COURT.halfWidth - .8, COURT.halfWidth + .8]) {
        for (const z of [-COURT.halfDepth - .8, COURT.halfDepth + .8]) {
          for (const y of [0, 2.4]) {
            corner.set(x, y, z).sub(target);
            distance = Math.max(distance, corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / horizontal, Math.abs(corner.dot(up)) / vertical));
          }
        }
      }
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      this.camera = camera;
    }
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true); this.updateDepthFog(); this.renderer.setSize(width, height, false);
    // Resizing a paused training frame or changing its camera must update it once.
    this.renderer.render(this.scene, this.camera);
  }

  setWeather(weather: DuelWeather): void { this.weather = weather; }
  getAtmosphere(): AtmosphereSnapshot { return this.ambience.getSnapshot(); }
  private updateDepthFog(cloud = this.ambience.getSnapshot().cloudCover): void {
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    // Portrait uses a more distant camera to fit the same arena width. Keep its
    // playable floor clear while retaining atmospheric depth beyond the campus.
    this.scene.fog.near = this.camera.position.length() + 16 - cloud * 5;
    this.scene.fog.far = this.scene.fog.near + 100 - cloud * 25;
  }
  advanceAtmosphere(dt: number): void {
    this.atmosphereElapsed += Math.max(0, dt);
    this.ambience.update(dt, this.atmosphereElapsed, this.weather);
    const climate = this.ambience.getSnapshot();
    this.updateDepthFog(climate.cloudCover);
    this.sunlight.intensity = .6 + climate.sunlight * 2.8;
    this.sunlight.color.set('#bdd4eb').lerp(this.warmSun, climate.sunlight);
    this.skylight.intensity = 1.55 - climate.sunlight * .3;
    this.renderer.toneMappingExposure = 1.05 + climate.sunlight * .1;
    this.sunlightMask.uniforms.noemaSunTime.value = this.atmosphereElapsed;
    this.sunlightMask.uniforms.noemaCloudShade.value = climate.cloudCover * .65;
    this.floorMaterials.forEach(material => { material.roughness = .68 - climate.wetness * .34; material.metalness = .12 + climate.wetness * .14; });
    if (this.atmosphereElapsed - this.lastClimatePublish > .7) { this.lastClimatePublish = this.atmosphereElapsed; this.options.onAtmosphere?.(climate); }
  }

  /** Training keeps the last court frame while the separate worker updates weights. */
  setPresentationPaused(paused: boolean): void { this.presentationPaused = paused; }

  private aimFromEvent(event: PointerEvent): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, this.rayPoint)) return null;
    const point = { x: THREE.MathUtils.clamp(this.rayPoint.x, -COURT.halfWidth, COURT.halfWidth), z: THREE.MathUtils.clamp(this.rayPoint.z, -COURT.halfDepth, COURT.halfDepth) };
    this.options.onAim?.(point);
    return point;
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (this.interactive && (event.pointerType === 'mouse' || event.pointerId === this.aimPointer)) this.aimFromEvent(event);
  };
  private onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive || event.button !== 0 || this.aimPointer !== null) return;
    event.preventDefault(); this.canvas.focus({ preventScroll: true });
    this.aimPointer = event.pointerId;
    const point = this.aimFromEvent(event);
    this.canvas.setPointerCapture(event.pointerId);
    // A tap is one shot request. The app keeps that point while the cooldown
    // finishes, independently of joystick movement or later aiming gestures.
    if (point) {
      this.options.onTap?.(point);
      this.addPulse(point.x, .075, point.z, CYAN, .24, .24, true);
    }
  };
  private onPointerUp = (event?: Event): void => {
    if (event instanceof PointerEvent && event.pointerId !== this.aimPointer) return;
    const pointer = this.aimPointer;
    this.aimPointer = null;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
  };
  private onContextMenu = (event: Event): void => { if (this.interactive) event.preventDefault(); };

  private removeObject(object: THREE.Object3D): void {
    object.removeFromParent();
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.onPointerUp(); cancelAnimationFrame(this.frameId); this.observer.disconnect();
    this.ambience.dispose();
    this.canvas.removeEventListener('pointermove', this.onPointerMove); this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.canvas.removeEventListener('pointerup', this.onPointerUp); this.canvas.removeEventListener('pointercancel', this.onPointerUp); this.canvas.removeEventListener('lostpointercapture', this.onPointerUp); this.canvas.removeEventListener('contextmenu', this.onContextMenu); window.removeEventListener('blur', this.onPointerUp);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) { materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value); }
      if (object instanceof THREE.Light && object.shadow) object.shadow.dispose();
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); this.glowTexture.dispose(); this.scene.clear(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
    this.walls.clear(); this.crates.clear(); this.projectiles.clear(); this.particles.length = 0;
  }
}
