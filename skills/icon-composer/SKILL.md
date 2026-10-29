---
name: icon-composer
description: Use when creating or editing an Apple app icon in Icon Composer (.icon bundle) format for iOS, iPadOS, macOS or watchOS, including Liquid Glass layers, light/dark/tinted appearances, per-layer gradients, refractivity and lighting, build-variant icons (Debug/Beta/Tests), or rendering and verifying an icon with ictool. Also use when asked to look at, inspect, debug or modify an existing .icon file, when an icon.json fails with "The data couldn't be read", or when an edit to icon.json renders with no visible change.
---

# Icon Composer

Build and edit `.icon` bundles, Apple's layered Liquid Glass app icon format
(Xcode 26+). Vector artwork plus an `icon.json` that owns all colour, lighting
and material.

## Operating rules

1. **Render and look. Always.** Every structural mistake in this format is
   invisible in the JSON and obvious in a render. Never report an icon as done
   without having viewed it.
2. **Colour lives in `icon.json`, not the SVG.** A layer `fill` overrides the
   artwork entirely. Author flat single-colour shapes and drive everything from
   the document; that is also the only place appearance variants exist.
3. **Bake nothing.** No shadows, blurs, specular, opacity, translucency,
   background fills or corner masks in the artwork. The system applies all of it.

   The one exception to rules 2 and 3 is a mark made of **light rather than
   glass** (glow, aurora, neon, flame): glass and layer fills cannot draw soft
   light, so there the SVG carries its own gradients, masks and blurs and every
   layer opts out of glass. See `references/design.md`, "Light, not glass".
4. **`groups[0]` is the FRONT.** Opposite of most layer formats.
5. **Lint, because `ictool` will not.** It validates values, not keys: a
   misspelled key renders fine and does nothing. `iconkit.mjs validate` catches
   that, plus dangling image references and shadowed specializations.
6. **Work in bounded passes.** Build fully → inspect once (batched) → fix in one
   batch → confirm once → stop.

## Setup

```sh
SKILL=<directory containing this SKILL.md>    # e.g. ~/.agents/skills/icon-composer
node $SKILL/scripts/iconkit.mjs ictool         # verify Xcode 26+ / ictool is present
```

Requires macOS with Xcode 26+ (Icon Composer ships inside it) and Node 18+.
ImageMagick is optional and only improves the contact sheets. The scripts
were verified against Icon Composer 27.0 and 27.1 (Xcode 27.x); `ictool
--version` prints yours. What the 27 renderer changed, and what Apple advised
at WWDC26, is summarized at the top of `references/design.md`.

---

## Task: edit an existing icon

> "Look at the icon at /some/path/AppIcon.icon and make X & Y edits"

```sh
node $SKILL/scripts/iconkit.mjs inspect /path/AppIcon.icon   # structure, fills, per-appearance values, lint
$SKILL/scripts/preview.sh /path/AppIcon.icon                 # then READ the sheets it prints
```

`inspect` flags the silent killers: a layer carrying both `fill` and
`fill-specializations` (the plain key wins in every appearance and dark mode
never applies), misspelled keys, and images that are not in `Assets/`.

Then:

1. Check whether a generator script produced this bundle (look for a `.mjs`
   beside it, or a comment in `icon.json`). **If one exists, edit the generator
   and re-run it.** Hand-editing a generated bundle strands the source.
2. Otherwise edit `icon.json` directly. Most requests (recolouring, adding dark
   mode, toggling glass, changing depth) are JSON-only and need no new artwork.
   Keep the file's key order and only add a `-specializations` array when an
   appearance actually differs.
3. Re-run `preview.sh` and read the sheets. Then `iconkit.mjs validate` before
   declaring done.

Read `references/file-format.md` before any structural edit.

## Task: create a new icon

> "Create a new iOS icon for Icon Composer. It should look like X, Y, Z…"

1. **Read `references/design.md` first.** It carries the constraints that decide
   whether the thing works, and the failure modes worth designing around.
2. **Inherit the palette** if this represents an existing product: take exact
   values from its theme, tokens or config rather than approximating.
3. **Write a generator script**, do not hand-author the bundle. Copy
   `examples/corridor.mjs` as the template; it imports `scripts/iconkit.mjs` and
   demonstrates perspective geometry, tapered ribbons, light/dark
   specializations, and the selective-glass split. A script makes the icon
   reproducible, diffable and tunable, and colour variants become a loop.
4. **Render, look, fix once, confirm.**

```sh
node my-icon.mjs ./out
node $SKILL/scripts/iconkit.mjs validate ./out/AppIcon.icon
$SKILL/scripts/preview.sh ./out/AppIcon.icon
```

### Build variants

Debug / Beta / Tests icons keep **identical geometry** and rotate only hue:
distinguishable at a glance, obviously the same app. In a generator this is one
palette table and a loop, so ship all variants together rather than one at a time.

---

## The gotchas that cost the most

Full detail in `references/file-format.md`.

1. **`groups[0]` is the front**, and so is `layers[0]` within a group. Get it
   backwards and a background layer hides the whole icon.
2. **Misspelled keys are silently ignored.** A clean render proves nothing about
   the keys. Run the lint.
3. **A plain key beats its `-specializations` array.** `fill` next to
   `fill-specializations` means dark mode silently never applies. The base
   value goes inside the array, unlabelled.
4. **The document `fill` is replaced by neutral grey in Dark.** Use a document
   `fill-specializations` array with a `dark` entry. Its gradient `orientation`
   is ignored (always top to bottom); a directional background must be a
   full-bleed layer.
5. **Layer gradients take exactly two stops, linear only.** Orientation may be
   any angle, diagonals included.
6. **`color-space-for-untagged-svg-colors` accepts only `"display-p3"`.** Any
   other value makes the document unreadable. Omit it for sRGB.
7. **A missing image file is not an error.** The layer renders empty.
8. **Gradient `orientation` is a fraction of the layer's bounding box, not the
   canvas.** Invisible on full-bleed art, wrong everywhere else. `svg()` pins
   every layer to the canvas with two transparent corner rects; keep them in
   any SVG you write by hand.
9. **More than two stops means several layers in one `lighting: "combined"`
   group.** Combined lights the group as one glass body, so abutting segments
   fuse without seams; "individual" gives every seam its own rim. Or put the
   stops in the SVG itself (next item).
10. **Soft artwork survives only with `glass: false` and no layer `fill`.**
    Glass turns a layer's alpha into a hard slab (a blurred disc renders as a
    solid disc with a rim), and a `fill` paints the artwork's *geometry* with
    its opacity, masks and blur discarded. With both off, ictool 27.1 renders
    the SVG as drawn: multi-stop linear and radial gradients, stop and fill
    opacity, clip paths, luminance masks, Gaussian blur.
11. **Group effects need a glass layer.** On a group whose layers are all
    `glass: false`, `specular`, `translucency`, `shadow`, `blur-material` and
    `lighting` render pixel-identically to leaving them out.

**"The data couldn't be read because it isn't in the correct format"** means a
rejected *value* (wrong type, bad enum, tvOS in `supported-platforms`), never
bad JSON and never a misspelled key. **"…because it is missing"** means a
required sub-key: `shadow.opacity`, `translucency.value`,
`position.translation-in-points`, `refractivity.depth`, or `groups`.
`iconkit.mjs validate` prints the bisect procedure on failure.

---

## Wiring into Xcode

Place the `.icon` beside the app source, then set **target > General > App Icons
and Launch Screen > App Icon** to the filename without extension. It supersedes
any `AppIcon.appiconset`. Do not edit the Xcode project unless asked.

---

## Files

| Path | What |
|---|---|
| `references/file-format.md` | `icon.json` schema, every gotcha, error messages, `ictool`, Xcode wiring |
| `references/design.md` | Apple's rules plus what actually makes these icons good |
| `scripts/iconkit.mjs` | Library (`buildIcon`, `gradient`, `appearances`, `ribbon`, …) + `inspect`/`validate` CLI with lint |
| `scripts/preview.sh` | Renders appearance, small-size and design-generation contact sheets to read |
| `examples/corridor.mjs` | Complete worked generator; copy this to start |
