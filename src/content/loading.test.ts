import { test, expect } from "bun:test";
import { loadJSON } from "./json-loader";
import { validateVehicleSpec } from "./vehicle-spec";
import { QUADRO_SPEC } from "../config";
import { selectQuality } from "../app/quality";
test("chunked response is rejected before decoded data exceeds the budget", async () => {
  let cancelled = false;
  const request = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(12));
          c.enqueue(new Uint8Array(12));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  await expect(
    loadJSON("/world", new AbortController().signal, 16, request),
  ).rejects.toThrow("budget");
  expect(cancelled).toBe(true);
});
test("JSON loader checks UTF-8 bytes and honours an already cancelled request", async () => {
  const request = async () =>
    new Response(JSON.stringify({ title: "Карелия" }));
  expect(
    await loadJSON("/world", new AbortController().signal, 128, request),
  ).toEqual({ title: "Карелия" });
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadJSON("/world", controller.signal, 128, request),
  ).rejects.toThrow();
});
test("vehicle validation rejects non-finite physical parameters before creating Rapier objects", () => {
  expect(() => validateVehicleSpec({ ...QUADRO_SPEC, massKg: NaN })).toThrow();
  expect(() => validateVehicleSpec({ ...QUADRO_SPEC, model: "" })).toThrow();
  expect(
    validateVehicleSpec({ ...QUADRO_SPEC, id: "custom-suv", name: "SUV" })
      .model,
  ).toBe(QUADRO_SPEC.model);
});
test("slow internet does not force low graphics; quality does not change simulation frequency", () => {
  const device = { touch: false, cores: 8, memoryGB: 16, effectiveType: "3g" };
  const normal = selectQuality(device);
  expect(normal.lowNetwork).toBe(true);
  expect(normal.lowRender).toBe(false);
  expect(selectQuality(device, "low", "normal").lowNetwork).toBe(false);
  expect(selectQuality({ ...device, cores: 2, memoryGB: 2 }).lowRender).toBe(
    true,
  );
});
