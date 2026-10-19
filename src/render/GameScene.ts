import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameState, Level } from '../core/types';
import { StudioAssets, makeCrate, makePlant, makeRobot } from './objects';
import type { RobotRig } from './objects';
import { GardenAtmosphere } from './weather';
import type { AtmosphereSnapshot, WeatherMode } from './weather';
import { setAtmosphere } from '../lib/audio';
import { createSunlightMask } from './sunlight';
import { makeObservationCameras, makeResearchDistrict } from './district';
import { CAMERA_VIEWS, type CameraView } from './cameraViews';

export interface GameSceneOptions { quality?: 'high' | 'balanced'; onReady?: () => void; onAtmosphereChange?: (snapshot: AtmosphereSnapshot) => void }
interface DoorVisual {
  root: THREE.Group; shutter: THREE.Group; target: number; openness: number;
  slats: THREE.Mesh[];
  status: THREE.MeshStandardMaterial; threshold: THREE.MeshStandardMaterial;
  spill: THREE.Mesh; spillMaterial: THREE.MeshBasicMaterial;
  openLabel: THREE.Mesh; closedLabel: THREE.Mesh;
}
interface SwitchVisual {
  root: THREE.Group; button: THREE.Mesh; light: THREE.Mesh; target: number; activation: number;
  surface: THREE.MeshStandardMaterial; status: THREE.MeshStandardMaterial;
  spill: THREE.Mesh; spillMaterial: THREE.MeshBasicMaterial;
}

/** The simulator owns rules; this view only interpolates immutable snapshots. */
export class GameScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly skyTexture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 150);
  private readonly sun = new THREE.DirectionalLight('#fff0d3', 3.7);
  private readonly skylight = new THREE.HemisphereLight('#c8e3e6', '#a47768', 2.25);
  private readonly observer: ResizeObserver;
  private assets = new StudioAssets();
  private world = new THREE.Group();
  private robot!: RobotRig;
  private crateVisuals = new Map<string, THREE.Group>();
  private doorVisuals = new Map<string, DoorVisual>();
  private switchVisuals = new Map<string, SwitchVisual>();
  private portalRings: THREE.Mesh[] = [];
  private portalParticles: THREE.Mesh[] = [];
  private dust: THREE.Points | null = null;
  private atmosphere: GardenAtmosphere | null = null;
  private weatherMode: WeatherMode = 'auto';
  private lastAtmospherePublish = -Infinity;
  private readonly onAtmosphereChange?: (snapshot: AtmosphereSnapshot) => void;
  private skyContext: CanvasRenderingContext2D;
  private skyCloudiness = -1;
  private skySunlight = -1;
  private readonly sunlightMask = createSunlightMask();
  private hasPresentedFrame = false;
  private readonly clearFog = new THREE.Color('#d6b6b2');
  private readonly rainFog = new THREE.Color('#8b9b9f');
  private readonly clearSun = new THREE.Color('#ffe0a0');
  private readonly rainSun = new THREE.Color('#c3d5df');
  private readonly inactiveSignal = new THREE.Color('#d89a43');
  private readonly activeSignal = new THREE.Color('#75ffce');
  private readonly inactivePlate = new THREE.Color('#b6a98d');
  private readonly activePlate = new THREE.Color('#b6ffe0');
  private conveyors: THREE.Group[] = [];
  private state: GameState;
  private targetRobot = new THREE.Vector3();
  private lastRobot = new THREE.Vector3();
  private crateTarget = new THREE.Vector3();
  private frameId = 0;
  private previousTime = 0;
  private elapsed = 0;
  private walking = 0;
  private disposed = false;
  private trainingPaused = false;
  private visible = true;
  private quality: 'high' | 'balanced';
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private celebrate = 0;
  private focus = 0;
  private cameraTarget = new THREE.Vector3(0, 0.65, -0.3);
  private cameraView: CameraView = 0;
  private cameraAzimuth = THREE.MathUtils.degToRad(CAMERA_VIEWS[0].azimuth);
  private cameraElevation = THREE.MathUtils.degToRad(CAMERA_VIEWS[0].elevation);
  private cameraVertical = 12;
  private cameraAspect = 1;
  private cameraFraming = new THREE.Vector3();
  private loseContext = (event: Event): void => { event.preventDefault(); };
  private restoreContext = (): void => { if (!this.disposed) this.resize(); };
  private onVisibility = (): void => { this.visible = !document.hidden; this.previousTime = 0; setAtmosphere({ visible: this.visible }); };

  constructor(private readonly container: HTMLElement, initialState: GameState, options: GameSceneOptions = {}) {
    this.state = initialState;
    this.onAtmosphereChange = options.onAtmosphereChange;
    this.quality = options.quality ?? (window.innerWidth < 700 ? 'balanced' : 'high');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'NOEMA robotunun üç boyutlu eğitim bahçesi');
    this.canvas.setAttribute('role', 'img');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.canvas);
    const sky = document.createElement('canvas');
    sky.width = 512;
    sky.height = 512;
    const skyContext = sky.getContext('2d')!;
    this.skyContext = skyContext;
    const dawn = skyContext.createLinearGradient(0, 0, 0, 512);
    dawn.addColorStop(0, '#8e9ba4');
    dawn.addColorStop(0.38, '#c9afb0');
    dawn.addColorStop(0.72, '#e7c9ba');
    dawn.addColorStop(1, '#e7d5bf');
    skyContext.fillStyle = dawn;
    skyContext.fillRect(0, 0, 512, 512);
    const haze = skyContext.createRadialGradient(80, 180, 2, 80, 180, 280);
    haze.addColorStop(0, 'rgba(255,238,208,0.62)');
    haze.addColorStop(1, 'rgba(255,238,208,0)');
    skyContext.fillStyle = haze;
    skyContext.fillRect(0, 0, 512, 512);
    this.skyTexture = new THREE.CanvasTexture(sky);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTexture;
    this.scene.fog = new THREE.Fog('#d6b6b2', 29, 63);
    this.scene.add(this.skylight);
    this.scene.add(new THREE.AmbientLight('#fff1de', 0.4));
    this.sun.position.set(-8, 15, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 55;
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const rim = new THREE.DirectionalLight('#9bebe7', 1.1);
    rim.position.set(8, 5, -8);
    this.scene.add(rim);
    this.scene.add(this.world);
    this.build(initialState.level);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('webglcontextlost', this.loseContext);
    this.canvas.addEventListener('webglcontextrestored', this.restoreContext);
    this.setQuality(this.quality);
    this.resize();
    this.renderer.render(this.scene, this.camera);
    options.onReady?.();
    this.frameId = requestAnimationFrame(this.animate);
  }

  private worldPosition(x: number, z: number, y = 0): THREE.Vector3 {
    return new THREE.Vector3(x - (this.state.level.width - 1) / 2, y, z - (this.state.level.height - 1) / 2);
  }

  private build(level: Level): void {
    this.hasPresentedFrame = false;
    const a = this.assets;
    for (const finish of ['ceramic', 'ceramicLight', 'sand', 'stone', 'copper'] as const) this.sunlightMask.apply(a.material(finish));
    const w = level.width, h = level.height;
    const hw = w / 2, hh = h / 2;
    this.makeArchitecture(w, h);

    // A dark reveal under each ceramic tile makes paths readable without a chessboard.
    const tilePositions: THREE.Vector3[] = [];
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const tile = level.tiles[z]?.[x] ?? ' ';
      if (tile === ' ') continue;
      tilePositions.push(this.worldPosition(x, z, 0.015));
      if (tile === '#') this.makeWall(this.worldPosition(x, z), (x * 13 + z * 7) % 4);
    }
    this.makeSurfaces(level);
    this.mergeStaticGeometry();
    const floor = new THREE.InstancedMesh(a.roundedGeometry(0.965, 0.14, 0.965, 0.025), a.material('ceramic'), tilePositions.length);
    const dummy = new THREE.Object3D();
    const colors = ['#eadfcb', '#e2d8c5', '#efe5d1', '#e4dac9'];
    tilePositions.forEach((position, i) => {
      dummy.position.copy(position);
      dummy.updateMatrix();
      floor.setMatrixAt(i, dummy.matrix);
      floor.setColorAt(i, new THREE.Color(colors[(i * 7 + Math.floor(i / w)) % 4]));
    });
    floor.instanceMatrix.needsUpdate = true;
    if (floor.instanceColor) floor.instanceColor.needsUpdate = true;
    floor.receiveShadow = true;
    this.world.add(floor);

    // A restrained engraved coordinate strip, in the same material language as the lab.
    for (let x = 0; x < w; x++) {
      a.box(this.world, 0.022, 0.01, 0.13, 'copper', x - (w - 1) / 2, 0.108, hh + 0.14, 0.003);
      if (x % 2 === 0) a.box(this.world, 0.14, 0.012, 0.026, 'cyanDim', x - (w - 1) / 2, 0.109, hh + 0.33, 0.004);
    }
    for (const goal of level.goals) {
      const p = this.worldPosition(goal.x, goal.z);
      if (goal.kind === 'exit') this.makePortal(p);
      else {
        a.cylinder(this.world, 0.35, 0.35, 0.012, 'navy', p.x, 0.098, p.z, 32);
        a.ring(this.world, 0.315, 0.019, goal.kind, p.x, 0.117, p.z, true);
        a.ring(this.world, 0.22, 0.008, goal.kind, p.x, 0.117, p.z, true);
        if (goal.kind === 'cyan') {
          const emblem = a.box(this.world, 0.105, 0.012, 0.105, 'cyan', p.x, 0.119, p.z, 0.009);
          emblem.rotation.y = Math.PI / 4;
        } else a.cylinder(this.world, 0.04, 0.04, 0.012, 'amber', p.x, 0.12, p.z, 16);
        for (const side of [-1, 1]) a.box(this.world, 0.07, 0.015, 0.025, goal.kind, p.x + side * 0.4, 0.118, p.z, 0.005);
      }
    }
    for (const item of this.state.switches) {
      const root = new THREE.Group();
      root.name = `switch:${item.id}`;
      root.userData.dynamic = true;
      root.position.copy(this.worldPosition(item.x, item.z, 0.092));
      this.world.add(root);
      const pressure = item.mode === 'pressure';
      const status = a.materialInstance('amber', { color: '#d89a43', emissive: '#d89a43', emissiveIntensity: 0.3, roughness: 0.3, toneMapped: false });
      const surface = a.materialInstance('ceramicLight', { color: '#b6a98d', emissive: '#75ffce', emissiveIntensity: 0, roughness: 0.35, metalness: 0.18 });
      a.cylinder(root, pressure ? 0.35 : 0.25, pressure ? 0.38 : 0.29, 0.075, 'joint', 0, 0.035, 0);
      a.ring(root, pressure ? 0.335 : 0.235, 0.018, 'copper', 0, 0.08, 0, true);
      const button = a.cylinder(root, pressure ? 0.28 : 0.185, pressure ? 0.28 : 0.185, 0.05, 'ceramicLight', 0, item.on ? 0.075 : 0.12, 0);
      button.name = 'illuminated pressure surface';
      button.material = surface;
      const light = a.ring(root, pressure ? 0.325 : 0.23, 0.028, 'amber', 0, 0.085, 0, true);
      light.material = status;
      const centerRing = a.ring(button, pressure ? 0.175 : 0.105, 0.01, 'cyan', 0, 0.028, 0, true);
      centerRing.material = status;
      const center = a.cylinder(button, pressure ? 0.042 : 0.03, pressure ? 0.042 : 0.03, 0.008, 'cyan', 0, 0.029, 0, 16);
      center.material = status;
      // Perimeter markers remain visible when a crate completely covers the plate.
      for (let i = 0; i < 4; i++) {
        const marker = a.box(root, 0.1, 0.014, 0.035, 'amber', Math.cos(i * Math.PI / 2) * 0.405, 0.018, Math.sin(i * Math.PI / 2) * 0.405, 0.005);
        marker.rotation.y = -i * Math.PI / 2 + Math.PI / 2;
        marker.material = status;
      }
      const spillMaterial = a.glowMaterial('#75ffce', item.on ? 0.7 : 0);
      const spill = new THREE.Mesh(a.geometry('switch light spill', () => new THREE.PlaneGeometry(1.25, 1.25)), spillMaterial);
      spill.name = 'pressed switch light spill';
      spill.rotation.x = -Math.PI / 2;
      spill.position.y = 0.007;
      spill.renderOrder = 1;
      root.add(spill);
      if (!pressure) {
        a.box(root, 0.08, 0.21, 0.08, 'copper', 0, 0.19, -0.12, 0.012);
        const console = a.box(root, 0.24, 0.15, 0.06, 'navy', 0, 0.31, -0.11, 0.02);
        console.rotation.x = -0.35;
        const screen = a.box(console, 0.16, 0.055, 0.006, 'cyanDim', 0, 0.015, 0.033, 0.008);
        screen.material = status;
        const indicator = a.box(console, 0.1, 0.01, 0.008, 'amber', -0.03, -0.04, 0.035, 0.003);
        indicator.material = status;
      }
      if (item.mode === 'sequence') {
        const sequence = level.sequences?.find(definition => definition.switchIds.includes(item.id));
        const order = (sequence?.switchIds.indexOf(item.id) ?? 0) + 1;
        a.box(root, 0.24, 0.012, 0.17, 'navy', 0, 0.01, 0.3, 0.012);
        const number = a.label(root, String(order), 0.19, 0.15, 0, 0.019, 0.3, '#ebce94');
        number.rotation.x = -Math.PI / 2;
        for (let i = 0; i < order; i++) a.box(root, 0.025, 0.013, 0.025, 'copper', (i - (order - 1) / 2) * 0.06, 0.011, -0.27, 0.006);
      }
      const visual: SwitchVisual = { root, button, light, surface, status, spill, spillMaterial, target: item.on ? 1 : 0, activation: item.on ? 1 : 0 };
      this.switchVisuals.set(item.id, visual);
      this.updateSwitchVisual(visual, 1, 0);
    }
    for (const door of this.state.doors) {
      const root = new THREE.Group();
      root.name = `door:${door.id}`;
      root.userData.dynamic = true;
      root.position.copy(this.worldPosition(door.x, door.z, 0.09));
      this.world.add(root);
      // Frame orientation follows the corridor, so a gate reads as a real obstruction.
      const horizontalWall = level.tiles[door.z]?.[door.x - 1] === '#' || level.tiles[door.z]?.[door.x + 1] === '#';
      if (!horizontalWall) root.rotation.y = Math.PI / 2;
      const status = a.materialInstance('amber', { color: '#d89a43', emissive: '#d89a43', emissiveIntensity: 0.35, roughness: 0.28, toneMapped: false });
      const threshold = a.materialInstance('navy', { color: '#39544e', emissive: '#75ffce', emissiveIntensity: 0.1, roughness: 0.4 });
      const frame = new THREE.Group();
      frame.name = 'solid doorway frame and overhead cassette';
      root.add(frame);
      const signals = new THREE.Group();
      signals.name = 'door status strips on both faces and cassette endcaps';
      root.add(signals);
      for (const side of [-1, 1]) {
        a.box(frame, 0.14, 1.66, 0.34, 'ceramic', side * 0.445, 0.83, 0, 0.025);
        a.box(frame, 0.033, 1.62, 0.17, 'joint', side * 0.374, 0.81, 0, 0.006);
        a.box(frame, 0.026, 1.36, 0.024, 'copper', side * 0.475, 0.79, 0.176, 0.006);
        for (const face of [-1, 1]) {
          const guide = a.box(signals, 0.025, 1.10, 0.014, 'amber', side * 0.427, 0.80, face * 0.177, 0.004);
          guide.material = status;
        }
        const endcap = a.box(signals, 0.014, 0.055, 0.29, 'amber', side * 0.538, 1.80, 0, 0.005);
        endcap.material = status;
      }
      // A physical overhead cassette leaves room for the complete 1.59 m robot.
      // The plaque is inset into its upper face and follows the gate orientation.
      a.box(frame, 1.07, 0.30, 0.44, 'ceramicLight', 0, 1.80, 0, 0.035);
      a.box(frame, 0.77, 0.028, 0.19, 'joint', 0, 1.65, 0, 0.006);
      a.box(frame, 0.60, 0.012, 0.21, 'navy', 0, 1.954, 0, 0.009);
      for (const face of [-1, 1]) {
        a.box(frame, 0.87, 0.105, 0.012, 'navy', 0, 1.80, face * 0.224, 0.008);
        const lintel = a.box(signals, 0.70, 0.028, 0.014, 'amber', 0, 1.80, face * 0.234, 0.005);
        lintel.material = status;
      }
      const shutter = new THREE.Group();
      shutter.name = 'rigid slats retracting into overhead cassette';
      shutter.userData.dynamic = true;
      root.add(shutter);
      const slats: THREE.Mesh[] = [];
      for (let i = 0; i < 7; i++) {
        const slat = a.box(shutter, 0.744, 0.224, 0.12, 'navy', 0, 0.15 + i * 0.229, 0, 0.012);
        slat.name = `rigid shutter slat ${i + 1}`;
        slat.userData.closedY = slat.position.y;
        slats.push(slat);
      }
      for (const face of [-1, 1]) {
        const lock = a.box(slats[3], 0.085, 0.095, 0.014, 'amber', 0, 0, face * 0.069, 0.008);
        lock.material = status;
      }
      const sill = a.box(root, 0.7, 0.014, 0.38, 'navy', 0, 0.011, 0, 0.008);
      sill.material = threshold;
      for (const side of [-1, 1]) {
        const floorLine = a.box(signals, 0.03, 0.017, 0.64, 'amber', side * 0.34, 0.016, 0, 0.005);
        floorLine.material = status;
      }
      // Batch immutable frame pieces and signals separately; moving rigid slats keep
      // their transforms. Geometry is reused by every gate in the current world.
      for (const [parts, key] of [[frame, 'door rigid frame'], [signals, 'door signal strips']] as const) {
        const groups = new Map<THREE.Material, THREE.Mesh[]>();
        parts.children.forEach(object => {
          if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
          const batch = groups.get(object.material) ?? [];
          batch.push(object); groups.set(object.material, batch);
        });
        let index = 0;
        for (const [material, meshes] of groups) {
          const geometry = a.geometry(`${key}:${index++}`, () => {
            const transformed = meshes.map(mesh => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix); });
            const merged = mergeGeometries(transformed, false)!;
            transformed.forEach(item => item.dispose());
            return merged;
          });
          meshes.forEach(mesh => parts.remove(mesh));
          const batch = new THREE.Mesh(geometry, material);
          batch.castShadow = parts === frame;
          batch.receiveShadow = true;
          parts.add(batch);
        }
      }
      const spillMaterial = a.glowMaterial('#75ffce', door.open ? 0.6 : 0);
      const spill = new THREE.Mesh(a.geometry('door light spill', () => new THREE.PlaneGeometry(1.0, 1.15)), spillMaterial);
      spill.name = 'open doorway light spill';
      spill.rotation.x = -Math.PI / 2;
      spill.position.y = 0.018;
      spill.renderOrder = 1;
      root.add(spill);
      if (door.logic === 'or' || door.inverted) {
        // Small engraving belongs to the endcap, rather than a sign floating above it.
        const logicLabel = a.label(root, door.inverted ? 'TERS' : 'VEYA', 0.20, 0.055, 0, 1.864, 0.232, '#e2cfaa');
        logicLabel.name = 'engraved gate logic';
      }
      const openLabel = a.label(root, 'AÇIK', 0.49, 0.13, 0, 1.963, 0, '#85ffcf');
      const closedLabel = a.label(root, 'KAPALI', 0.49, 0.13, 0, 1.963, 0, '#ebbd70');
      openLabel.rotation.x = closedLabel.rotation.x = -Math.PI / 2;
      openLabel.name = 'door state: open';
      closedLabel.name = 'door state: closed';
      const visual: DoorVisual = { root, shutter, slats, status, threshold, spill, spillMaterial, openLabel, closedLabel, target: door.open ? 1 : 0, openness: door.open ? 1 : 0 };
      this.doorVisuals.set(door.id, visual);
      this.updateDoorVisual(visual, 1, 0);
    }
    for (const crate of this.state.crates) {
      const visual = makeCrate(a, crate.kind);
      visual.position.copy(this.worldPosition(crate.x, crate.z, 0.095));
      this.world.add(visual);
      this.crateVisuals.set(crate.id, visual);
    }
    this.robot = makeRobot(a);
    this.robot.root.position.copy(this.worldPosition(this.state.robot.x, this.state.robot.z, 0.12));
    this.robot.root.rotation.y = (2 - this.state.robot.facing) * Math.PI / 2;
    this.targetRobot.copy(this.robot.root.position);
    this.lastRobot.copy(this.robot.root.position);
    this.world.add(this.robot.root);

    const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#25302e', transparent: true, opacity: 0.16, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.008;
    shadow.scale.y = 0.72;
    shadow.name = 'robot contact shadow';
    this.robot.root.add(shadow);
    this.makeDust(w, h);
    // Added after the static merge: cloth, branches and weather keep their own transforms.
    this.atmosphere = new GardenAtmosphere(this.world, this.assets, level, {
      quality: this.quality, reducedMotion: this.reducedMotion,
      onChange: snapshot => {
        setAtmosphere({ rain: snapshot.rain, wind: snapshot.wind, visible: this.visible });
        if (this.elapsed - this.lastAtmospherePublish >= 1) {
          this.lastAtmospherePublish = this.elapsed;
          this.onAtmosphereChange?.(snapshot);
        }
      },
    });
    this.atmosphere.setWeather(this.weatherMode);
    this.updateAccessibleState();
    this.resize();
  }

  private updateAccessibleState(): void {
    const activeSwitches = this.state.switches.filter(item => item.on).length;
    const openDoors = this.state.doors.filter(item => item.open).length;
    this.canvas.setAttribute('aria-label', `NOEMA robotunun üç boyutlu eğitim bahçesi. ${activeSwitches}/${this.state.switches.length} düğme etkin. ${openDoors}/${this.state.doors.length} kapı açık.`);
  }

  private makeSurfaces(level: Level): void {
    const a = this.assets;
    const surfaces = level.surfaces ?? [];
    for (const surface of surfaces) {
      const root = new THREE.Group();
      root.position.copy(this.worldPosition(surface.x, surface.z));
      this.world.add(root);
      if (surface.kind === 'ice') {
        a.box(root, 0.91, 0.016, 0.91, 'glass', 0, 0.099, 0, 0.006);
        for (let i = 0; i < 3; i++) {
          const scratch = a.box(root, 0.011, 0.004, 0.22 + i * 0.09, 'cyanDim', -0.25 + i * 0.24, 0.11, (i % 2 - 0.5) * 0.2, 0.001);
          scratch.rotation.y = 0.55;
        }
        for (const side of [-1, 1]) a.box(root, 0.08, 0.008, 0.025, 'cyan', side * 0.34, 0.111, side * 0.34, 0.003);
      } else {
        root.rotation.y = -(surface.direction ?? 0) * Math.PI / 2;
        a.box(root, 0.9, 0.025, 0.9, 'navy', 0, 0.1, 0, 0.012);
        for (const side of [-1, 1]) a.box(root, 0.045, 0.025, 0.88, 'copper', side * 0.42, 0.12, 0, 0.006);
        for (let i = 0; i < 5; i++) {
          const roller = a.cylinder(root, 0.018, 0.018, 0.76, 'joint', 0, 0.117, -0.32 + i * 0.16, 10);
          roller.rotation.z = Math.PI / 2;
        }
        const arrows = new THREE.Group();
        arrows.userData.dynamic = true;
        root.add(arrows);
        for (let i = 0; i < 3; i++) {
          const geometry = a.geometry('conveyor-direction-chevron', () => {
            const shape = new THREE.Shape();
            shape.moveTo(0, 0.1); shape.lineTo(-0.14, -0.04); shape.lineTo(-0.12, -0.07); shape.lineTo(0, 0.05); shape.lineTo(0.12, -0.07); shape.lineTo(0.14, -0.04); shape.closePath();
            return new THREE.ShapeGeometry(shape);
          });
          const arrow = new THREE.Mesh(geometry, a.material('amber'));
          arrow.rotation.x = -Math.PI / 2;
          arrow.position.y = 0.143;
          arrow.position.z = -0.25 + i * 0.25;
          arrow.userData.baseZ = arrow.position.z;
          arrows.add(arrow);
        }
        this.conveyors.push(arrows);
      }
    }
  }

  private mergeStaticGeometry(): void {
    // Architecture uses hundreds of little construction details, but only a handful
    // of render calls. Articulated gameplay objects are added after this static pass.
    const groups = new Map<string, THREE.Mesh[]>();
    this.world.updateMatrixWorld(true);
    this.world.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.material.transparent) return;
      for (let ancestor: THREE.Object3D | null = object; ancestor && ancestor !== this.world; ancestor = ancestor.parent) if (ancestor.userData.dynamic) return;
      const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
      const group = groups.get(key) ?? [];
      group.push(object);
      groups.set(key, group);
    });
    let index = 0;
    groups.forEach(meshes => {
      if (meshes.length < 2) return;
      const parts = meshes.map(mesh => {
        const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        part.applyMatrix4(mesh.matrixWorld);
        return part;
      });
      const merged = mergeGeometries(parts, false);
      parts.forEach(part => part.dispose());
      if (!merged) return;
      const geometry = this.assets.geometry(`static-merged-${index++}`, () => merged);
      const combined = new THREE.Mesh(geometry, meshes[0].material);
      combined.castShadow = meshes[0].castShadow;
      combined.receiveShadow = meshes[0].receiveShadow;
      combined.name = 'research campus static architecture';
      meshes.forEach(mesh => mesh.removeFromParent());
      this.world.add(combined);
    });
  }

  private makeWall(p: THREE.Vector3, variation: number): void {
    const a = this.assets;
    const front = p.z > this.state.level.height / 2 - 1;
    const side = Math.abs(p.x) > this.state.level.width / 2 - 1;
    const height = front ? 0.24 : side ? 0.43 : 0.64;
    a.box(this.world, 0.945, height, 0.945, 'sand', p.x, 0.085 + height / 2, p.z, 0.055);
    a.box(this.world, 0.96, 0.085, 0.96, 'ceramicLight', p.x, 0.12 + height, p.z, 0.025);
    a.box(this.world, 0.8, 0.025, 0.015, 'navy', p.x, 0.085 + height * 0.5, p.z + 0.48, 0.006);
    if (variation === 0 && !front) {
      a.box(this.world, 0.32, 0.09, 0.018, 'navy', p.x, 0.085 + height * 0.77, p.z + 0.48, 0.008);
      a.box(this.world, 0.2, 0.017, 0.008, 'cyanDim', p.x, 0.09 + height * 0.77, p.z + 0.492, 0.003);
    }
  }

  private makePortal(p: THREE.Vector3): void {
    const a = this.assets;
    const group = new THREE.Group();
    group.position.copy(p);
    this.world.add(group);
    a.cylinder(group, 0.42, 0.46, 0.1, 'navy', 0, 0.14, 0, 32);
    a.ring(group, 0.365, 0.025, 'cyan', 0, 0.195, 0, true);
    a.ring(group, 0.46, 0.075, 'ceramic', 0, 0.7, -0.12);
    a.ring(group, 0.405, 0.027, 'copper', 0, 0.7, -0.104);
    const halo = a.ring(group, 0.365, 0.018, 'cyan', 0, 0.7, -0.09);
    this.portalRings.push(halo);
    const inner = a.ring(group, 0.3, 0.007, 'cyanDim', 0, 0.7, -0.075);
    this.portalRings.push(inner);
    const glass = a.cylinder(group, 0.355, 0.355, 0.008, 'glass', 0, 0.7, -0.11, 48);
    glass.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      a.box(group, 0.15, 0.43, 0.22, 'navy', side * 0.38, 0.34, -0.12);
      a.box(group, 0.045, 0.19, 0.02, 'cyan', side * 0.38, 0.38, 0.005, 0.008);
    }
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      const particle = a.sphere(group, 0.012 + i % 2 * 0.007, 'cyan', Math.cos(angle) * 0.27, 0.7 + Math.sin(angle) * 0.27, -0.055);
      particle.userData.angle = angle;
      this.portalParticles.push(particle);
    }
  }

  private makeArchitecture(w: number, h: number): void {
    const a = this.assets, hw = w / 2, hh = h / 2;
    // The playable courtyard sits inside a substantially larger floating research campus.
    a.box(this.world, w + 3.6, 0.38, h + 3.5, 'sand', 0, -0.36, 0, 0.16);
    a.box(this.world, w + 3.1, 0.23, h + 3.0, 'navy', 0, -0.65, 0, 0.1);
    a.box(this.world, w + 2.2, 0.2, h + 2.2, 'copper', 0, -0.81, 0, 0.09);
    a.box(this.world, w + 1.9, 0.38, h + 1.9, 'stone', 0, -1.03, 0, 0.13);
    // Recessed foundation must stay below the pale surround. Previously both
    // tops were y=-.05, making opaque dark/pale triangles fight for the same depth.
    const foundation = a.box(this.world, w + 1.22, 0.12, h + 1.22, 'stone', 0, -0.16, 0, 0.05);
    foundation.name = 'recessed courtyard foundation';
    // Thin pale stone perimeter and inset guidance lights.
    for (const side of [-1, 1]) {
      a.box(this.world, w + 2.2, 0.08, 0.54, 'ceramic', 0, -0.09, side * (hh + 0.52), 0.035);
      a.box(this.world, 0.54, 0.08, h + 1.1, 'ceramic', side * (hw + 0.52), -0.09, 0, 0.035);
      a.box(this.world, w + 2.8, 0.018, 0.025, 'cyanDim', 0, -0.38, side * (hh + 1.76), 0.004);
    }
    // Broad suspended steps make the island feel like a place, rather than a board.
    for (let i = 0; i < 3; i++) a.box(this.world, 2.4 + i * 0.35, 0.16, 0.55, i === 1 ? 'sand' : 'ceramic', -hw * 0.52, -0.15 - i * 0.16, hh + 1.55 + i * 0.42, 0.04);
    a.box(this.world, w + 3.1, 0.22, 1.6, 'ceramic', 0, 0.04, -hh - 1.35, 0.06);
    a.box(this.world, w + 4.4, 0.22, 1.8, 'sand', 0, 0.29, -hh - 2.2, 0.07);

    const back = new THREE.Group();
    back.position.z = -hh - 2.35;
    this.world.add(back);
    a.box(back, w + 3.7, 1.9, 0.35, 'rose', 0, 1.35, -0.38, 0.07);
    a.box(back, w + 4.2, 0.3, 1.4, 'ceramic', 0, 2.56, 0, 0.09);
    a.box(back, w + 4.5, 0.11, 1.62, 'sand', 0, 2.76, 0, 0.04);
    a.box(back, w + 2.8, 0.05, 0.05, 'cyanDim', 0, 2.39, 0.67, 0.01);
    const columnCount = Math.max(4, Math.ceil(w / 2));
    for (let i = 0; i <= columnCount; i++) {
      const x = -hw - 1.35 + i * (w + 2.7) / columnCount;
      a.box(back, 0.32, 2.2, 0.5, 'ceramic', x, 1.34, 0.23, 0.045);
      a.box(back, 0.48, 0.16, 0.63, 'sand', x, 0.34, 0.23, 0.035);
      a.box(back, 0.4, 0.14, 0.6, 'sand', x, 2.3, 0.23, 0.025);
      a.box(back, 0.04, 1.6, 0.018, 'copper', x + 0.11, 1.4, 0.49, 0.005);
      if (i < columnCount) {
        const center = x + (w + 2.7) / columnCount / 2;
        a.box(back, (w + 2.7) / columnCount - 0.55, 1.25, 0.04, 'navy', center, 1.35, -0.16, 0.025);
        a.box(back, (w + 2.7) / columnCount - 0.73, 0.68, 0.025, 'glass', center, 1.5, -0.125, 0.01);
        for (let j = 0; j < 3; j++) a.box(back, 0.35, 0.018, 0.02, j === 0 ? 'cyanDim' : 'copper', center, 0.94 + j * 0.12, -0.122, 0.004);
      }
    }
    const specimen = makeCrate(a, 'amber');
    specimen.position.set(hw + 1.05, -0.13, hh - 0.65);
    specimen.rotation.y = -0.18;
    specimen.scale.setScalar(0.88);
    this.world.add(specimen);
    const spare = makeCrate(a, 'cyan');
    spare.position.set(hw + 1.08, -0.13, hh - 1.4);
    spare.rotation.y = 0.13;
    spare.scale.setScalar(0.72);
    this.world.add(spare);
    a.box(back, 3.3, 0.42, 0.1, 'navy', -0.1, 2.63, 0.76, 0.035);
    a.label(back, 'NOEMA INC  /  LEARNING GARDEN', 3.1, 0.36, -0.1, 2.65, 0.818);
    // A slim side pavilion carries practical equipment and warm copper pipework.
    const service = new THREE.Group();
    service.position.set(-hw - 1.35, 0, -hh * 0.45);
    this.world.add(service);
    a.box(service, 0.7, 1.33, 1.5, 'navy', 0, 0.56, 0, 0.055);
    a.box(service, 0.83, 0.12, 1.65, 'ceramic', 0, 1.3, 0, 0.035);
    a.box(service, 0.06, 0.93, 1.28, 'sand', 0.38, 0.67, 0, 0.025);
    for (let i = 0; i < 5; i++) a.box(service, 0.04, 0.04, 0.9, 'joint', 0.416, 0.45 + i * 0.12, 0, 0.008);
    for (const z of [-0.4, 0.4]) {
      a.cylinder(service, 0.09, 0.09, 0.85, 'copper', -0.44, 0.52, z, 12);
      a.ring(service, 0.1, 0.018, 'cyanDim', -0.44, 0.3, z, true);
      a.ring(service, 0.1, 0.018, 'copper', -0.44, 0.8, z, true);
    }
    a.tube(this.world, [new THREE.Vector3(-hw - 1.2, 0.12, -hh * 0.45 + 0.8), new THREE.Vector3(-hw - 0.85, 0.12, 0), new THREE.Vector3(-hw - 0.85, 0.12, hh + 0.4), new THREE.Vector3(-hw * 0.5, 0.12, hh + 0.6)], 0.033, 'joint');
    for (const side of [-1, 1]) {
      this.world.add(makePlant(a, side * (hw + 1.2), hh + 0.6, 0.85));
      // Low cylindrical beacons retain clean sightlines into the playable courtyard.
      for (let z = -hh + 0.7; z < hh; z += 2.5) {
        a.cylinder(this.world, 0.055, 0.08, 0.43, 'navy', side * (hw + 1.5), 0.11, z, 12);
        a.cylinder(this.world, 0.052, 0.052, 0.07, 'white', side * (hw + 1.5), 0.35, z, 12);
      }
    }
    makeResearchDistrict(this.world, a, w, h);
    makeObservationCameras(this.world, a, w, h);
  }

  private makeDust(w: number, h: number): void {
    const count = 45;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.sin(i * 72.31) * (w + 3);
      positions[i * 3 + 1] = 0.2 + (Math.sin(i * 31.8) * 0.5 + 0.5) * 3.6;
      positions[i * 3 + 2] = Math.cos(i * 27.17) * (h + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffe5bc', size: 0.035, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true }));
    this.world.add(this.dust);
  }

  private applyClimate(climate: AtmosphereSnapshot): void {
    const cloud = climate.cloudCover;
    const sunlight = climate.sunlight;
    this.sun.intensity = 0.75 + sunlight * 3.65;
    this.sun.color.copy(this.rainSun).lerp(this.clearSun, sunlight);
    this.skylight.intensity = 2.35 - sunlight * 0.35;
    this.skylight.color.set(sunlight > 0.45 ? '#c8e5f1' : '#d0e0e5');
    this.renderer.toneMappingExposure = 0.99 + sunlight * 0.11;
    this.sunlightMask.uniforms.noemaSunTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.sunlightMask.uniforms.noemaCloudShade.value = cloud * (1 - climate.rain) * 0.9;
    if (this.dust) (this.dust.material as THREE.PointsMaterial).opacity = 0.08 + sunlight * 0.52;
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.clearFog).lerp(this.rainFog, cloud);
    const wet = climate.wetness;
    this.assets.material('ceramic').roughness = 0.47 - wet * 0.23;
    this.assets.material('ceramic').metalness = 0.14 + wet * 0.14;
    this.assets.material('ceramicLight').roughness = 0.31 - wet * 0.12;
    this.assets.material('sand').roughness = 0.74 - wet * 0.22;
    this.assets.material('navy').roughness = 0.43 - wet * 0.13;
    if (Math.abs(cloud - this.skyCloudiness) < 0.035 && Math.abs(sunlight - this.skySunlight) < 0.035) return;
    this.skyCloudiness = cloud;
    this.skySunlight = sunlight;
    const ctx = this.skyContext;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    const clear = ['#86b6cf', '#bcd5d6', '#f1dcc0', '#f3e4cb'];
    const rain = ['#657985', '#85979e', '#acb7b5', '#bfc4b9'];
    const stops = [0, 0.38, 0.72, 1];
    for (let i = 0; i < stops.length; i++) gradient.addColorStop(stops[i], new THREE.Color(clear[i]).lerp(new THREE.Color(rain[i]), cloud).getStyle());
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    const haze = ctx.createRadialGradient(80, 180, 2, 80, 180, 280);
    haze.addColorStop(0, `rgba(255,225,157,${0.82 * sunlight})`);
    haze.addColorStop(1, 'rgba(255,238,208,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, 512, 512);
    this.skyTexture.needsUpdate = true;
  }

  private updateSwitchVisual(visual: SwitchVisual, blend: number, time: number): void {
    visual.activation = THREE.MathUtils.lerp(visual.activation, visual.target, blend);
    const active = visual.activation;
    const breathe = this.reducedMotion ? 1 : 0.94 + Math.sin(time * 2.3) * 0.06;
    visual.button.position.y = 0.12 - active * 0.045;
    visual.surface.color.copy(this.inactivePlate).lerp(this.activePlate, active);
    visual.surface.emissiveIntensity = active * 1.65 * breathe;
    visual.status.color.copy(this.inactiveSignal).lerp(this.activeSignal, active);
    visual.status.emissive.copy(visual.status.color);
    visual.status.emissiveIntensity = 0.3 + active * 1.7 * breathe;
    visual.spillMaterial.opacity = active * 0.78 * breathe;
    visual.spill.scale.setScalar(1 + active * 0.1);
    visual.root.userData.pressed = visual.target === 1;
  }

  private updateDoorVisual(visual: DoorVisual, blend: number, time: number): void {
    visual.openness = THREE.MathUtils.lerp(visual.openness, visual.target, blend);
    const open = visual.openness;
    const breathe = this.reducedMotion ? 1 : 0.96 + Math.sin(time * 2.3) * 0.04;
    for (const slat of visual.slats) {
      slat.position.y = Number(slat.userData.closedY) + open * 1.68;
      // Once its lower edge is inside the solid cassette, the rigid segment is hidden.
      // No geometry stretches, shrinks, or peeks through the top of the housing.
      slat.visible = slat.position.y - 0.112 < 1.65;
    }
    visual.shutter.visible = visual.slats.some(slat => slat.visible);
    visual.status.color.copy(this.inactiveSignal).lerp(this.activeSignal, open);
    visual.status.emissive.copy(visual.status.color);
    visual.status.emissiveIntensity = 0.35 + open * 1.05;
    visual.threshold.emissiveIntensity = 0.015 + open * 0.68;
    visual.spillMaterial.opacity = open * 0.55 * breathe;
    visual.openLabel.visible = open > 0.8;
    visual.closedLabel.visible = open <= 0.8;
    visual.root.userData.open = visual.target === 1;
  }

  update(state: GameState): void {
    if (this.disposed) return;
    const changedLevel = state.level !== this.state.level && (state.level.id !== this.state.level.id || state.level.tiles.join('') !== this.state.level.tiles.join(''));
    const solvedNow = state.solved && !this.state.solved;
    this.state = state;
    if (changedLevel) {
      this.clearWorld();
      this.assets = new StudioAssets();
      this.world = new THREE.Group();
      this.scene.add(this.world);
      this.build(state.level);
    }
    this.targetRobot.copy(this.worldPosition(state.robot.x, state.robot.z, 0.12));
    for (const door of state.doors) {
      const visual = this.doorVisuals.get(door.id);
      if (!visual) continue;
      visual.target = door.open ? 1 : 0;
      if (this.reducedMotion) this.updateDoorVisual(visual, 1, this.elapsed);
    }
    for (const item of state.switches) {
      const visual = this.switchVisuals.get(item.id);
      if (!visual) continue;
      visual.target = item.on ? 1 : 0;
      if (this.reducedMotion) this.updateSwitchVisual(visual, 1, this.elapsed);
    }
    if (solvedNow) this.celebrate = 1;
    this.updateAccessibleState();
  }

  resize(): void {
    if (this.disposed) return;
    this.hasPresentedFrame = false;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.cameraAspect = width / height;
    this.updateCamera(1);
    // setSize clears the drawing buffer. Present the fitted scene immediately,
    // including fullscreen/orientation changes, instead of exposing a blank sky
    // until the next animation frame on a busy phone.
    this.renderer.render(this.scene, this.camera);
    this.hasPresentedFrame = true;
  }

  setCameraView(view: CameraView): void {
    this.cameraView = view;
    if (this.reducedMotion || this.trainingPaused) this.updateCamera(1);
    if (this.trainingPaused) this.renderer.render(this.scene, this.camera);
  }

  /** Fit the actual courtyard envelope at every angle, including wide rooms. */
  private updateCamera(blend: number): void {
    const view = CAMERA_VIEWS[this.cameraView];
    this.cameraAzimuth = THREE.MathUtils.lerp(this.cameraAzimuth, THREE.MathUtils.degToRad(view.azimuth), blend);
    this.cameraElevation = THREE.MathUtils.lerp(this.cameraElevation, THREE.MathUtils.degToRad(view.elevation), blend);
    const { width: w, height: h } = this.state.level;
    const distance = (Math.max(w, h) + 11) * 1.55;
    const horizontal = distance * Math.cos(this.cameraElevation);
    this.camera.position.set(horizontal * Math.sin(this.cameraAzimuth), distance * Math.sin(this.cameraElevation), horizontal * Math.cos(this.cameraAzimuth));
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld(true);
    let halfWidth = 0, halfHeight = 0;
    // Scene decoration extends behind the court. The distant city does not
    // influence framing: controls always retain a readable playable arena.
    for (const x of [-w / 2 - 1.8, w / 2 + 1.8])
      for (const y of [-1.3, 3.1])
        for (const z of [-h / 2 - 3.25, h / 2 + 2.5]) {
          this.cameraFraming.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
          halfWidth = Math.max(halfWidth, Math.abs(this.cameraFraming.x));
          halfHeight = Math.max(halfHeight, Math.abs(this.cameraFraming.y));
        }
    const vertical = Math.max(halfHeight * 2, halfWidth * 2 / Math.max(this.cameraAspect, 0.1)) * 1.05;
    this.cameraVertical = THREE.MathUtils.lerp(this.cameraVertical, vertical, blend);
    this.camera.left = -this.cameraVertical * this.cameraAspect / 2;
    this.camera.right = this.cameraVertical * this.cameraAspect / 2;
    this.camera.top = this.cameraVertical / 2;
    this.camera.bottom = -this.cameraVertical / 2;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: 'high' | 'balanced'): void {
    this.quality = quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.35));
    const mapSize = quality === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.dust) this.dust.visible = quality === 'high';
    this.atmosphere?.setQuality(quality);
    this.resize();
  }

  setWeather(mode: WeatherMode): void { this.weatherMode = mode; this.atmosphere?.setWeather(mode); }
  getAtmosphere(): AtmosphereSnapshot { return this.atmosphere?.getSnapshot() ?? { phase: 'clear', rain: 0, wind: 0.4, cloudCover: 0, wetness: 0, sunlight: 1, mode: this.weatherMode }; }

  /** A new trial is placed before its first visible frame; normal moves still interpolate. */
  beginTrial(state: GameState): void {
    this.hasPresentedFrame = false;
    this.update(state);
    this.robot.root.position.copy(this.targetRobot);
    this.lastRobot.copy(this.targetRobot);
    this.robot.root.rotation.y = (2 - state.robot.facing) * Math.PI / 2;
    this.robot.body.position.y = 0;
    this.walking = 0;
    for (const crate of state.crates) {
      const visual = this.crateVisuals.get(crate.id);
      if (visual) { visual.position.copy(this.worldPosition(crate.x, crate.z, 0.095)); visual.rotation.y = 0; }
    }
    this.doorVisuals.forEach(door => this.updateDoorVisual(door, 1, this.elapsed));
    this.switchVisuals.forEach(item => this.updateSwitchVisual(item, 1, this.elapsed));
  }

  /** AI decisions wait for the same visible movement and facing used by human play. */
  isReadyForAction(): boolean {
    if (this.disposed || this.trainingPaused || !this.visible || !this.hasPresentedFrame) return false;
    const desiredYaw = (2 - this.state.robot.facing) * Math.PI / 2;
    const turn = Math.atan2(Math.sin(desiredYaw - this.robot.root.rotation.y), Math.cos(desiredYaw - this.robot.root.rotation.y));
    return this.robot.root.position.distanceToSquared(this.targetRobot) < 0.025 ** 2 && Math.abs(turn) < 0.05;
  }

  setTrainingPaused(paused: boolean): void {
    if (this.disposed || this.trainingPaused === paused) return;
    this.trainingPaused = paused;
    this.previousTime = 0;
    // Preserve a complete static frame when training begins or a view is recreated.
    if (paused) this.renderer.render(this.scene, this.camera);
  }

  focusRobot(): void { this.focus = 1; }

  private animate = (timestamp: number): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    if (!this.visible || this.trainingPaused) return;
    if (this.quality === 'balanced' && this.previousTime && timestamp - this.previousTime < 31) return;
    const dt = this.previousTime ? Math.min((timestamp - this.previousTime) / 1000, 0.05) : 1 / 60;
    this.previousTime = timestamp;
    this.elapsed += dt;
    const t = this.elapsed;
    const climate = this.atmosphere?.update(dt, t);
    if (climate) this.applyClimate(climate);
    const root = this.robot.root;
    this.lastRobot.copy(root.position);
    const smooth = 1 - Math.exp(-dt * 16);
    root.position.lerp(this.targetRobot, smooth);
    const moving = Math.hypot(root.position.x - this.lastRobot.x, root.position.z - this.lastRobot.z) / Math.max(dt, 0.001);
    this.walking = THREE.MathUtils.lerp(this.walking, Math.min(1, moving / 2), 1 - Math.exp(-dt * 10));
    const desiredYaw = (2 - this.state.robot.facing) * Math.PI / 2;
    const angle = Math.atan2(Math.sin(desiredYaw - root.rotation.y), Math.cos(desiredYaw - root.rotation.y));
    root.rotation.y += angle * smooth;
    const stride = Math.sin(t * 15) * this.walking;
    const carrying = this.state.robot.carrying !== null;
    const carryWeight = carrying ? 1 : 0;
    const motion = this.reducedMotion ? 0 : 1;
    this.robot.body.position.y = motion * (Math.abs(stride) * 0.028 + Math.sin(t * 2.4) * 0.007);
    this.robot.body.rotation.z = stride * 0.025 * motion;
    const cameraYaw = Math.atan2(this.camera.position.x - root.position.x, this.camera.position.z - root.position.z);
    const eyeContact = Math.atan2(Math.sin(cameraYaw - root.rotation.y), Math.cos(cameraYaw - root.rotation.y));
    const headTarget = THREE.MathUtils.clamp(eyeContact, -1.04, 1.04) * (1 - this.walking) + Math.sin(t * 0.7) * 0.035 * motion;
    this.robot.head.rotation.y = THREE.MathUtils.lerp(this.robot.head.rotation.y, headTarget, 1 - Math.exp(-dt * 3.5));
    this.robot.head.rotation.z = Math.sin(t * 0.9) * 0.022 * motion;
    this.robot.hips.forEach((hip, i) => {
      const phase = i === 0 ? stride : -stride;
      hip.rotation.x = phase * 0.52 * motion;
      this.robot.knees[i].rotation.x = Math.max(0, -phase) * 0.64 * motion;
      const shoulderTarget = -carryWeight * 1.08 - phase * 0.38 * (1 - carryWeight) * motion;
      this.robot.shoulders[i].rotation.x = THREE.MathUtils.lerp(this.robot.shoulders[i].rotation.x, shoulderTarget, smooth);
      this.robot.shoulders[i].rotation.z = (i === 0 ? 1 : -1) * (0.09 - carryWeight * 0.12);
      this.robot.elbows[i].rotation.x = THREE.MathUtils.lerp(this.robot.elbows[i].rotation.x, carrying ? -0.6 : -0.06, smooth);
    });
    const blink = t % 5.1 > 4.94 ? 0.12 : 1;
    this.robot.eyes.forEach(eye => { eye.scale.y = blink; });
    for (const crate of this.state.crates) {
      const visual = this.crateVisuals.get(crate.id);
      if (!visual) continue;
      if (crate.id === this.state.robot.carrying) {
        const yaw = root.rotation.y;
        const x = root.position.x + Math.sin(yaw) * 0.37;
        const z = root.position.z + Math.cos(yaw) * 0.37;
        visual.position.x = THREE.MathUtils.lerp(visual.position.x, x, smooth);
        visual.position.y = THREE.MathUtils.lerp(visual.position.y, 0.66 + this.robot.body.position.y, smooth);
        visual.position.z = THREE.MathUtils.lerp(visual.position.z, z, smooth);
        visual.rotation.y = root.rotation.y;
      } else {
        this.crateTarget.set(crate.x - (this.state.level.width - 1) / 2, 0.095, crate.z - (this.state.level.height - 1) / 2);
        visual.position.lerp(this.crateTarget, smooth);
        visual.rotation.y = THREE.MathUtils.lerp(visual.rotation.y, 0, smooth);
      }
    }
    this.doorVisuals.forEach(door => this.updateDoorVisual(door, smooth, t));
    this.switchVisuals.forEach(item => this.updateSwitchVisual(item, smooth, t));
    this.conveyors.forEach(arrows => arrows.children.forEach(arrow => { arrow.position.z = ((Number(arrow.userData.baseZ) - (this.reducedMotion ? 0 : t * 0.25) + 0.375) % 0.75 + 0.75) % 0.75 - 0.375; }));
    this.portalRings.forEach((ring, i) => {
      const s = 1 + Math.sin(t * 2.2 + i) * 0.015 * motion + this.celebrate * 0.06;
      ring.scale.setScalar(s);
    });
    this.portalParticles.forEach((particle, i) => {
      const angle = Number(particle.userData.angle) + t * 0.3 * motion;
      particle.position.x = Math.cos(angle) * (0.265 + Math.sin(t + i) * 0.02);
      particle.position.y = 0.7 + Math.sin(angle) * 0.265;
    });
    this.celebrate = Math.max(0, this.celebrate - dt * 0.22);
    if (this.dust && motion) this.dust.rotation.y = Math.sin(t * 0.035) * 0.035;
    if (this.focus > 0.001) {
      this.focus *= Math.exp(-dt * 0.6);
      this.cameraTarget.set(root.position.x * 0.12 * this.focus, 0.65, -0.3 + root.position.z * 0.12 * this.focus);
    }
    this.updateCamera(this.reducedMotion ? 1 : 1 - Math.exp(-dt * 6));
    this.renderer.render(this.scene, this.camera);
    this.hasPresentedFrame = true;
  };

  private clearWorld(): void {
    this.atmosphere?.dispose();
    this.atmosphere = null;
    this.scene.remove(this.world);
    this.world.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      if (object.name === 'robot contact shadow' || object === this.dust) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    this.assets.dispose();
    this.crateVisuals.clear();
    this.doorVisuals.clear();
    this.switchVisuals.clear();
    this.portalRings = [];
    this.portalParticles = [];
    this.dust = null;
    this.conveyors = [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setAtmosphere({ rain: 0, wind: 0, visible: false });
    cancelAnimationFrame(this.frameId);
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.loseContext);
    this.canvas.removeEventListener('webglcontextrestored', this.restoreContext);
    this.clearWorld();
    this.sun.shadow.map?.dispose();
    this.skyTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

export default GameScene;
