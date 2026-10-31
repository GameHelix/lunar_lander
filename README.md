# 🚀 LUNAR LANDER

The classic vector arcade game, redrawn in glowing neon: ride a lander down through lunar gravity on a single tank of fuel and set it on a flat pad, soft and upright, with both feet. Built with **Next.js 16**, **TypeScript** (strict) and **Tailwind CSS v4**. Every moonscape is grown from a seed, with fractal ridges and four flat pads whose multipliers rise as they narrow. The physics runs on a fixed 120 Hz step with exact constant-acceleration integration. The instruments turn green, amber or red using the same limits as the touchdown judge, so the panel teaches you to land.

## ✨ Features

| | |
| --- | --- |
| 🌑 Seeded moonscapes | Midpoint-displacement terrain, wider than a screen, new every level and identical for the same seed |
| 🎯 Four pads | ×1, ×2, ×3 and ×5: the narrower the pad, the bigger the prize, labelled on the ground |
| ⚖️ Honest judge | Both feet on one pad; descent, drift and tilt each rated safe, hard or crash, with the reasons spelled out |
| 🪂 Hard landings | Rough but survivable touchdowns score less and refuel half |
| 🔭 Smooth zoom | The camera frames the whole scene up high and closes in near the ground, with an altitude shadow underneath |
| 🧭 Live instruments | Altitude, speeds with arrows, tilt and pad guidance, coloured by the touchdown limits |
| 📈 Rising challenge | Each level brings stronger gravity, narrower pads and smaller refuels; fuel carries over, and you have three landers |
| 🎚 Three difficulties | Cadet, Pilot (true lunar gravity) and Commander, each with its own gravity, tanks and tolerances |
| 💥 Neon effects | Flickering exhaust, blown dust, sparks, tumbling wreckage and landing fireworks, toned down for reduced motion |
| 📱 Keyboard + touch | Arrow or WASD keys; on phones, big THRUST and rotate buttons that work with two thumbs at once |
| 🔊 Procedural audio | Web Audio engine rumble, low-fuel beeps, landing chime and crash boom, with no asset files |
| 🏆 Best records | Best score and furthest level per difficulty, saved locally |

## 🎮 How to play

1. Pick a difficulty and start the mission. The lander drops in high up, drifting sideways.
2. Rotate it and fire the main engine to fight gravity and steer. Thrust burns fuel.
3. Line up over a pad (the **PAD** readout points the way) and sink slowly with the lander upright.
4. Touch down with both feet on the pad, inside the speed and tilt limits. A little over is a hard landing; more is a crash.
5. Each landing scores **base × multiplier** plus fuel and softness bonuses, refuels the tank and moves you to a harder level. Lose all three landers, or crash with dry tanks, and the mission is over.

**Keys:** `←` `→` or `A` `D` rotate · `↑`, `W` or `Space` thrust · `P` or `Esc` pause · `Enter` continue. **Touch:** hold ⟲, THRUST and ⟳.

## 🛠 Tech

- **Next.js 16** (App Router) + **React 19**
- **TypeScript 5**, strict mode
- **Tailwind CSS v4** via `@tailwindcss/postcss`
- **Vitest 3** for the core-logic unit tests
- Pure, framework-free game engine (seeded terrain and pads, fixed-step physics, collision, landing judge, scoring, level progression, camera and effects) under `src/lib/game`

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build    # production build
npm test         # run the unit tests
npm run lint     # lint the project
```
