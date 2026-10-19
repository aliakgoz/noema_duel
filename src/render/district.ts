import * as THREE from 'three';
import { StudioAssets, type Finish } from './objects';

interface BuildingSpec { x: number; z: number; width: number; depth: number; height: number; base: number; index: number; far?: boolean }

/** An authored civic district. All decoration is static and owned by StudioAssets. */
export function makeResearchDistrict(parent: THREE.Group, assets: StudioAssets, width: number, depth: number): THREE.Group {
  const district = new THREE.Group();
  district.name = 'NOEMA INC layered research district';
  parent.add(district);
  const halfDepth = depth / 2;
  const cityWidth = width + 21;
  const glaze = assets.materialInstance('navy', { color: '#426765', emissive: '#769b88', emissiveIntensity: 0.055, roughness: 0.34, metalness: 0.32 });
  const litGlass = assets.materialInstance('amber', { color: '#cbb98c', emissive: '#e3c592', emissiveIntensity: 0.17, roughness: 0.38, metalness: 0.18 });
  const box = (target: THREE.Object3D, w: number, h: number, d: number, finish: Finish, x = 0, y = 0, z = 0, bevel = 0) => assets.box(target, w, h, d, finish, x, y, z, bevel);
  const window = (target: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, lit = false) => {
    const mesh = box(target, w, h, d, 'navy', x, y, z);
    mesh.material = lit ? litGlass : glaze;
    return mesh;
  };
  const roofGarden = (target: THREE.Object3D, x: number, y: number, z: number, span = 1.1) => {
    box(target, span, 0.16, 0.42, 'ceramic', x, y, z, 0.025);
    box(target, span - 0.1, 0.022, 0.31, 'soil', x, y + 0.09, z);
    const geometry = assets.geometry('district clustered foliage', () => new THREE.IcosahedronGeometry(0.22, 1));
    for (let i = 0; i < 5; i++) {
      const leaves = new THREE.Mesh(geometry, assets.material(i % 2 ? 'leafLight' : 'leaf'));
      leaves.position.set(x - span * 0.35 + i * span * 0.175, y + 0.22 + (i % 2) * 0.07, z);
      leaves.scale.set(1, 0.7 + (i % 3) * 0.17, 0.8);
      target.add(leaves);
    }
  };
  const railing = (target: THREE.Object3D, span: number, x: number, y: number, z: number) => {
    box(target, span, 0.035, 0.035, 'copper', x, y + 0.36, z);
    box(target, span, 0.018, 0.025, 'sand', x, y + 0.16, z);
    const count = Math.ceil(span / 0.65);
    for (let i = 0; i <= count; i++) box(target, 0.035, 0.38, 0.035, 'ceramic', x - span / 2 + i * span / count, y + 0.18, z);
  };
  const arcadeGeometry = assets.geometry('district true arch arcade', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.65, 0); shape.lineTo(-0.65, 1.85); shape.lineTo(0.65, 1.85); shape.lineTo(0.65, 0);
    shape.lineTo(0.46, 0); shape.lineTo(0.46, 0.98);
    shape.absarc(0, 0.98, 0.46, 0, Math.PI, false);
    shape.lineTo(-0.46, 0); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 1, curveSegments: 10 });
    geometry.translate(0, 0, -0.15);
    return geometry;
  });
  const arcade = (target: THREE.Object3D, x: number, y: number, z: number) => {
    const arch = new THREE.Mesh(arcadeGeometry, assets.material('ceramic'));
    arch.position.set(x, y, z); target.add(arch);
    box(target, 0.15, 0.055, 0.36, 'copper', x - 0.53, y + 0.96, z);
    box(target, 0.15, 0.055, 0.36, 'copper', x + 0.53, y + 0.96, z);
  };

  const makeBuilding = (target: THREE.Object3D, spec: BuildingSpec) => {
    const building = new THREE.Group();
    building.name = `district ${spec.far ? 'horizon' : 'terrace'} tower ${spec.index + 1}`;
    building.position.set(spec.x, spec.base, spec.z);
    target.add(building);
    const { width: w, depth: d, height: h, index } = spec;
    const finish: Finish = index % 3 === 0 ? 'rose' : index % 3 === 1 ? 'ceramic' : 'sand';
    box(building, w + 0.28, 0.2, d + 0.28, 'stone', 0, 0.1, 0, 0.025);
    box(building, w, h, d, finish, 0, h / 2 + 0.2, 0, 0.035);
    const rows = Math.max(3, Math.floor(h / 0.61)), columns = w > 2 ? 3 : 2;
    const usableWidth = w - 0.28, rowHeight = (h - 0.36) / rows;
    // Actual inset panels and raised piers, visible from either side camera.
    for (let side = 0; side < 3; side++) {
      const face = new THREE.Group();
      if (side === 0) face.position.z = d / 2 + 0.012;
      else { face.position.x = (side === 1 ? 1 : -1) * (w / 2 + 0.012); face.rotation.y = (side === 1 ? 1 : -1) * Math.PI / 2; }
      building.add(face);
      const faceWidth = side === 0 ? usableWidth : d - 0.27;
      const faceColumns = side === 0 ? columns : 2;
      window(face, faceWidth, h - 0.34, 0.018, 0, h / 2 + 0.2, 0);
      for (let row = 0; row < rows; row++) {
        const y = 0.38 + rowHeight * (row + 0.5);
        for (let col = 0; col < faceColumns; col++) {
          const paneWidth = faceWidth / faceColumns - 0.09;
          const x = -faceWidth / 2 + faceWidth / faceColumns * (col + 0.5);
          window(face, paneWidth, rowHeight * 0.66, 0.025, x, y, 0.025, (row * 11 + col * 3 + index * 7 + side) % 9 === 0);
          if (!spec.far && row % 2 === 1) box(face, paneWidth + 0.06, 0.045, 0.14, 'ceramicLight', x, y - rowHeight * 0.37, 0.055);
        }
        box(face, faceWidth + 0.08, 0.055, 0.07, finish, 0, y + rowHeight * 0.47, 0.03);
      }
      for (let col = 0; col <= faceColumns; col++) box(face, 0.055, h - 0.2, 0.085, 'ceramic', -faceWidth / 2 + col * faceWidth / faceColumns, h / 2 + 0.2, 0.038);
    }
    box(building, w + 0.18, 0.13, d + 0.18, 'ceramicLight', 0, h + 0.2, 0, 0.022);
    box(building, w + 0.1, 0.025, d + 0.1, 'copper', 0, h + 0.283, 0);
    const crownHeight = 0.48 + index % 3 * 0.19;
    box(building, w * 0.67, crownHeight, d * 0.68, finish, 0, h + 0.31 + crownHeight / 2, -0.06, 0.025);
    box(building, w * 0.78, 0.12, d * 0.81, 'ceramic', 0, h + crownHeight + 0.37, -0.06, 0.02);
    for (let rib = 0; rib < 3; rib++) {
      const fin = box(building, w * 0.65, 0.035, 0.16, 'copper', 0, h + crownHeight + 0.51 + rib * 0.07, -0.2 + rib * 0.15);
      fin.rotation.x = -0.18;
    }
    if (!spec.far) roofGarden(building, 0, h + crownHeight + 0.51, -d * 0.23, Math.min(1.45, w * 0.8));
  };

  const horizon = new THREE.Group();
  horizon.name = 'distant city skyline'; district.add(horizon);
  // A connected inhabited ground plane, never isolated floating slabs or rocks.
  box(horizon, cityWidth + 6, 0.22, 10.8, 'stone', 0, -2.91, -halfDepth - 12, 0.06);
  box(horizon, cityWidth + 6.2, 0.09, 11, 'sand', 0, -2.74, -halfDepth - 12, 0.035);
  const heights = [4.2, 6.1, 3.7, 5.4, 7.2, 4.5, 6.3, 3.9, 5.5];
  heights.forEach((height, i) => makeBuilding(horizon, {
    x: (i - 4) * cityWidth / 9, z: -halfDepth - 11.8 - (i % 3) * 1.45,
    width: 1.45 + i % 3 * 0.29, depth: 1.5 + i % 2 * 0.55, height, base: -2.68, index: i, far: true,
  }));
  // Raised streets connect the skyline instead of a single abstract backdrop.
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * cityWidth * 0.27;
    box(horizon, cityWidth * 0.24, 0.14, 0.75, 'ceramic', x, -0.12 + i % 2 * 0.5, -halfDepth - 11.1, 0.02);
    railing(horizon, cityWidth * 0.24, x, -0.04 + i % 2 * 0.5, -halfDepth - 10.72);
  }

  const promenade = new THREE.Group();
  promenade.name = 'layered civic promenade'; district.add(promenade);
  promenade.position.z = -halfDepth - 6.2;
  const terraceWidth = width + 15;
  box(promenade, terraceWidth, 0.24, 4.4, 'rose', 0, -1.1, 0, 0.055);
  box(promenade, terraceWidth + 0.2, 0.14, 4.6, 'ceramic', 0, -0.9, 0, 0.035);
  box(promenade, terraceWidth + 0.1, 0.035, 4.5, 'sand', 0, -0.79, 0);
  // A supported arcade makes the terrace belong to the district below it.
  for (let i = 0; i < 9; i++) arcade(promenade, (i - 4) * terraceWidth / 9, -2.8, 1.91);
  railing(promenade, terraceWidth - 0.8, 0, -0.7, 2.18);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * terraceWidth / 4;
    roofGarden(promenade, x, -0.64, 1.7, 1.35);
    box(promenade, 0.48, 0.065, 0.28, 'copper', x + 0.85, -0.39, 1.7, 0.018);
    for (const side of [-1, 1]) box(promenade, 0.05, 0.25, 0.22, 'navy', x + 0.85 + side * 0.16, -0.54, 1.7);
  }
  makeBuilding(promenade, { x: -width / 2 - 3.35, z: -0.55, width: 2.45, depth: 2.05, height: 4.1, base: -0.75, index: 10 });
  makeBuilding(promenade, { x: width / 2 + 3.6, z: -0.85, width: 2.2, depth: 2.1, height: 4.9, base: -0.75, index: 11 });

  const institute = new THREE.Group();
  institute.name = 'NOEMA INC conservatory and research institute';
  institute.position.set(0.1, -0.73, -0.4); promenade.add(institute);
  box(institute, 5.35, 0.16, 2.5, 'stone', 0, 0.08, 0, 0.03);
  box(institute, 5.1, 2.28, 2.3, 'rose', 0, 1.3, 0, 0.055);
  for (const x of [-1.8, -0.6, 0.6, 1.8]) {
    window(institute, 0.93, 1.38, 0.03, x, 1.11, 1.17);
    arcade(institute, x, 0.18, 1.22);
  }
  box(institute, 5.48, 0.18, 2.62, 'ceramic', 0, 2.52, 0, 0.035);
  box(institute, 5.52, 0.035, 2.66, 'copper', 0, 2.635, 0);
  box(institute, 4.85, 0.38, 0.07, 'navy', 0, 2.35, 1.335, 0.012);
  assets.label(institute, 'NOEMA INC  /  RESEARCH CAMPUS', 4.55, 0.3, 0, 2.35, 1.376, '#dddfce');
  const conservatory = new THREE.Group();
  conservatory.position.set(0, 2.7, -0.12); institute.add(conservatory);
  assets.cylinder(conservatory, 1.05, 1.15, 0.2, 'ceramic', 0, 0.1, 0, 32);
  assets.cylinder(conservatory, 1.04, 1.04, 0.48, 'cyanDim', 0, 0.42, 0, 32);
  const domeGeometry = assets.geometry('district conservatory dome', () => new THREE.SphereGeometry(1.04, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const dome = new THREE.Mesh(domeGeometry, glaze);
  dome.position.y = 0.66; dome.scale.y = 0.58; conservatory.add(dome);
  assets.ring(conservatory, 1.05, 0.035, 'copper', 0, 0.67, 0, true);
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI / 5;
    box(conservatory, 0.045, 0.47, 0.045, 'ceramic', Math.cos(angle) * 1.05, 0.42, Math.sin(angle) * 1.05);
  }
  for (const x of [-2, 2]) roofGarden(institute, x, 2.78, 0.25, 0.85);

  // A genuine pedestrian approach leads from the learning garden into the city.
  const approach = new THREE.Group();
  approach.position.set(-width * 0.28, -0.4, -halfDepth - 3.8); district.add(approach);
  for (let i = 0; i < 4; i++) box(approach, 1.85, 0.14, 0.52, i % 2 ? 'sand' : 'ceramic', 0, -i * 0.12, -i * 0.42, 0.025);
  for (const side of [-1, 1]) {
    box(approach, 0.045, 0.035, 2.05, 'copper', side * 0.86, 0.36, -0.62);
    for (let i = 0; i < 4; i++) box(approach, 0.035, 0.47, 0.035, 'ceramic', side * 0.86, 0.12 - i * 0.09, -i * 0.45);
  }

  let meshes = 0, triangles = 0;
  district.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    // These distant buildings cannot cast a giant opaque shadow across the
    // lesson. Their solid finishes still receive the same directional lighting.
    object.castShadow = false;
    object.receiveShadow = false;
    meshes++;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  district.userData = { cosmetic: true, districtMeshes: meshes, districtTriangles: triangles, skylineTowers: heights.length, districtLayers: 3 };
  return district;
}

/** Four institute observation cameras are physical props, without video passes. */
export function makeObservationCameras(parent: THREE.Group, assets: StudioAssets, width: number, depth: number): THREE.Group {
  const cameras = new THREE.Group();
  cameras.name = 'NOEMA INC four courtyard observation cameras';
  cameras.userData = { cosmetic: true, observationCameras: 4 };
  parent.add(cameras);
  for (const xSide of [-1, 1]) for (const zSide of [-1, 1]) {
    const pole = new THREE.Group();
    pole.position.set(xSide * (width / 2 + 1.27), -0.09, zSide * (depth / 2 + 1.05));
    cameras.add(pole);
    assets.cylinder(pole, 0.15, 0.19, 0.11, 'ceramic', 0, 0.055, 0, 16);
    assets.cylinder(pole, 0.025, 0.043, 1.76, 'navy', 0, 0.96, 0, 12);
    for (const y of [0.22, 1.57, 1.77]) assets.cylinder(pole, 0.048, 0.048, 0.055, 'copper', 0, y, 0, 12);
    assets.box(pole, 0.13, 0.24, 0.1, 'ceramic', 0, 0.68, 0.055, 0.018);
    assets.box(pole, 0.065, 0.09, 0.012, 'navy', 0, 0.68, 0.113, 0.005);
    const head = new THREE.Group();
    head.position.y = 1.91; pole.add(head);
    head.lookAt(new THREE.Vector3(0, 0.22, 0));
    assets.box(head, 0.255, 0.165, 0.31, 'ceramicLight', 0, 0, 0.015, 0.025);
    assets.box(head, 0.18, 0.12, 0.025, 'navy', 0, 0, 0.18, 0.016);
    assets.box(head, 0.32, 0.027, 0.43, 'ceramic', 0, 0.113, 0.055, 0.012);
    const lens = assets.cylinder(head, 0.047, 0.052, 0.045, 'navy', 0, 0, 0.216, 20);
    lens.rotation.x = Math.PI / 2;
    const lensRim = new THREE.Mesh(assets.geometry('observation camera lens rim', () => new THREE.TorusGeometry(0.047, 0.008, 6, 20)), assets.material('copper'));
    lensRim.position.z = 0.241; head.add(lensRim);
    const glass = assets.cylinder(head, 0.034, 0.034, 0.008, 'cyanDim', 0, 0, 0.245, 20);
    glass.rotation.x = Math.PI / 2;
    const status = new THREE.Mesh(assets.geometry('observation camera status lamp', () => new THREE.SphereGeometry(0.012, 8, 6)), assets.material('cyan'));
    status.position.set(0.076, 0.025, 0.199); head.add(status);
    assets.cylinder(pole, 0.065, 0.065, 0.11, 'copper', 0, 1.81, 0, 16);
    assets.tube(pole, [new THREE.Vector3(0, 1.48, 0.04), new THREE.Vector3(0.09, 1.67, 0.04), new THREE.Vector3(0.05, 1.86, -0.06)], 0.014, 'joint');
  }
  return cameras;
}
