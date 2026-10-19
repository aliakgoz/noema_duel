import * as THREE from 'three';

/** Ceramic, copper and glazed campus architecture, batched per finish on mobile. */
export function buildVenue(parent: THREE.Group): void {
  const campus = new THREE.Group(); campus.name = 'NOEMA layered research courtyard'; parent.add(campus);
  const materials = new Map<string, THREE.Material>();
  const colors = { stone: '#8f8990', sand: '#c8b99f', ceramic: '#e3ded1', light: '#f3ebd9', rose: '#b99d91', copper: '#aa785c', navy: '#334659', soil: '#454337' };
  for (const [name, color] of Object.entries(colors)) materials.set(name, new THREE.MeshStandardMaterial({ color, roughness: name === 'copper' ? .4 : .83, metalness: name === 'copper' ? .55 : .07 }));
  materials.set('glass', new THREE.MeshStandardMaterial({ color: '#527686', roughness: .23, metalness: .4, emissive: '#42758b', emissiveIntensity: .14 }));
  materials.set('litGlass', new THREE.MeshStandardMaterial({ color: '#d2bd87', roughness: .34, metalness: .24, emissive: '#ffd59b', emissiveIntensity: .32 }));
  materials.set('warm', new THREE.MeshBasicMaterial({ color: '#f7d4a0', toneMapped: false }));
  materials.set('blue', new THREE.MeshBasicMaterial({ color: '#7da9ff', toneMapped: false }));
  const batches = new Map<string, THREE.Matrix4[]>(), unitBox = new THREE.BoxGeometry(1, 1, 1);
  const rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  function box(w: number, h: number, d: number, finish: string, x: number, y: number, z: number, angle = 0) {
    let matrices = batches.get(finish);
    if (!matrices) { matrices = []; batches.set(finish, matrices); }
    rotation.setFromAxisAngle(up, angle);
    matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(w, h, d)));
  }
  function label(text: string, w: number, h: number, x: number, y: number, z: number, color = '#f4ead7') {
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 256;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.font = '600 126px Manrope, Segoe UI, sans-serif'; context.fillText(text, 768, 134, 1450);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.position.set(x, y, z); campus.add(mesh);
  }
  function railing(w: number, x: number, y: number, z: number) {
    box(w, .045, .045, 'copper', x, y + .57, z); box(w, .022, .035, 'ceramic', x, y + .24, z);
    const count = Math.ceil(w / .8);
    for (let i = 0; i <= count; i++) box(.045, .63, .045, 'ceramic', x - w / 2 + i * w / count, y + .28, z);
  }
  function bench(x: number, z: number, angle = 0) {
    box(1.55, .13, .5, 'sand', x, .09, z, angle);
    for (const side of [-1, 1]) box(.09, .46, .37, 'navy', x + Math.cos(angle) * side * .54, -.12, z - Math.sin(angle) * side * .54, angle);
    box(1.55, .31, .075, 'copper', x + Math.sin(angle) * .23, .34, z + Math.cos(angle) * .23, angle);
  }
  function planter(x: number, z: number, w: number, d: number) {
    box(w, .34, d, 'ceramic', x, -.1, z); box(w + .04, .055, d + .04, 'light', x, .035, z);
    box(w - .16, .022, d - .16, 'soil', x, .105, z);
  }

  // Supported terraces and promenades, outside the local 24 × 14 training floor.
  box(35, .3, 31, 'stone', 0, -.91, -.9); box(34.8, .11, 30.8, 'sand', 0, -.705, -.9);
  box(35.3, .23, 5.4, 'rose', 0, -.48, -13.1); box(35.5, .1, 5.6, 'ceramic', 0, -.315, -13.1);
  box(35.4, .035, 5.5, 'sand', 0, -.246, -13.1); box(35, .035, .1, 'copper', 0, -.215, -10.4);
  for (const side of [-1, 1]) {
    box(2.1, .12, 22, 'ceramic', side * 14.1, -.59, .3); box(.08, .03, 21.6, 'copper', side * 15.07, -.515, .3);
    box(4.3, .08, 1.35, 'ceramic', side * 8, -.56, 10.1); box(4.2, .025, .07, 'warm', side * 8, -.5, 10.68);
    for (let step = 0; step < 4; step++) box(2.2, .12, .42, step % 2 ? 'sand' : 'light', side * 10.1, -.54 + step * .075, -9.2 - step * .36);
    railing(8.2, side * 10.7, -.18, -10.47);
    for (const z of [-5.6, 1.5, 7.2]) {
      bench(side * 14.15, z, side * Math.PI / 2); planter(side * 14.15, z - 1.72, 1.25, 1.35);
      box(.07, 1.06, .07, 'navy', side * 15.15, .02, z - .7); box(.2, .11, .2, 'warm', side * 15.15, .6, z - .7);
    }
    planter(side * 6.25, -11.0, 2.1, .73);
  }

  // Inset glazing, slender piers and cornices make inhabited institute wings.
  function lab(x: number, z: number, w: number, d: number, height: number, index: number) {
    const base = -.19;
    box(w + .28, .16, d + .25, 'stone', x, base, z);
    box(w, height, d, index % 2 ? 'rose' : 'ceramic', x, base + height / 2, z);
    box(w - .25, height - .45, .04, 'glass', x, base + height / 2, z + d / 2 + .025);
    const cols = Math.max(2, Math.floor(w / .9)), rows = Math.max(2, Math.floor(height / .72));
    for (let row = 0; row < rows; row++) {
      const y = base + .3 + (row + .5) * (height - .5) / rows;
      for (let col = 0; col < cols; col++) {
        const px = x - (w - .28) / 2 + (col + .5) * (w - .28) / cols;
        box((w - .28) / cols - .11, (height - .5) / rows - .16, .04, (row * 3 + col + index) % 5 === 0 ? 'litGlass' : 'glass', px, y, z + d / 2 + .06);
      }
      box(w + .04, .065, .13, 'sand', x, y + (height - .5) / rows * .45, z + d / 2 + .07);
    }
    for (let col = 0; col <= cols; col++) box(.065, height, .13, 'ceramic', x - w / 2 + col * w / cols, base + height / 2, z + d / 2 + .07);
    box(w + .32, .16, d + .32, 'light', x, base + height + .08, z); box(w + .36, .04, d + .36, 'copper', x, base + height + .18, z);
    box(w * .68, .36, d * .62, 'sand', x, base + height + .38, z - .12); box(w * .75, .075, d * .7, 'ceramic', x, base + height + .6, z - .12);
    for (const side of [-1, 1]) {
      box(.045, height - .55, d - .35, 'glass', x + side * (w / 2 + .025), base + height / 2, z);
      for (let row = 1; row < rows; row++) box(.11, .055, d - .16, 'sand', x + side * (w / 2 + .06), base + row * height / rows, z);
    }
  }
  lab(-10.15, -13.65, 4, 3.6, 3.3, 1); lab(10.15, -14.0, 3.65, 3.8, 4.2, 2); lab(0, -14.65, 10.2, 3.2, 2.68, 0);
  // The entry shelter replaces the stadium grandstand and its suspended arch.
  box(11.7, .2, 1.1, 'light', 0, 2.72, -12.72); box(11.8, .035, 1.15, 'copper', 0, 2.84, -12.72);
  box(10.9, .88, .16, 'navy', 0, 2.02, -12.38); box(10.5, .035, .06, 'warm', 0, 2.5, -12.28);
  label('NOEMA ARENA', 9.9, .75, 0, 2.09, -12.285);
  label('RESEARCH CAMPUS  /  ROBOT LEARNING LAB', 8.5, .3, 0, 1.42, -12.28, '#bbccd5');
  for (const x of [-5.35, 5.35]) {
    box(.15, 2.8, .15, 'ceramic', x, 1.16, -12.52); box(.22, .11, .22, 'copper', x, .19, -12.52);
  }
  for (const x of [-3.65, -1.22, 1.22, 3.65]) {
    box(1.94, 1.1, .06, 'glass', x, .54, -12.98); box(.065, 1.25, .12, 'ceramic', x - .97, .56, -12.92);
    box(1.95, .045, .03, 'blue', x, 1.11, -12.9);
  }
  // Conservatory silhouette recalls the original NOEMA research institute.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.get('glass'));
  dome.position.set(0, 3.37, -14.7); dome.scale.y = .62; campus.add(dome);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.17, 1.22, .43, 24), materials.get('ceramic'));
  drum.position.set(0, 3.15, -14.7); campus.add(drum);
  const domeRim = new THREE.Mesh(new THREE.TorusGeometry(1.18, .035, 5, 32), materials.get('copper'));
  domeRim.rotation.x = Math.PI / 2; domeRim.position.set(0, 3.37, -14.7); campus.add(domeRim);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    box(.045, .44, .045, 'copper', Math.cos(angle) * 1.18, 3.16, -14.7 + Math.sin(angle) * 1.18);
  }
  for (const [finish, matrices] of batches) {
    const mesh = new THREE.InstancedMesh(unitBox, materials.get(finish)!, matrices.length);
    mesh.name = `campus ${finish} architecture`; matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.receiveShadow = true; mesh.castShadow = false; campus.add(mesh);
  }
  campus.userData = { cosmetic: true, architectureLayers: 3, instancedDetails: [...batches.values()].reduce((sum, list) => sum + list.length, 0) };
}
