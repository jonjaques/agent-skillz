# The `.icon` file format

A bundle (really a directory):

```
AppIcon.icon/
├── icon.json
└── Assets/
    ├── background.svg
    └── glyph.svg
```

Everything below was established by probing `ictool` against real bundles.
Apple documents the app, not the file, so treat this as the reference and
re-probe if a new Xcode changes something.

**Verified against Icon Composer 27.0 (bundle 129), the build inside Xcode 27,
and re-verified against 27.1 (still bundle 129, Xcode 27.1).** `ictool
--version` prints it. The Xcode 26 build reports `1.x`, the Xcode 27 betas
reported `2.0` (which is why WWDC26 coverage says "Icon Composer 2"); the app
now shares Xcode's version number. Where a 1.x build behaves differently it is
noted.

The 27.1 pass corrected three things the 27.0 notes had wrong, all folded in
below: gradient `orientation` is relative to the artwork's bounding box (gotcha
8), `specular: true` means `"automatic"` rather than `"outside"`, and `idiom`
specializations are honored.

---

## The eight things that will cost you an hour

**1. Group index 0 is the FRONT, and so is layer index 0 inside a group.**
`groups[0]` renders on top; the last entry is furthest back. This is the
opposite of most layer formats. Symptom of getting it backwards: a full-bleed
background layer swallows the entire icon and you see nothing but the
background, or a motion trail draws over the object it should sit behind.

**2. Misspelled keys are silently ignored.** `ictool` validates *values*, not
*keys*. `"fil"`, `"ligthing"`, `"fill-specialization"` (singular) all render
without complaint, as if the key were absent. A clean render proves nothing
about the spelling of the keys in it. `iconkit.mjs inspect` and `validate` lint
against the key inventory Icon Composer itself reads; run them.

**3. A plain key beats its `-specializations` array, silently.** Keep both
`fill` and `fill-specializations` on the same object and the plain `fill` wins
in every appearance; dark mode just never applies. No error. The same holds for
every `X` / `X-specializations` pair. The base value goes INSIDE the array as
the entry with no `appearance` key:

```jsonc
// WRONG: dark is ignored
{ "fill": {...}, "fill-specializations": [{ "appearance": "dark", "value": {...} }] }

// RIGHT: base is the first entry, unlabelled
{ "fill-specializations": [
    { "value": {...} },                          // base
    { "appearance": "dark",   "value": {...} },
    { "appearance": "tinted", "value": {...} }
] }
```

**4. The document-level `fill` is replaced by the system's neutral grey in the
Dark appearance.** Use a document-level `fill-specializations` array with a
`dark` entry instead; that *is* honoured. (Icon Composer 1.x offered no way to
control the dark background short of a full-bleed layer; 27.0 does.) But note:
**a gradient `orientation` on the document fill is ignored** in every
appearance. The background gradient always runs top to bottom. If it must run
some other way, draw it as a full-bleed layer at the back, where orientation is
honoured.

**5. Layer fills take a solid or a TWO-stop linear gradient.** Anything else
fails with `Linear gradients require exactly 2 colors`. There is no radial
kind. A layer gradient's `orientation` may point in any direction, diagonals
included, which is the most useful expressive tool in the format.

**6. `color-space-for-untagged-svg-colors` accepts only `"display-p3"`.** Any
other value, `"srgb"` included, makes the entire document unreadable. Omit the
key to get sRGB, which is what plain hex in an SVG means anyway.

**7. A dangling `image-name` is not an error.** It renders as an empty layer,
exit 0. `iconkit.mjs validate` cross-checks every reference against `Assets/`.

**8. A layer gradient's `orientation` is a fraction of the artwork's bounding
box, not of the canvas.** Proven with a bar spanning the left half of the
canvas and `start x 0.25 → stop x 0.75`: the ramp ran from 25% to 75% *of the
bar*. A full-bleed shape hides this, because there the two boxes coincide. So
the same orientation on a small shape and a large one lands in different
places, and any axis computed from canvas geometry is wrong unless the art is
full-bleed. Fix: pin every layer's bounds to the canvas with two transparent
1-pt rects in opposite corners. `fill-opacity="0"` still counts toward the box
(`fill="none"` does not); the squircle mask removes those corners; the render
otherwise differs only in rim antialiasing, under 3% per pixel. `iconkit.mjs`
`svg()` adds them by default (`{ anchor: false }` to opt out).

---

## Document

```jsonc
{
  // Emitted by Icon Composer 27 when a group uses the matching keys. Older
  // builds refuse to open a document listing a feature they do not know,
  // which is the point: the effect is not silently dropped. Any string other
  // than these two makes EVERY build refuse the document ("Could not open").
  "features": ["refractivity", "specular-location"],

  // Optional. Only "display-p3" is legal. Omit for sRGB.
  "color-space-for-untagged-svg-colors": "display-p3",

  // Background, single appearance. Solid, 2-stop gradient, automatic-gradient
  // or a keyword. REPLACED by neutral grey in Dark: prefer the array form.
  "fill": { "solid": "srgb:0.09,0.13,0.37,1.0" },

  // Background per appearance. `tinted` and `clear` entries have no effect
  // here (those backgrounds are always system-derived); `dark` does.
  "fill-specializations": [
    { "value": { "linear-gradient": ["srgb:0.09,0.13,0.37,1", "srgb:0.03,0.04,0.10,1"] } },
    { "appearance": "dark", "value": { "linear-gradient": ["srgb:0.04,0.05,0.19,1", "srgb:0,0.01,0.02,1"] } }
  ],

  "groups": [ /* FRONT first. Apple's guideline is at most 4 */ ],

  // Optional in 27.0 (renders without it). squares = iOS, iPadOS, macOS;
  // circles = watchOS. tvOS and visionOS are not Icon Composer targets and
  // are rejected here.
  "supported-platforms": { "circles": ["watchOS"], "squares": "shared" },

  // Icon Composer 27 localisation keys. Accepted; not exercised by ictool.
  "implicit-asset-mirroring": true,
  "languages": ["ar"]
}
```

`groups` is the only required key (`The data couldn't be read because it is
missing.` without it). `ictool` renders a five-group document; the four-group
limit is Apple's design guidance, and `iconkit.mjs` enforces it because the
groups are the parallax planes and a fifth never helps.

## Group

Groups are the depth planes the system parallaxes independently.

```jsonc
{
  "name": "Mark",                                     // sidebar label only
  "layers": [ /* also FRONT first */ ],
  "specular": true,                                   // edge highlight
  "translucency": { "enabled": true, "value": 0.45 }, // both keys required
  "shadow": { "kind": "neutral", "opacity": 0.5 },    // both keys required

  // Icon Composer 27 (formerly "2.0") controls:
  "lighting": "individual",                           // | "combined"
  "refractivity": { "enabled": true, "strength": 0.58, "depth": 0.61 }, // all three
  "blur-material": 0.5,                               // 0..1
  "specular-highlight-placement": "outside",          // | "inside" | "automatic"

  "opacity": 1, "hidden": false, "blend-mode": "normal",
  "asset-mirroring": { "mirrorable": true }
}
```

Observed in `ictool` 27.0, by pixel-diffing renders with and without the key:

| Key | Effect |
|---|---|
| `lighting` | Changes the render only when the group has 2+ layers. `"individual"` (the default: omitting the key renders identically) lights each layer on its own, so every edge, including a seam between two abutting layers, gets its own specular rim. `"combined"` lights the group as one body: abutting layers fuse and the seams disappear, which is how to build a gradient with more than two stops (`design.md`). Any other string is rejected with a clear message. |
| `refractivity` | Changes the render, with or without `features`. `strength` runs −1…1 and is clamped (−1.5 renders exactly as −1). **Negative is Apple's "inverse refraction"**: the backdrop is drawn toward the rim and wraps around it like a sphere, where positive swirls it like a lens. `strength: 0` and `enabled: false` are both exact no-ops. `depth` (0…1) scales the effect. It bends only what lies *behind* the group, so an opaque mark over a smooth ground barely changes: under 0.1% RMSE in one probe. Icon Composer writes the `features` entry; `iconkit.mjs` does too. Missing `strength` or `depth` fails with "is missing". |
| `blur-material` | Changes the render at 0.5 and 1. `0` and `null` are no-ops. Numeric only: a string such as `"regular"` fails with "isn't in the correct format". |
| `blur` | The 1.x key. Accepted and **inert** in 27.0: no pixel changed at any value. Use `blur-material`. |
| `specular-highlight-placement` | Accepted, **no pixel change** in any probe on 27.0 or 27.1 (single and multi-layer, with a backdrop group, 64 to 256 px, with and without `features: ["specular-location"]`). The inside/outside choice Apple demonstrated at WWDC26 is what `specular` itself does (next row). Write this key if the app wrote it; do not rely on it. |
| `shadow.kind` | `"neutral"` (the UI's *Natural*), `"layer-color"` (the UI's *Chromatic*), `"none"`. `"chromatic"` and other UI spellings are rejected. |
| *all of the above* | **No-ops when no layer in the group has `glass: true`.** `specular: true`, `translucency 0.6`, `shadow` neutral at 1, `blur-material: 1` and `lighting: "combined"` each rendered pixel-identically (RMSE 0, Default and Dark) on a group of `glass: false` layers. |
| `specular` | `true`, `"automatic"`, `"inside"`, `"outside"`, `false`. In 27.1 `true` renders byte-identically to `"automatic"`, and automatic resolved to `"inside"` in Default (over light and dark grounds alike) and to `"outside"` in Dark. (The 27.0 notes said `true` behaves like `"outside"`; that holds only in Dark.) Inside draws the highlight just within the edge; outside draws a halo just beyond it. |

`shadow`, `translucency` and `refractivity` are specialized **as whole
objects** (`shadow-specializations`, with the plain `shadow` dropped). There is
no nested `shadow.kind-specializations`.

## Layer

```jsonc
{
  "image-name": "glyph.svg",     // filename inside Assets/
  "name": "Glyph",               // sidebar label; optional in 27.0
  "glass": true,                 // Liquid Glass on this layer (distinct from group specular)
  "hidden": false,

  // ONE of `fill` or `fill-specializations`; never both (gotcha 3).
  "fill": { "solid": "srgb:0.2,0.6,1.0,1.0" },

  // BOTH keys or neither. `scale` alone fails with "is missing". Translation
  // is in canvas points from the centre; +y is DOWN. Icon Composer omits the
  // object entirely when it is identity, so do the same.
  "position": { "scale": 1, "translation-in-points": [0, -16] },

  "blend-mode": "normal",        // normal | plus-lighter | plus-darker | overlay | multiply
                                 // | soft-light | hard-light | darken | lighten | screen
  "opacity": 1,
  "asset-mirroring": { "mirrorable": true }
}
```

A layer `fill` **overrides the SVG's own colors entirely**. That is a
feature: author artwork as flat single-color shapes and drive all color from
`icon.json`, where appearance variants live. `"fill": "none"` or `"automatic"`
leaves the artwork's own colors in place, and `"automatic"` works as the base
entry of a `fill-specializations` array too (verified byte-identical in
Default), so one appearance can be recolored while the others keep the art.

**A fill paints the artwork's geometry, not its alpha.** Verified on 27.1: a
spark drawn as a radial gradient fading to `stop-opacity="0"` rendered as a
solid disc of its full radius, a shape under a `<mask>` as the whole unmasked
shape, and a blurred bloom as the sharp silhouette it was blurred from. Paint
opacity, gradient stop opacity, masks and filters are all discarded. So a
`tinted` fill on soft artwork, the obvious way to whiten it for Mono, turns it
into hard blobs.

### Artwork that carries its own color

With `glass: false` and no `fill`, ictool 27.1 draws the SVG as authored, and
all of this was verified to render: `linearGradient` and `radialGradient` with
many stops (`userSpaceOnUse` and the default bounding-box units),
`stop-opacity`, `fill-opacity`, `opacity` on a shape, `opacity` on a `<g>`
(composited as a group, so overlapping children leave no seam), `clipPath`,
luminance `<mask>`, and `filter` with `feGaussianBlur`. PNG layers render too.
Xcode 27.1's asset compiler accepts the same bundle, and the flattened
`.icns` it writes for pre-26 deployment targets keeps the blur and the masks.

`glass: true` on the same artwork thresholds it: the blurred disc came back as
a solid disc with a glass rim. Soft light and Liquid Glass do not mix on one
layer.

Don't preview such artwork with ImageMagick: its built-in MSVG renderer drew
a long polyline path as an empty image. Render through ictool, with a
reference image as a PNG layer behind the art when you need to trace
something.

`position` also accepts `"relative-translation": [fx, fy]` (fractions of the
canvas) alongside the two required keys.

### Colour strings

`<space>:<components>`. The colon is mandatory (`Invalid color encoding,
missing ':' delimiter`); bare hex is rejected.

| Form | Example |
|---|---|
| sRGB | `srgb:0.08627,0.12549,0.36863,1.00000` |
| Extended sRGB | `extended-srgb:0.00,0.53,1.00,1.00` (what Icon Composer itself writes) |
| Display P3 | `display-p3:0.08,0.00,0.45,1.00` |
| Grayscale | `gray:0.5,1.0` or `extended-gray:1.00000,1.00000` |
| System colour | `named:system-blue` (also red, green, orange, yellow, brown, pink, purple, gray, teal, indigo, mint, cyan) |

RGB spaces need exactly four components, gray exactly two.

### Fill kinds

| Kind | Shape |
|---|---|
| Solid | `{"solid": "<colour>"}` |
| Linear gradient | `{"linear-gradient": ["<from>", "<to>"], "orientation": {"start":{"x","y"}, "stop":{"x","y"}}}` |
| Automatic gradient | `{"automatic-gradient": "<colour>"}`: the system derives a ramp from one colour |
| Keyword | `"automatic"` (inherit), `"none"` (paint nothing), `"system-light"`, `"system-dark"` |

`orientation` coordinates are 0..1 fractions of the layer artwork's bounding
box, not pixels and not the canvas (gotcha 8; anchor the SVG to make them
canvas fractions). Optional; without it the gradient runs top to bottom.
Honored on layers, ignored on the document fill (gotcha 4).

### Specializations

Any of these keys can be varied per appearance by appending
`-specializations`: `fill`, `glass`, `opacity`, `blend-mode`, `hidden`,
`position`, `image-name`, `asset-mirroring` on layers; `lighting`, `specular`,
`specular-highlight-placement`, `blur-material`, `refractivity`,
`translucency`, `shadow`, `opacity`, `hidden`, `position` on groups.

All follow the same shape and the same base-entry-inside rule as
`fill-specializations`. Each entry is a slot plus a `value`:

| Slot key | Values | Notes |
|---|---|---|
| `appearance` | `light`, `dark`, `tinted` | Omitted = base. `light` is accepted in 27.0 and applies to Default. `tinted` is the GUI's **Mono** annotation and drives all four of TintedLight, TintedDark, ClearLight and ClearDark: a white `tinted` fill turns the Clear renditions bright white too. `"clear"` and `"mono"` are both **rejected** ("isn't in the correct format"). |
| `idiom` | `square`, `iOS`, `macOS`, `watchOS` | Icon Composer 27. **Honored in 27.1**: an `idiom: "macOS"` fill changed the `--platform macOS` render (13% RMSE) and left `--platform iOS` byte-identical. The 27.0 notes recorded no change. |
| `localization` | a locale ID | Icon Composer 27. Accepted; not exercised by `ictool`. |

`"automatic"` as a `value` is only legal where a fill is expected. In an
`opacity`, `hidden`, `blend-mode` or `position` array it is a decode error.

**Tinted:** the tinted *background* is always system-derived; a `tinted` entry
on the document fill does nothing. A `tinted` entry on a *layer* does apply,
and the value is mapped through luminance, so a saturated colour lands as a
grey of matching lightness. It applies to the Clear renditions as well (see
`appearance` above), so it is the one place to tune the icon for Tinted *and*
Clear. Apple's WWDC26 lab advice is near-white foregrounds there, for range.

---

## Renditions

`Default`, `Dark`, `TintedLight`, `TintedDark`, `ClearLight`, `ClearDark`.

`Default` is the light appearance. Tinted and clear are derived by the system
from your layers' luminance, or from their `tinted` specializations where
present; check them. watchOS has `Default` only.

---

## Debugging

Most `ictool` errors name the problem. The two generic ones:

| Message | Cause |
|---|---|
| `The data couldn't be read because it is missing.` | A required sub-key is absent: `shadow` without `opacity`, `translucency` without `value`, `position` with only one of `scale` / `translation-in-points`, `refractivity` without `depth` or `strength`, or no `groups`. |
| `The data couldn't be read because it isn't in the correct format.` | A value of the wrong **type or enum**: `shadow.kind: "chromatic"`, `blur-material: true`, `appearance: "clear"`, `color-space-for-untagged-svg-colors: "srgb"`, `supported-platforms` naming tvOS. Your JSON is fine; a *value* was rejected. Never a misspelled key (those are ignored). |

And the specific ones:

| Message | Cause |
|---|---|
| `Could not open "X.icon".` | An unknown string in `features`. |
| `Linear gradients require exactly 2 colors` | 1 or 3+ stops. |
| `A fill should be one of: "orientation", "solid", "linear-gradient" or "automatic-gradient"` | Fill object has no recognised kind, or more than one. |
| `Invalid color encoding, missing ':' delimiter` | Bare hex or a missing colour space. |
| `Expected four comma separated color components` / `Unknown color name:` | Wrong component count, bad `named:` colour. |
| `A BlendMode must be one of ...` | Bad `blend-mode`. |
| `A Lighting must be one of "individual" or "combined".` | Bad `lighting`. |
| `Invalid encoding of supported platforms - unknown platform values.` | watchOS under `squares`, or iOS under `circles`. |
| *renders, but looks unchanged* | A misspelled key, or a plain `X` shadowing `X-specializations`. `iconkit.mjs inspect` reports both. |

If a "format" error survives the lint, bisect. Strip `icon.json` to the
smallest thing that renders:

```json
{ "groups": [ { "layers": [ { "image-name": "glyph.svg", "name": "G" } ] } ] }
```

Confirm that renders, then add keys back one at a time, rendering after each.
`scripts/iconkit.mjs validate <bundle>` lints, then renders every rendition on
every platform, and prints this procedure on failure.

**Proving a key did something.** Because unknown keys are ignored, render the
document with and without the key and `cmp` the PNGs. That is how every
"observed" claim in this file was made.

---

## `ictool`

The headless renderer. This is what makes the format tractable: you can see
your work without opening the GUI.

```
/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool
```

```sh
ictool --version     # {"bundle-version":"129","short-bundle-version":"27.1"}

ictool AppIcon.icon --export-image --output-file out.png \
  --platform iOS --rendition Default --width 1024 --height 1024 --scale 1

# tinted renditions take a tint
ictool AppIcon.icon --export-image --output-file out.png \
  --platform iOS --rendition TintedDark --width 512 --height 512 --scale 1 \
  --tint-color 0.55 --tint-strength 0.8

# how a device still on iOS/macOS 26 composites the same document
ictool AppIcon.icon --export-image --output-file out26.png \
  --platform iOS --rendition Default --width 1024 --height 1024 --scale 1 \
  --design-generation 26
```

| Flag | Values |
|---|---|
| `--platform` | `iOS` (covers iPadOS), `macOS`, `watchOS` |
| `--rendition` | `Default`, `Dark`, `TintedLight`, `TintedDark`, `ClearLight`, `ClearDark` |
| `--width` / `--height` / `--scale` | Points × scale; `1024 1024 2` writes a 2048 px PNG |
| `--tint-color`, `--tint-strength` | Single numbers, for the `Tinted*` renditions |
| `--design-generation` | `26` or `27`. 27 is the default and changes the output measurably |
| `--light-angle` | Accepted and ignored in 27.0 and 27.1 (it did something in 1.x). The 27 renderer lights from directly above, matching the system UI. |

`--export-image` is the only operation and validation is its side effect:
success prints `{}` and exits 0; failure exits non-zero with the message on
stdout. `node scripts/iconkit.mjs ictool` resolves the path (it honours
`xcode-select` and checks the beta location).

The GUI is `Xcode > Open Developer Tool > Icon Composer`, or
`open -a "Icon Composer" AppIcon.icon`. Icon Composer files in a project open
with `Control-click > Open with External Editor`.

---

## Wiring into Xcode

Drop the `.icon` beside the app source, then set **target > General > App Icons
and Launch Screen > App Icon** to the filename without its extension. The build
setting behind that field is `ASSETCATALOG_COMPILER_APPICON_NAME`. It
supersedes any `AppIcon.appiconset`; Xcode auto-generates legacy images for
older deployment targets. Multiple `.icon` files may live in a project but only
the one matching that field is used.

**Alternate icons** each need their own `.icon`, listed space-separated in
`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` (no extensions). Xcode writes
`CFBundleIcons` / `CFBundleAlternateIcons` into Info.plist from that; do not
hand-edit those keys. Switch at runtime with
`UIApplication.shared.setAlternateIconName(_:)` and read
`alternateIconName` back as the source of truth.
