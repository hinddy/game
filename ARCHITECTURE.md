# Architecture and extension guide

This refactor preserves the existing four proving grounds, Quadro/BuggY, manual
and optional cruise controls, drone orbit, tablet input, audio, exhaust, and the
three Bonneville content packets. It introduces no second project, no new biome,
no external portal navigation, and no new runtime dependencies.

## Responsibilities

- `src/main.ts`: stylesheet imports, application creation, startup error reporting,
  and HMR disposal.
- `src/app/create-app.ts`: the driving application's composition root. It wires
  services and owns their lifetime. It does not construct terrain or vehicle meshes.
- `src/core`: engine-independent fixed clock, browser frame scheduler, a typed
  registry, and reverse-order resource ownership. Physics runs at 60 Hz with the
  existing catch-up limit; rendering receives interpolation alpha.
- `src/experiences`: the driving session owns Rapier, its ground and its actor;
  progress rules report reset/notice events instead of accessing HTML. A ground
  selects its rules function, so an exploration ground can supply other rules.
- `src/projects/garage.ts`: ground factories, initial project settings, rules and
  optional surface providers. `src/projects/environments.ts` holds lighting,
  fog, projection, horizon, drone range and cruise presets.
- `src/physics`: raycast vehicle controller and contact-surface contract. No model
  geometry, HTML or audio is created here.
- `src/rendering`: scene/camera/light setup, vehicle presentation, steering model
  bindings and owned-geometry disposal. The visual pose and following camera share
  interpolation; reset/teleport snaps both pose endpoints. Physics state is never
  interpolated back into Rapier.
- `src/vehicle.ts`: the existing public driving actor, now a composition of
  physics, presentation and optional exhaust. It owns and releases its controller
  and rigid body before the session frees the world.
- `src/input`: semantic drive input and browser bindings. Keyboard, pad and camera
  listeners have explicit disposal. Blur/hidden/pagehide clear input and suspend
  sound. Page restoration resets elapsed simulation time; sound resumes on input.
- `src/ui`: HTML selectors, labels, status and controls. Frame telemetry writes
  only changed text. CSS and `design/tokens.css` remain the presentation inputs.
- `src/content`: data contracts, bounded JSON loading and chunk lifecycle contract.
- `src/worlds/streamer.ts`: generic residency/build/activation/release coordinator.
  It does not import UIWorld, ThemeBridge, Rapier, named worlds or their labels.
- `src/worlds/garage-content.ts` and `garage-streaming.ts`: adapters for the current
  UI primitives and salt course. They are loaded only on entering Bonneville.

`createApp` is deliberately the current driving composition, not an implemented
universal editor or a free-flight site. The reusable clock, content lifecycle,
renderer profiles and registry can support another composition later without
introducing it into this MVP now.

## Add or change a ground

1. Add its track metadata to `TRACKS` in `src/config.ts`. Current driving grounds
   use the `TrackInstance` contract: spawn, samples/checkpoints, streaming and cleanup.
2. Register its factory in `grounds`, with an environment preset and rules function.
   The factory receives the session's physics world, scene, renderer and theme.
3. Add the corresponding HTML picker button using `data-track`, or replace the
   HTML shell through `src/ui`. The frame loop does not branch on ground names.
4. For a spatially varying terrain, provide `GroundDefinition.surface`. Its
   `sample(contactPoint)` supplies grip for each wheel; the existing grounds use
   their original uniform values. A mud simulation needs its own mechanics;
   changing a surface name or texture alone does not simulate sinking or deformation.

The existing checkpoint/wrong-way rules remain on Bonneville for compatibility.
A new rules function is an explicit choice; a forest is not implicitly a race.

## Add or change a vehicle

- Physics data lives in `src/specs/vehicle.*.json` and is checked against the
  explicit `VehicleSpec` contract; it is no longer inferred from Quadro.
- `model` selects a registered factory in `vehicleModels`. The factory returns
  body, four wheel visuals, steering object, steering axis and ratio.
- Physics and steering animation do not examine the actor ID or its name.
  Custom IDs can reuse either current visual without special cases.
- Register the spec in `VEHICLES` and add a `data-vehicle` picker entry. Four-wheel
  raycast dynamics are the current controller's contract; another drivetrain or
  actor type requires another controller rather than silently interpreting data.
- A future glTF adapter can implement the model factory contract. This refactor
  does not add a glTF pipeline or new models.

## Content and memory ownership

A content instance implements `WorldContent`: bounded `buildStep`, activation
safety, update/picking, snapshot and dispose. The generic streamer gets its factory,
manifest, theme callback and messages by injection. Existing v1 JSON packets remain
compatible; `kind` optionally selects a factory and `data` can carry its payload.
Factories must validate their own extra payload. The current UI adapter still uses
`elements` and keeps its matching rounded collision geometry.

Default budgets: three worlds, 24 MiB of declared estimated resource usage, 64 KiB
of decoded JSON per request, and 2 ms between incremental build decisions. The
constructor budget can override these independently. A single build step/driver
call is not preemptible; factories must cooperate by keeping steps small.
`estimatedBytes` is a conservative content estimate, not measured GPU allocation.
Actual geometry/texture/collider counts and heap behaviour are checked separately.

Requests are cancelled on departure/disposal. A replaced manifest invalidates
pending generations even if it reuses the same ID. Late response/shader callbacks
cannot attach resources to a disposed session. New collision is activated only
when the content reports it is safe. The common Bonneville floor stays present.

App scope owns common theme materials and the renderer; chunks borrow them and
only dispose resources they own. Changing grounds disposes the old session before
creating the next. `Scope` aborts listeners and attempts all cleanups in reverse
order even if one cleanup throws. Browser module and HTTP caches are intentionally
not treated as disposable scene resources.

## Independent quality settings

- `?quality=low` / `?quality=high`: explicit graphics selection.
- `?network=low` / `?network=normal`: explicit loading cadence selection.
- Without overrides, network hints affect loading; low core/memory hints affect
  rendering. Slow internet alone no longer disables shadows on a capable desktop.
- `?smoke=1` remains a development-only conservative test profile.
- None of these settings changes vehicle specs or the simulation step.

## Verification

`bun run verify` runs TypeScript, all tests under `src`, and a production build.
There are 34 current unit/contract tests, including clock equivalence at 30/60/144
Hz, cleanup after errors, response byte limits, cancelled/replaced content,
custom factories, vehicle validation and independent quality policy.

Optional browser tests use an existing Playwright installation through
`PLAYWRIGHT_MODULE_PATH`; no Playwright runtime dependency is added to the game.
Development defaults to `http://127.0.0.1:5173`, preview to port 5174.

- `scripts/joystick-smoke.cjs`: all seven valid ground/vehicle pairs, analog input,
  two-hand touch, reverse, nitro, gesture cancellation and production checks when
  `PRODUCTION_URL` is set.
- `scripts/worlds-smoke.cjs`: theme/material equality, driving between worlds,
  ramps, pressing, 3G/CPU emulation and repeated resource cleanup.
- `scripts/worlds-delayed.cjs`: late packet activation and departure while loading.
- `scripts/worlds-production.cjs`: hashed packet loading and keyboard launch on all
  three salt entry URLs, with no production debug interface.
- `scripts/architecture-smoke.cjs`: real Rapier actor destruction, surface response,
  custom actor ID, interpolation/reset, and three mount/start/dispose cycles with
  exactly one key delivery per press.
- `scripts/salt-precision-smoke.cjs`: the local detail patch still preserves the
  repeating salt pattern through large translations and recentering.

Browser checks are local Edge/Chromium checks and device emulation. They are not
an assertion of identical behaviour on every physical Android/GPU or a deployment
verification. No commit, push or Vercel deployment is part of this refactor.
