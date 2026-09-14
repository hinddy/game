import type { TrackRenderOptions } from "../track";
export type DeviceHints = {
  touch: boolean;
  cores: number;
  memoryGB?: number;
  saveData?: boolean;
  effectiveType?: string;
};
/** Network pacing and graphics quality are independently overridable; physics frequency never changes. */
export function selectQuality(
  device: DeviceHints,
  renderOverride: string | null = null,
  networkOverride: string | null = null,
  smoke = false,
) {
  const lowNetwork =
    smoke ||
    networkOverride === "low" ||
    (networkOverride !== "normal" &&
      (device.saveData ||
        ["slow-2g", "2g", "3g"].includes(device.effectiveType ?? "")));
  const lowRender =
    smoke ||
    renderOverride === "low" ||
    (renderOverride !== "high" &&
      device.cores <= 4 &&
      (device.memoryGB ?? 8) <= 4);
  const options: TrackRenderOptions = {
    chunkSamples: lowNetwork ? 10 : 8,
    initialChunks: 1,
    streamIntervalMs: lowNetwork ? 150 : 90,
    showProps: !lowRender,
    castShadows: !lowRender,
  };
  return {
    lowNetwork: !!lowNetwork,
    lowRender,
    pixelRatioLimit: device.touch ? 1.25 : 1.5,
    options,
  };
}
export function browserQuality(params: URLSearchParams) {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  const touch =
    navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches;
  return {
    touch,
    ...selectQuality(
      {
        touch,
        cores: navigator.hardwareConcurrency ?? 8,
        memoryGB: nav.deviceMemory,
        ...nav.connection,
      },
      params.get("quality"),
      params.get("network"),
      import.meta.env.DEV && params.get("smoke") === "1",
    ),
  };
}
