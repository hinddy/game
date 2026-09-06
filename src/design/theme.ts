import * as THREE from "three";

export type ThemeName = "salt" | "material" | "shadcn";
export type MaterialRole = "surface" | "accent" | "border" | "text";
export type ThemeTokens = Record<MaterialRole, string> & { radius: number; roughness: number; metalness: number };
export const DEFAULT_TOKENS: ThemeTokens = { surface: "#142333", accent: "#ff790d", border: "#61758a", text: "#edf3fa", radius: .12, roughness: .7, metalness: .12 };

/** CSS is authoritative. Called immediately before simulation/render, with no deferred recolouring. */
export class ThemeBridge {
  readonly uniforms = {
    uSurface: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() },
    uBorder: { value: new THREE.Color() }, uText: { value: new THREE.Color() },
    uRadius: { value: .12 }, uRoughness: { value: .7 }, uMetalness: { value: .12 },
  };
  readonly materials: Record<MaterialRole, THREE.MeshStandardMaterial>;
  tokens = { ...DEFAULT_TOKENS };
  revision = 0;
  private signature = "";
  private readonly listeners = new Set<() => void>();
  private colorProbe?: CanvasRenderingContext2D;
  constructor(private readonly root: HTMLElement = document.documentElement) {
    this.materials = Object.fromEntries((["surface", "accent", "border", "text"] as MaterialRole[]).map(role => {
      const material = new THREE.MeshStandardMaterial();
      material.name = "theme:" + role;
      material.onBeforeCompile = shader => {
        shader.uniforms.uAccent = this.uniforms.uAccent;
        shader.vertexShader = 'attribute float uiState; attribute float uiReveal; varying float vUiState; varying float vUiReveal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUiState = uiState; vUiReveal = uiReveal;');
        shader.fragmentShader = 'uniform vec3 uAccent; varying float vUiState; varying float vUiReveal;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vUiReveal < 0.999 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > vUiReveal) discard;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (vUiState > 3.5) diffuseColor.rgb *= 0.38;
          else if (vUiState > 0.5) {
            diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, vUiState > 1.5 ? 0.22 : 0.09);
            totalEmissiveRadiance += uAccent * (vUiState > 1.5 ? 0.24 : 0.10);
          }`);
      };
      material.customProgramCacheKey = () => "garage-ui-states-v1";
      return [role, material];
    })) as Record<MaterialRole, THREE.MeshStandardMaterial>;
    this.sync();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setTheme(theme: ThemeName): void { this.root.dataset.theme = theme; this.sync(); }
  private cssColor(value: string, role: MaterialRole, target: THREE.Color): void {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) { target.set(value); return; }
    if (!CSS.supports("color", value)) { target.set(DEFAULT_TOKENS[role]); return; }
    // Let the browser resolve modern CSS colours (including oklch) into sRGB.
    if (!this.colorProbe) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      this.colorProbe = canvas.getContext("2d", { willReadFrequently: true })!;
    }
    const ctx = this.colorProbe; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const bytes = ctx.getImageData(0, 0, 1, 1).data;
    target.setRGB(bytes[0] / 255, bytes[1] / 255, bytes[2] / 255, THREE.SRGBColorSpace);
  }
  sync(): void {
    const css = getComputedStyle(this.root);
    const values = ["surface", "accent", "border", "text", "radius", "roughness", "metalness"].map(key => css.getPropertyValue("--" + key).trim());
    const signature = values.join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    const number = (index: number, fallback: number, max: number) => {
      const value = parseFloat(values[index]); return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, max) : fallback;
    };
    const next: ThemeTokens = { surface: values[0] || DEFAULT_TOKENS.surface, accent: values[1] || DEFAULT_TOKENS.accent,
      border: values[2] || DEFAULT_TOKENS.border, text: values[3] || DEFAULT_TOKENS.text,
      radius: number(4, 12, 24) / 100, roughness: number(5, .7, 1), metalness: number(6, .12, 1) };
    this.tokens = next;
    for (const role of ["surface", "accent", "border", "text"] as const) {
      const material = this.materials[role]; this.cssColor(next[role], role, material.color);
      material.roughness = next.roughness; material.metalness = next.metalness;
      this.uniforms[({ surface: "uSurface", accent: "uAccent", border: "uBorder", text: "uText" } as const)[role]].value.copy(material.color);
    }
    this.uniforms.uRadius.value = next.radius;
    this.uniforms.uRoughness.value = next.roughness; this.uniforms.uMetalness.value = next.metalness;
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  dispose(): void { for (const material of Object.values(this.materials)) material.dispose(); this.listeners.clear(); }
}
