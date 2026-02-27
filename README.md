# Phil13 Local Stack (Fragments Route)

This repository now uses the **fragments renderer architecture**:

- Canonical full outputs: `Layers/Phil0.svg` ... `Layers/Phil5.svg`
- Fragment exports per Phil: `Layers/Phil0/` ... `Layers/Phil5/`
- Fixed fragment slot order on-chain:
  1. `BgColor`
  2. `BgNebula`
  3. `BgStars`
  4. `BgDust`
  5. `Body`
  6. `BodyShapes`
  7. `Eyes`
  8. `JawLine`
  9. `Spikes`
  10. `Teeth`
  11. `Top`

## Rendering model

- Renderer assembles SVG from fragment slots stored in `PhilFragments` (SSTORE2 pointers).
- Palette data is stored in `PhilPalettes` as packed `bytes3` colors (SSTORE2 pointers).
- Fragments may be stored raw or DSL-encoded (`PhilDSLDecoder` supports v1 + v2).
- Color application uses explicit slot tokens (`@00`, `@01`, ...), no regex guessing.
- `renderPhil(philId, paletteVariant, mixSeed, mixMode)` is deterministic.

## Core commands

```bash
npm install
npm run fragments:build
npm run render:verify
npm run fragments:deploy
npm run render:all
npm test
npm run local:e2e
npm run dev:e2e
npm run frontend:smoke
npm run renderer:report
npm run gas:report
```

## Docs

- Local RPC setup: `README_LOCAL_NODE.md`
- Local e2e flow: `README_E2E.md`
- Frontend connect/verify/mint journey: `README_FRONTEND_E2E.md`
- Gas + USD reporting: `README_GAS.md`
