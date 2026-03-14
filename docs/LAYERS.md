# Layers

## Source folder

All source SVG assets live under `zkPhilLayers/`.

The current Sepolia catalog contains:

- `494` raw SVG files
- `494` registered assets
- `468` selectable variants
- `13` ordered layers
- `13` colors
- `4,454,068` total raw SVG bytes

## Colors

- `Brown`
- `Bubblegum`
- `Coral`
- `Espresso`
- `Grape`
- `Green`
- `Midnight`
- `Onyx`
- `Purple`
- `Saphire`
- `SkyBlue`
- `Teal`
- `Turquoise`

## Stack order

This is the canonical registry stack from top to bottom:

| Order | Layer | Selection rule | Assets | Variants |
| --- | --- | --- | ---: | ---: |
| 1 | `Top` | exactly 1 | 13 | 13 |
| 2 | `Eyes` | exactly 1 | 65 | 39 |
| 3 | `JawNose` | exactly 1 | 26 | 26 |
| 4 | `Teeth` | exactly 1 | 26 | 26 |
| 5 | `Spikes` | exactly 1 | 65 | 65 |
| 6 | `Body` | exactly 1 | 52 | 52 |
| 7 | `BodyBase` | exactly 1 | 13 | 13 |
| 8 | `BgOverlay` | 1 to 3 | 39 | 39 |
| 9 | `BgDust` | exactly 1 | 13 | 13 |
| 10 | `BgSpiral` | exactly 1 | 39 | 39 |
| 11 | `BgStars` | exactly 1 | 13 | 13 |
| 12 | `BgNebula` | exactly 1 | 117 | 117 |
| 13 | `BgColor` | exactly 1 | 13 | 13 |

`PhilRenderer` and `PhilNFT` both render these in reverse order so `BgColor` sits at the bottom and `Top` sits at the top.

## Folder mapping

### Top

- Subfolders: `Top1/`
- Styles: `Top1`
- Notes: 1 style, 13 colors

### Eyes

- Subfolders:
- `Eyes1/`
- `Eyes2/Eyes2Frame/`
- `Eyes2/Eyes2Lens/`
- `Eyes3/Eyes3Frame/`
- `Eyes3/Eyes3Lens/`
- Styles: `Eyes1`, `Eyes2`, `Eyes3`
- Notes: `Eyes2` and `Eyes3` are frame + lens combinations

### JawNose

- Subfolders: `JawNose1/`, `JawNose2/`
- Styles: `JawNose1`, `JawNose2`

### Teeth

- Subfolders: `Teeth1/`, `Teeth2/`
- Styles: `Teeth1`, `Teeth2`

### Spikes

- Subfolders: `Spikes1/`, `Spikes2/`, `Spikes3/`, `Spikes4/`
- Styles: `Spikes1`, `Spikes2`, `Spikes3`, `Spikes3Alt`, `Spikes4`
- Notes: `Spikes3` contributes 26 independently selectable files

### Body

- Subfolders: `Body1/`, `Body2/`, `Body3/`, `Body4/`
- Styles: `Body1`, `Body2`, `Body3`, `Body4`

### BodyBase

- Folder: flat `zkPhilLayers/BodyBase/`
- File pattern: `Body<Color>.svg`
- Style: `BodyBase`
- Notes:
- rolls independently from `Body`
- same-color outcomes are intentionally uncommon
- renders underneath `Body`

### BgOverlay

- Subfolders: `Overlay33/`, `Overlay42/`, `Overlay69/`
- Styles: `Overlay33`, `Overlay42`, `Overlay69`
- Notes: 1 to 3 overlay selections per Phil

### BgDust

- Folder: flat
- Style: `Dust`

### BgSpiral

- Subfolders: `Spiral1/`, `Spiral2/`, `Spiral3/`
- Styles: `Spiral1`, `Spiral2`, `Spiral3`

### BgStars

- Folder: flat
- Style: `Stars`

### BgNebula

- Subfolders: `BgNebula1/` through `BgNebula9/`
- Styles: `BgNebula1` through `BgNebula9`

### BgColor

- Folder: flat
- Style: `BgColor`

## Chunking rules

SVG handling is size-based only:

- `<= 24,576` bytes: single transaction
- `> 24,576` bytes: chunked upload + on-chain finalize

No SVGs are compressed, simplified, or rewritten during upload.
