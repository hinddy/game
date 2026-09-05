# HinddY Garage MVP

Standalone PC-browser proving grounds for Quadro and BuggY. This directory is
an implementation laboratory, not a new AlexY OS guidebook route or content
kind.

## Included

- Four procedural proving grounds: Calibration Yard, Gravel Loop, Banked Oval
  and dry Bonneville Salt Flats (BuggY only).
- Three.js/WebGL rendering and a recognisable procedural Quadro model: an open
  navy tube frame, orange bench, front box lamp and spoked wheels.
- Rapier 3D/WASM rigid-body and ray-cast wheel physics.
- Fixed 60 Hz physics step, checkpoints, lap counting, wrong-way notice,
  boundary recovery and manual reset.
- Versioned world and vehicle parameters under `src/specs/`.
- Keyboard controls and a small accessible HTML HUD.

## Run

```powershell
bun install
bun run dev
```

To inspect the production bundle instead of the Vite dev server:

```powershell
bun run build
bun run preview
```

Open the local URL printed by Vite. Controls:

- `W` / `ArrowUp`: hold for manual throttle; tap to start when Cruise is selected
- `S` / `ArrowDown`: brake/reverse in Manual; stop and cancel Cruise
- `A` / `D` or arrow keys: steer
- `R`: return to the last safe checkpoint
- `Shift + W` (or `Shift + ArrowUp`): manual BuggY turbo; Shift alone boosts an already running Cruise
- Mouse wheel: move the follow camera closer or farther away
- Camera menu: Drone follows the vehicle by default; Observation enables a fixed inspection point
- In Observation, left click the ground or vehicle to move the inspection point
- In Observation, right click a point, then drag to orbit around it
- `F`: return to the drone camera

## Verify

```powershell
bun run verify
```

The current numbers are tuning hypotheses, not measured vehicle claims. A Lab
pack should later record the config digest, browser/device, FPS, frame spikes,
lap time, boundary resets and rollover rate before promotion.

## Runtime boundaries

Render meshes and physics colliders are generated separately. The track spline
defines centerline intent; the compiler expands it into road, shoulder,
barriers, checkpoint gates and Rapier colliders. AI-generated geometry must not
become an authoritative collider source.

## Vehicle garage (MVP refinement)

Choose **Quadro** or **BuggY** in the garage panel. Switching vehicle starts a new
session on the current proving ground. The URL option `?vehicle=buggy` selects
BuggY initially. Both cars keep the same keyboard and inspection controls.

Quadro keeps the navy open frame, orange bench, central lantern, exposed engine
and thin crossed spokes. BuggY has a silver roll cage, orange bonnet, radiator
grille, twin lamps, navy bucket seat and thicker orange spokes. Small chamfers,
smooth tyre/tube normals and distinct rubber, upholstery and metal roughness
provide depth without textures, external model downloads or new dependencies.

BuggY's independent tuning lives in `src/specs/vehicle.buggy.m0.json`: 340 kg,
1.65 m wheelbase, 1.48 m track, 58 km/h target, stronger drive/braking, longer
suspension travel and its own mass distribution/inertia. Quadro retains its
260 kg / 40 km/h target. These are gameplay tuning targets, not certified
performance claims; drag and track conditions affect achievable speeds.

Rigid model parts are baked by material; the four animated wheels share geometry.
Measured model budgets (excluding the shadow pass): Quadro 13,152 triangles /
17 mesh draws; BuggY 12,820 triangles / 23 mesh draws. Tests enforce finite
geometry, tyre radius, shared wheel buffers and an 18k triangle / 24 draw ceiling.

## Maintenance notes from this refinement

- Corrected Rapier speed conversion from m/s to km/h and wheel axle direction.
  Braking precedes a change of direction; propulsion tapers near target speed.
- Vehicle shadows now use a 32 m region following the car, keeping the existing
  1024px shadow map. Model parts cast/receive shadows; the low-cost mode still
  disables the shadow pass.
- Road, shoulders and barriers use continuous sampled ribbons instead of
  overlapping boxes. Width/bank interpolation follows the spline parameter.
  Render and static triangle colliders derive from the same authoritative
  cross-sections; collision remains complete before visual streaming.
- Inspection picking selects the closest hit. Switching clears drive input.
  Disposal includes templates that have not yet been streamed.
- Development snapshots expose vehicle ID, draw calls, triangles and resident
  geometries through `window.__hinddy.snapshot()`.

Before a production promotion, profile frame-time percentiles on target integrated
GPUs, verify repeated switches/context recovery, and run longer rollover,
barrier-impact and bank-transition tests. Current suspension visuals do not
articulate the axle links, chassis collision is a simplified box, and wheel
physics remains ray-cast. Fixed-step render interpolation and device-based quality
selection are useful next steps if measurements justify them. The present
low-cost selection uses network hints, which are not a GPU capability measure.
Vite still reports the existing large Three.js chunk; hashed engine assets and
the separate Rapier WASM should receive compression and immutable caching at
deployment. No extra rendering or physics libraries were added.

## P04 — dry Bonneville Salt Flats

Select P04 or open `?track=bonneville`. Quadro is disabled here and BuggY is
selected even if the URL requests Quadro; the other three grounds keep both cars.

The open salt field uses one flat static collider, a generated tileable 512px
salt texture with mipmaps, instanced course cones/flags, a gradient sky and two
mountain silhouettes 28–39 km away. The visual ground spans 120 km; the playable
square is 24 km across (12 km from the origin in each direction). Distant scenery
has no collision. This is a stylised proving ground inspired by Bonneville, not
a geographically accurate map. Leaving the marked loop does not trigger recovery;
leaving the playable square returns the car to its last safe checkpoint.

In Manual, BuggY turbo works on all four grounds while holding Shift with forward throttle.
Its tuning is in the BuggY spec: up to 1.65x engine force and a 90 km/h target,
with a 0.25-second response time. Releasing either key, braking, resetting or
switching disables boost. The HUD indicates when turbo is active.

A visible exhaust outlet emits a fixed pool of at most 64 soft particles; turbo
adds a small flickering flame without a dynamic light or postprocessing pass.
Particles live in world space, are cleared on reset, and all effect resources
are disposed when switching vehicles/grounds.

The BuggY engine and turbo use Web Audio synthesis, without audio downloads.
Default volume is 35%, with a volume slider and mute button. Audio starts after
a user gesture and suspends when the window loses focus or the tab is hidden.
Master gain and a compressor keep output restrained; actual loudness depends on
the user's system volume. No new packages were added.

Verification includes unit tests for track eligibility and turbo force/speed
limits, plus browser checks with real Shift/W events, throttle-only comparison,
mute/unmute, wheel contact and repeated track switches. The browser snapshots
also expose boost, active exhaust particles, audio state/volume and texture count.

## Drone camera and Bonneville morning

The Camera menu explicitly selects **Drone · follow** or **Observation · orbit**.
Drone is the default on every ground and after switching vehicles/grounds. It
follows vehicle translation at a fixed relative distance, including during turbo;
heading changes are smoothed and the horizon stays level. Clicking the canvas
does not leave drone mode. The wheel adjusts drone distance. F returns to the
drone; in Observation, the camera stays around its chosen world point while the
vehicle moves, and clicking/right-dragging chooses and orbits an inspection point.

Bonneville uses an early-morning palette: muted off-white salt, warm sunlight,
cool ambient fill and long blue-grey shadows. The shared solar direction sets
both the sky's sun and the directional light to an elevation of 18 degrees.
The effect uses the existing sky shader and shadow map, without bloom, additional
lights or downloaded assets. Other proving grounds retain their lighting.

## Optional Bonneville cruise

Manual remains the default. On P04, select **Driving → Cruise · tap W** and choose
20–55 km/h (default 40). Selecting the mode does not start the car: tap W/ArrowUp
or click **Start cruise**. The car holds that speed without holding the throttle.
A/D still steer. Hold Shift for temporary turbo; releasing Shift smoothly lowers
the target back to the selected cruising speed, with gentle overspeed braking.

S/ArrowDown stops and cancels cruise, and holds the brakes after key release.
It does not engage reverse in Cruise. Start again with a fresh W press or Start.
Reset, mode/ground/vehicle changes, window blur and hidden tabs cancel cruise too.
Holding W through cancellation or receiving key-repeat events cannot restart it.
Other grounds expose only Manual; manual Shift alone never requests throttle
or turbo, and braking takes priority over simultaneous throttle.

Physical controls override development input. The old hidden `autodrive=1`
query behaviour has been removed; automatic driving is now an explicit mode.
Development snapshots include drive mode, cruise state/selected speed and the
resolved drive input for regression checks. Engine audio/exhaust respond to
actual drive load, including partial-throttle cruise.
