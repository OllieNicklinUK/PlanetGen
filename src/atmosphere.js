import * as THREE from 'three';

const CLOUD_VSH = `
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  void main() {
    vUv = uv;
    vLocalPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FSH = `
  uniform float time;
  uniform vec3 sunPosition;
  uniform vec3 cloudColor;
  uniform vec3 skyColor;
  varying vec2 vUv;
  varying vec3 vLocalPosition;

  // Simple hash for noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // 2D Noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Fractal Brownian Motion
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Drifting motion
    vec2 uv = vUv * 12.0 + vec2(time * 0.015, time * 0.008);
    
    // Create wispy cloud density
    float n = fbm(uv);
    float density = smoothstep(0.35, 0.65, n);
    
    // Vertical fade — use local position to follow the dome center
    float vFade = smoothstep(0.0, 0.2, normalize(vLocalPosition).y);
    density *= vFade;

    // Rim lighting near the sun
    // For rim lighting, we still want the world direction to the sun
    // But since the sun is at infinity, we can use local position as direction
    float sunDot = dot(normalize(vLocalPosition), normalize(sunPosition));
    float rim = pow(max(0.0, sunDot), 10.0) * 0.7;
    
    // Sunset tinting
    vec3 finalColor = mix(cloudColor, vec3(1.0, 0.5, 0.2), rim);
    
    // Alpha blend — boosted for visibility
    gl_FragColor = vec4(finalColor, density * 0.75);
  }
`;

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.clouds = null;
    this.init();
  }

  init() {
    const geo = new THREE.SphereGeometry(9000, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VSH,
      fragmentShader: CLOUD_FSH,
      uniforms: {
        time: { value: 0 },
        sunPosition: { value: new THREE.Vector3() },
        cloudColor: { value: new THREE.Color(0xffffff) },
        skyColor: { value: new THREE.Color(0x88aacc) }
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });

    this.clouds = new THREE.Mesh(geo, this.material);
    this.clouds.name = 'Clouds';
    this.clouds.renderOrder = 10;
    this.scene.add(this.clouds);
  }

  update(dt, sunPos, mode) {
    this.material.uniforms.time.value += dt;
    this.material.uniforms.sunPosition.value.copy(sunPos);
    
    if (mode === 'scifi') {
      this.material.uniforms.cloudColor.value.set(0x40ffaa); // Toxic nebula
    } else {
      this.material.uniforms.cloudColor.value.set(0xffffff); // Wispy white
    }
  }

  dispose() {
    this.scene.remove(this.clouds);
    this.clouds?.geometry?.dispose();
    this.material?.dispose();
  }
}
