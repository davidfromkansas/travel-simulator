# Italy Walk — a travel simulator

Walk a 3D character around a fictional Italian town built from photos with
[Marble](https://marble.worldlabs.ai) (Gaussian splats) and rendered with
[Spark](https://sparkjs.dev) + Three.js.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

## Controls

| Key | Action |
|-----|--------|
| ↑ / W | walk forward |
| ↓ / S | walk back |
| ← → | turn |
| A / D | strafe |
| Shift | run |

## Adding your Italian town

The app runs on a placeholder grid until you drop in a Marble world:

1. Generate a town in Marble (or via `~/marble_world.py`) and export:
   - the **Gaussian splat** → save as `public/worlds/town.spz`
   - the **collider mesh (.glb)** → save as `public/worlds/collider.glb`
2. Reload. The splat becomes the visible town; the collider (invisible) gives
   the character ground to walk on and walls to bump into.

If the town loads sideways or upside-down, adjust `SPLAT_ROTATION_X` in
`src/main.js` (Marble splats usually need a 180° flip on X).

## Swapping the character

Replace `public/models/Soldier.glb` with any rigged glTF that has `Idle`,
`Walk`, and `Run` animation clips (or rename the clips referenced in
`src/main.js`). Mixamo characters work well — export as glTF.

## Tuning

Movement speeds, turn rate, and camera distance are constants at the top of
`src/main.js`.
