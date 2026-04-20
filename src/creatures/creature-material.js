// creature-material.js — V2 PBR material with procedural fur/scales/skin/slime shaders.
//
// V2 upgrades from V1:
//   - 4-octave FBM (fractal Brownian motion) for multi-scale detail
//   - Subsurface scattering approximation for SKIN and SLIME
//   - Anisotropic roughness for FUR directional sheen
//   - Richer SCALES with cell noise patterns and iridescence
//   - Normal map perturbation at multiple frequencies

import * as THREE from 'three';
import { SURFACE_TYPE } from './CreatureParams.js';

/**
 * Create a high-quality procedural creature material.
 * @param {object} p  CreatureParams
 * @returns {THREE.MeshStandardMaterial}
 */
export function createCreatureMaterial(p) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: p.roughness || 0.7,
    metalness: p.metalness || 0.0,
    vertexColors: true,
  });

  material.onBeforeCompile = (shader) => {
    // ── 1. Inject noise functions + FBM ──────────────────────────────────
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>

      // 3D Simplex Noise
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(
          i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      // 4-octave Fractal Brownian Motion — multi-scale detail
      float fbm(vec3 p) {
        float f = 0.0;
        float amp = 0.5;
        float freq = 1.0;
        for (int i = 0; i < 4; i++) {
          f += amp * snoise(p * freq);
          freq *= 2.1;
          amp *= 0.45;
        }
        return f;
      }

      // Voronoi cell distance (for scales/cell patterns)
      float voronoi(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        float minDist = 1.0;
        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            for (int z = -1; z <= 1; z++) {
              vec3 neighbor = vec3(float(x), float(y), float(z));
              vec3 point = neighbor + fract(sin(dot(i + neighbor, vec3(127.1, 311.7, 74.7))) * 43758.5453);
              float d = length(f - point);
              minDist = min(minDist, d);
            }
          }
        }
        return minDist;
      }
      `
    );

    // ── 2. Pass world position + normal to fragment ──────────────────────
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldPosition;
       varying vec3 vSurfaceNormal;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vSurfaceNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`
    );

    // ── 3. Fragment declarations ─────────────────────────────────────────
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldPosition;
       varying vec3 vSurfaceNormal;`
    );

    // ── 4. Surface-specific noise injection ──────────────────────────────
    const surfaceType = p.surfaceType || SURFACE_TYPE.SKIN;
    let noiseInjection = '';

    if (surfaceType === SURFACE_TYPE.FUR) {
      noiseInjection = `
        // FUR — multi-octave directional strands with anisotropic roughness
        vec3 furP = vWorldPosition * 60.0;
        float furFBM = fbm(furP);
        float furFine = snoise(vWorldPosition * 200.0);
        float furMask = smoothstep(0.15, 0.75, furFBM * 0.5 + 0.5);

        // Directional strand normal perturbation (along surface tangent)
        vec3 furTangent = normalize(cross(vSurfaceNormal, vec3(0.0, 1.0, 0.1)));
        vec3 furNormal = normalize(
          vSurfaceNormal
          + furTangent * furFine * 0.35
          + vec3(snoise(furP * 1.8) * 0.2, snoise(furP * 2.3) * 0.2, furFBM * 0.15)
        );
        normal = mix(normal, furNormal, furMask * 0.75);

        // Darken fur roots, lighten tips
        float depthGrad = smoothstep(0.2, 0.8, furFBM * 0.5 + 0.5);
        diffuseColor.rgb *= mix(0.55, 1.1, depthGrad);

        // Anisotropic roughness: rough across strands, smoother along
        roughnessFactor = mix(roughnessFactor, mix(0.92, 0.65, depthGrad), furMask);
      `;
    } else if (surfaceType === SURFACE_TYPE.SCALES) {
      noiseInjection = `
        // SCALES — voronoi cell pattern with metallic edges
        vec3 scP = vWorldPosition * 25.0;
        float cellDist = voronoi(scP);
        float scaleFBM = fbm(vWorldPosition * 15.0);

        // Scale plate boundaries
        float edge = smoothstep(0.06, 0.12, cellDist);
        float plateCenter = smoothstep(0.3, 0.5, cellDist);

        // Normal perturbation: sharp at edges, flat on plates
        vec3 scaleNorm = normalize(normal + vec3(
          snoise(scP + vec3(0.1, 0.0, 0.0)) - snoise(scP - vec3(0.1, 0.0, 0.0)),
          0.0,
          snoise(scP + vec3(0.0, 0.0, 0.1)) - snoise(scP - vec3(0.0, 0.0, 0.1))
        ) * 0.2);
        normal = mix(scaleNorm, normal, edge);

        // Metallic glint on plate surfaces, dark grooves between
        metalnessFactor = mix(0.05, 0.5, plateCenter * (0.5 + scaleFBM * 0.5));
        diffuseColor.rgb *= mix(0.6, 1.15, edge);

        // Iridescence hint: shift hue slightly based on view angle
        float viewDot = abs(dot(normalize(vSurfaceNormal), normalize(vWorldPosition - cameraPosition)));
        diffuseColor.rgb += vec3(0.03, -0.02, 0.04) * (1.0 - viewDot) * plateCenter;

        roughnessFactor = mix(0.2, 0.55, edge);
      `;
    } else if (surfaceType === SURFACE_TYPE.SLIME) {
      noiseInjection = `
        // SLIME — subsurface glow, undulating surface, high reflectivity
        vec3 slP = vWorldPosition * 10.0;
        float slimeFBM = fbm(slP);
        float slimeFine = snoise(vWorldPosition * 40.0);

        // Undulating jelly surface
        normal = normalize(normal + vec3(
          slimeFBM * 0.06,
          slimeFine * 0.04,
          snoise(slP * 1.5) * 0.06
        ));

        // Subsurface scattering approximation: wrap-around diffuse
        float sssWrap = 0.4;
        float ndl = dot(normalize(vSurfaceNormal), vec3(0.3, 1.0, 0.2));
        float sss = smoothstep(-sssWrap, 1.0, ndl) * 0.3;
        diffuseColor.rgb += diffuseColor.rgb * sss;

        // Translucent depth variation
        float depth = smoothstep(-0.3, 0.5, slimeFBM);
        diffuseColor.rgb *= mix(0.7, 1.3, depth);

        // Ultra-smooth reflective surface
        roughnessFactor = mix(0.03, 0.12, slimeFine * 0.5 + 0.5);
        metalnessFactor = 0.02;
      `;
    } else {
      // SKIN — fine-grain pore detail + subsurface warmth
      noiseInjection = `
        // SKIN — multi-scale pore texture with subtle SSS warmth
        vec3 skinP = vWorldPosition;
        float poreFBM = fbm(skinP * 80.0);
        float finePore = snoise(skinP * 300.0);
        float medPore = snoise(skinP * 120.0);

        // Pore normal perturbation at two scales
        normal = normalize(normal + vec3(
          finePore * 0.025 + medPore * 0.015,
          poreFBM * 0.01,
          finePore * 0.025
        ));

        // Subsurface scattering approximation
        float sssWrap = 0.3;
        float ndl = dot(normalize(vSurfaceNormal), vec3(0.3, 1.0, 0.2));
        float sss = smoothstep(-sssWrap, 1.0, ndl) * 0.15;
        // Warm SSS tint (red/orange shift as light scatters through skin)
        diffuseColor.rgb += vec3(sss * 1.2, sss * 0.7, sss * 0.3);

        // Subtle colour variation from pores
        diffuseColor.rgb *= mix(0.96, 1.04, poreFBM);

        // Roughness varies with pore density
        roughnessFactor = mix(roughnessFactor * 0.9, roughnessFactor * 1.1, finePore * 0.5 + 0.5);
      `;
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      ${noiseInjection}`
    );
  };

  return material;
}
