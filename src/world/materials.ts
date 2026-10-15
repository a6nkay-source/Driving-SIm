/**
 * Shared materials. Most are MeshStandardMaterial extended through
 * onBeforeCompile so they keep PBR lighting, shadows and fog while adding
 * procedural detail (windows, shop fronts, wet asphalt, waves, tree sway).
 */
import * as THREE from 'three';
import { asphaltTexture, concreteTexture, groundTexture, grassTexture, puddleTexture, sandTexture, sidewalkTexture } from './textures';

/** Global uniforms updated once per frame by the environment. */
export const worldUniforms = {
  uTime: { value: 0 },
  /** 0 = full daylight, 1 = night. */
  uNight: { value: 0 },
  /** 0 = dry, 1 = soaked (monsoon). */
  uWet: { value: 0 },
};

const HASH = /* glsl */ `
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/**
 * Building walls get procedural windows by style; ground floors facing roads
 * become shops with signboards. aWall = (metres along wall, metres above base),
 * aWin = (style + 1 or 0 for roofs, frontage flag, seed, floor height).
 */
export function createBuildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02, envMapIntensity: 0.7 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uWet = worldUniforms.uWet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aWall;
        attribute vec4 aWin;
        varying vec2 vWall;
        varying vec4 vWin;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWall = aWall;
        vWin = aWin;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        uniform float uWet;
        varying vec2 vWall;
        varying vec4 vWin;
        ${HASH}
        vec3 signPalette(float r) {
          if (r < 0.14) return vec3(0.75, 0.13, 0.1);
          if (r < 0.28) return vec3(0.95, 0.75, 0.12);
          if (r < 0.42) return vec3(0.1, 0.3, 0.65);
          if (r < 0.54) return vec3(0.1, 0.5, 0.3);
          if (r < 0.66) return vec3(0.92, 0.45, 0.1);
          if (r < 0.76) return vec3(0.95, 0.95, 0.92);
          if (r < 0.86) return vec3(0.5, 0.15, 0.55);
          return vec3(0.0, 0.55, 0.5);
        }`,
      )
      .replace(
        'void main() {',
        `void main() {
        float bGlass = 0.0;
        vec3 bEmit = vec3(0.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float style = vWin.x;
          float u = vWall.x;
          float v = vWall.y;
          float seed = vWin.z;
          if (style > 0.5) {
            float fh = max(2.5, vWin.w);
            float spacing = 3.4;
            vec2 wmin = vec2(0.22, 0.3);
            vec2 wmax = vec2(0.78, 0.82);
            vec3 glassCol = vec3(0.06, 0.07, 0.085);
            if (style > 2.5 && style < 3.5) { spacing = 1.75; wmin = vec2(0.04, 0.06); wmax = vec2(0.96, 0.94); glassCol = vec3(0.14, 0.2, 0.26); }
            else if (style > 1.5 && style < 2.5) { spacing = 4.4; wmin = vec2(0.3, 0.2); wmax = vec2(0.7, 0.82); }
            else if (style > 3.5 && style < 4.5) { spacing = 4.2; wmin = vec2(0.1, 0.34); wmax = vec2(0.9, 0.78); }
            else if (style > 5.5) { spacing = 6.5; wmin = vec2(0.36, 0.25); wmax = vec2(0.64, 0.85); }
            vec2 cell = vec2(u / spacing, v / fh);
            vec2 id = floor(cell);
            vec2 f = fract(cell);
            float aa = max(fwidth(cell.x), fwidth(cell.y));
            float e = clamp(aa * 1.2, 0.01, 0.25);
            float wx = smoothstep(wmin.x - e, wmin.x + e, f.x) * (1.0 - smoothstep(wmax.x - e, wmax.x + e, f.x));
            float wy = smoothstep(wmin.y - e, wmin.y + e, f.y) * (1.0 - smoothstep(wmax.y - e, wmax.y + e, f.y));
            float win = wx * wy;
            if (style > 1.5 && style < 2.5) {
              // Gothic / Indo-Saracenic arched heads.
              vec2 q = vec2((f.x - 0.5) / (wmax.x - wmin.x) * 2.0, (f.y - (wmax.y - 0.16)) / 0.16);
              if (q.y > 0.0) win *= 1.0 - smoothstep(0.92, 1.08, length(q));
            }
            float far = smoothstep(0.3, 0.75, aa);
            float coverage = (wmax.x - wmin.x) * (wmax.y - wmin.y) * 0.8;
            float wmix = mix(win, coverage, far);
            if (style > 4.5 && style < 5.5) {
              // Sheds: corrugated sheet, no windows.
              wmix = 0.0;
              diffuseColor.rgb *= 0.9 + 0.1 * step(0.5, fract(u * 2.5));
            }
            bool shopFloor = vWin.y > 0.5 && v < fh * 1.3;
            if (shopFloor) wmix = 0.0;
            // Monsoon streaks below windows and a darker plinth.
            float streak = step(0.3, f.x) * step(f.x, 0.7) * step(f.y, wmin.y) * step(0.45, bHash(id.xx + seed * 3.1));
            diffuseColor.rgb *= 1.0 - streak * 0.14 * (1.0 - far);
            diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 0.8, v));
            // Balcony / sunshade lines for the concrete and deco styles.
            if (style < 1.5 || (style > 3.5 && style < 4.5)) {
              float ledge = smoothstep(0.86, 0.88, f.y) * (1.0 - smoothstep(0.92, 0.94, f.y));
              diffuseColor.rgb *= 1.0 - ledge * 0.25 * (1.0 - far);
            }
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, wmix);
            bGlass = wmix * (style > 2.5 && style < 3.5 ? 1.0 : 0.75);
            float rnd = bHash(id + seed * 91.7);
            float lit = step(0.56, rnd) * wmix;
            // Mix of warm bulbs, cool tube-lights and dim curtained rooms.
            float tone = bHash(id + 7.3);
            vec3 warm = tone < 0.6 ? vec3(1.0, 0.68, 0.34) : tone < 0.85 ? vec3(0.8, 0.92, 1.0) : vec3(0.95, 0.55, 0.3);
            float level = 0.18 + 0.5 * bHash(id + 1.7) * bHash(id + 3.3);
            // Brighter towards the window centre (curtains / interior falloff).
            float centre = 1.0 - 0.5 * length((f - (wmin + wmax) * 0.5) / max(wmax - wmin, vec2(0.01)));
            bEmit += warm * lit * uNight * level * mix(1.0, centre, 1.0 - far);
            if (shopFloor) {
              float sv = v / fh;
              float shopId = floor(u / 4.6);
              float sr = bHash(vec2(shopId, seed * 13.0));
              float fu = fract(u / 4.6);
              float pillar = clamp(step(fu, 0.05) + step(0.95, fu), 0.0, 1.0);
              if (sv > 0.8 && sv < 1.04) {
                vec3 sc = signPalette(sr);
                diffuseColor.rgb = mix(sc * 0.85, diffuseColor.rgb, pillar);
                bEmit += sc * uNight * 0.35 * (1.0 - pillar);
              } else if (sv <= 0.8) {
                // Roughly half the shops are open (late-night Mumbai), the rest shuttered.
                float open = step(0.45, sr);
                vec3 shutter = vec3(0.3, 0.31, 0.33) * (0.8 + 0.2 * step(0.5, fract(v * 11.0)));
                vec3 inside = mix(vec3(0.1, 0.08, 0.06), vec3(0.22, 0.18, 0.14), bHash(vec2(shopId, 2.0)));
                diffuseColor.rgb = mix(open > 0.5 ? inside : shutter, diffuseColor.rgb * 0.85, pillar);
                float st = bHash(vec2(shopId, 5.0));
                vec3 shopLight = st < 0.55 ? vec3(1.0, 0.78, 0.5) : vec3(0.82, 0.95, 1.0);
                // Brighter near the top (tube lights), dimmer at the counter.
                bEmit += open * (1.0 - pillar) * shopLight * uNight * (0.12 + 0.2 * sv);
                bGlass = open * (1.0 - pillar) * 0.4;
              }
            }
          } else {
            // Roof: concrete with water-proofing patches.
            float n = bHash(floor(vec2(u, v) * 0.6) + seed);
            diffuseColor.rgb *= 0.9 + 0.12 * n;
          }
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.08, bGlass);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, uWet);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, bGlass);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += bEmit;`,
      );
  };
  mat.customProgramCacheKey = () => 'building-v3';
  return mat;
}

/** Asphalt with world-space UVs, wet darkening and puddles. */
export function createRoadMaterial(): THREE.MeshStandardMaterial {
  const map = asphaltTexture();
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
    envMapIntensity: 0.6,
  });
  addWetness(mat, 0.13);
  mat.customProgramCacheKey = () => 'road-wet';
  return mat;
}

function addWetness(mat: THREE.MeshStandardMaterial, worldScale: number): void {
  const puddles = puddleTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = worldUniforms.uWet;
    shader.uniforms.uPuddle = { value: puddles };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wpos = modelMatrix * vec4(transformed, 1.0);
        vWorldXZ = wpos.xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nuniform sampler2D uPuddle;\nvarying vec2 vWorldXZ;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float pud = texture2D(uPuddle, vWorldXZ * ${(worldScale * 0.35).toFixed(4)}).r;
        float wetAmt = uWet * (0.55 + 0.45 * smoothstep(0.25, 0.7, pud));
        roughnessFactor = mix(roughnessFactor, 0.06, wetAmt);
        diffuseColor.rgb *= 1.0 - 0.38 * uWet;`,
      );
  };
}

export function createSidewalkMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: sidewalkTexture(),
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    envMapIntensity: 0.5,
  });
  addWetness(mat, 0.2);
  mat.customProgramCacheKey = () => 'sidewalk-wet';
  return mat;
}

export function createMarkingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -16,
    emissive: 0xffffff,
    emissiveIntensity: 0,
  });
  return mat;
}

export function createConcreteMaterial(color = 0xb5b0a6): THREE.MeshStandardMaterial {
  const map = concreteTexture();
  return new THREE.MeshStandardMaterial({ map, color, roughness: 0.9 });
}

/**
 * Ground: the land mask (R land, G park, B sand) decides the surface; water
 * pixels are discarded so the sea plane underneath shows through.
 */
export function createGroundMaterial(mask: THREE.Texture, bounds: { minX: number; minZ: number; width: number; height: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0, envMapIntensity: 0.4 });
  const grass = grassTexture();
  const sand = sandTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: mask };
    shader.uniforms.uGrass = { value: grass };
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uWet = worldUniforms.uWet;
    shader.uniforms.uMaskRect = { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.width, bounds.height) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uMask;
        uniform sampler2D uGrass;
        uniform sampler2D uSand;
        uniform vec4 uMaskRect;
        uniform float uWet;
        varying vec2 vWorldXZ;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 muv = (vWorldXZ - uMaskRect.xy) / uMaskRect.zw;
        vec3 m = texture2D(uMask, muv).rgb;
        if (m.r < 0.5) discard;
        vec3 soil = texture2D(map, vWorldXZ * 0.07).rgb;
        vec3 gr = texture2D(uGrass, vWorldXZ * 0.12).rgb;
        vec3 sd = texture2D(uSand, vWorldXZ * 0.1).rgb;
        vec3 col = soil;
        col = mix(col, gr, smoothstep(0.35, 0.65, m.g));
        col = mix(col, sd, smoothstep(0.35, 0.65, m.b));
        diffuseColor.rgb *= col * (1.0 - 0.3 * uWet);`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-mask';
  return mat;
}

/** Sea surface: PBR reflections of the sky with animated wave normals. */
export function createWaterMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x14404d, roughness: 0.1, metalness: 0.05, envMapIntensity: 1.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWaterPos;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 p = vWaterPos.xz;
          float t = uTime;
          vec2 g = vec2(0.0);
          g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.21 + t * 1.1) * 0.08;
          g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 0.37 + t * 1.5) * 0.05;
          g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 0.83 + t * 2.1) * 0.03;
          g += vec2(-0.9, -0.4) * cos(dot(p, vec2(-0.9, -0.4)) * 1.7 + t * 2.9) * 0.018;
          float fade = clamp(1.0 - length(vViewPosition) / 900.0, 0.25, 1.0);
          vec3 wn = normalize(vec3(-g.x * fade, 1.0, -g.y * fade));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'water-waves';
  return mat;
}

/** Vertex-coloured foliage with a gentle wind sway (instanced). */
export function createFoliageMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
        #else
          float phase = 0.0;
        #endif
        float bend = max(0.0, position.y - 2.5);
        transformed.x += sin(uTime * 1.2 + phase) * 0.012 * bend;
        transformed.z += cos(uTime * 0.9 + phase * 1.3) * 0.009 * bend;`,
      );
  };
  mat.customProgramCacheKey = () => 'foliage-sway';
  return mat;
}

/**
 * Traffic vehicles: vertex colours tinted by instanceColor where aTint = 1,
 * with emissive head/tail lights (aGlow: 1 head, 2 tail) and per-instance
 * brake / hazard state (iState.x brake, iState.y hazard blink).
 */
export function createTrafficMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.35, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aGlow;
        attribute float aTint;
        attribute vec2 iState;
        varying float vGlow;
        varying vec2 vState;
        varying float vTint;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
          // Only panels flagged with aTint take the per-vehicle paint colour.
          vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aTint);
        #endif
        vGlow = aGlow;
        vState = iState;
        vTint = aTint;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        uniform float uTime;
        varying float vGlow;
        varying vec2 vState;
        varying float vTint;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float blink = step(0.5, fract(uTime * 1.6));
        if (vGlow > 0.5 && vGlow < 1.5) totalEmissiveRadiance += vec3(1.0, 0.95, 0.82) * (0.15 + uNight * 2.4);
        else if (vGlow > 1.5 && vGlow < 2.5) totalEmissiveRadiance += vec3(1.0, 0.05, 0.03) * (0.2 + uNight * 0.9 + vState.x * 2.2);
        else if (vGlow > 2.5) totalEmissiveRadiance += vec3(1.0, 0.55, 0.05) * vState.y * blink * 2.5;`,
      );
  };
  mat.customProgramCacheKey = () => 'traffic-glow';
  return mat;
}
