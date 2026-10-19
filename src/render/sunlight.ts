import * as THREE from 'three';

/** Gentle cloud occlusion of direct light; ambient fill remains unmodified. */
export function createSunlightMask() {
  const uniforms = { noemaSunTime: { value: 0 }, noemaCloudShade: { value: 0 } };
  const apply = (material: THREE.MeshStandardMaterial) => {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec2 vNoemaSunWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        vec4 noemaWorldPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          noemaWorldPosition = instanceMatrix * noemaWorldPosition;
        #endif
        vNoemaSunWorld = (modelMatrix * noemaWorldPosition).xz;
      `);
      shader.fragmentShader = 'varying vec2 vNoemaSunWorld; uniform float noemaSunTime; uniform float noemaCloudShade;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        float noemaCloudField = 0.5
          + 0.31 * sin(dot(vNoemaSunWorld, vec2(0.38, 0.21)) - noemaSunTime * 0.065)
          + 0.19 * sin(dot(vNoemaSunWorld, vec2(-0.19, 0.36)) + noemaSunTime * 0.047);
        float noemaDirectTransmission = 1.0 - 0.30 * noemaCloudShade * smoothstep(0.12, 0.79, noemaCloudField);
        reflectedLight.directDiffuse *= noemaDirectTransmission;
        reflectedLight.directSpecular *= noemaDirectTransmission;
      `);
    };
    material.customProgramCacheKey = () => 'noema-soft-sun-clouds-v1';
  };
  return { uniforms, apply };
}
