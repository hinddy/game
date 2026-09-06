import type { ThemeName, MaterialRole } from "../design/theme";
export type WorldId = string;
export type PrimitiveKind = "Button" | "Card" | "Panel" | "Terminal" | "Portal";
export type UIState = "idle" | "hover" | "pressed" | "selected" | "disabled";
export type UIElement = { id: string; kind: PrimitiveKind; x: number; z: number; w: number; d: number; h: number;
  label?: string; role?: MaterialRole; state?: UIState; ramp?: boolean };
export type WorldBundle = { version: 1; id: WorldId; theme: ThemeName; title: string; elements: UIElement[]; course?: boolean };
export type WorldEntry = { id: WorldId; url: string; x: number; z: number; halfWidth: number; halfDepth: number;
  region?: [number, number, number, number] };
export function validateBundle(value: unknown, id: WorldId): WorldBundle {
  const v = value as WorldBundle;
  if (!v || v.version !== 1 || v.id !== id || !["salt", "material", "shadcn"].includes(v.theme)
    || typeof v.title !== "string" || !Array.isArray(v.elements) || v.elements.length > 160) throw new Error("Invalid world bundle");
  const ids = new Set<string>();
  for (const e of v.elements) {
    if (typeof e.id !== "string" || ids.has(e.id) || !["Button", "Card", "Panel", "Terminal", "Portal"].includes(e.kind)
      || ![e.x, e.z, e.w, e.d, e.h].every(Number.isFinite) || Math.abs(e.x) > 12000 || Math.abs(e.z) > 12000
      || e.w < 2 || e.d < 2 || e.w > 300 || e.d > 300 || e.h < .1 || e.h > 12
      || (e.label !== undefined && (typeof e.label !== "string" || e.label.length > 80))
      || (e.role && !["surface", "accent", "border", "text"].includes(e.role))
      || (e.state && !["idle", "hover", "pressed", "selected", "disabled"].includes(e.state))) throw new Error("Invalid UI primitive");
    ids.add(e.id);
  }
  return v;
}
