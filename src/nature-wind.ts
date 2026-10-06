import * as THREE from 'three';

/** Bend only the delivered grass vertices, leaving their roots and instance matrices fixed. */
export function applyNatureWind(
  material: THREE.Material,
  geometry: THREE.BufferGeometry,
  time: { value: number },
) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const base = box.min.y,
    height = Math.max(0.001, box.max.y - base);
  const previous = material.onBeforeCompile,
    cache = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.natureTime = time;
    shader.vertexShader = 'uniform float natureTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      #include <project_vertex>
      #ifdef USE_INSTANCING
        vec4 natureWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec4 natureRoot = modelMatrix * instanceMatrix * vec4(0.0, ${base.toFixed(8)}, 0.0, 1.0);
        float natureHeight = clamp((position.y - ${base.toFixed(8)}) / ${height.toFixed(8)}, 0.0, 1.0);
        float natureAngle = .65 + sin(natureTime * .021) * .28;
        float natureGust = .35 + .22 * sin(natureTime * .19 + natureRoot.x * .012 + natureRoot.z * .009)
          + .12 * sin(natureTime * .47 + natureRoot.z * .018);
        float natureFlutter = .8 + .2 * sin(natureTime * 1.6 + natureRoot.x * .8 + natureRoot.z * .6);
        natureWorld.xz += vec2(cos(natureAngle), sin(natureAngle)) * natureGust * natureFlutter
          * natureHeight * natureHeight * .18;
        mvPosition = viewMatrix * natureWorld;
        gl_Position = projectionMatrix * mvPosition;
      #endif
    `,
    );
  };
  material.customProgramCacheKey = () => `${cache}-nature-wind-1-${base}-${height}`;
}
