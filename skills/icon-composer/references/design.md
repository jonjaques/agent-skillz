# Designing a Liquid Glass icon

## What Apple requires

**Canvas.** 1024×1024 for iOS, iPadOS and macOS. 1088×1088 for watchOS (circular
mask). Design at the layout size; the system produces every smaller variant.
(tvOS and visionOS are not Icon Composer targets; they still use asset-catalog
image stacks.)

**Layers.** At most **four groups**. They are the depth planes the system
parallaxes, not an organisational convenience. `ictool` will render more, but
the fifth never helps and the GUI is built around four.

**Vector.** Export SVG wherever possible; PNG only for effects SVG cannot carry.
Convert text to outlines; SVG does not preserve fonts. An asset smaller than the
canvas renders at its native size, centred, rather than scaled up.

**Never bake these in.** Icon Composer applies them, and baked copies fight the
system's own:

- blurs, drop shadows, glows, bevels
- specular highlights and refraction
- opacity and translucency
- background colours and gradients (set them in `icon.json`)
- the rounded-corner canvas mask

**Shape.** Provide square, full-bleed layers. The system masks to the final
shape and matches the device's own corner curvature. Pre-masked layers wreck the
specular pass and make edges look jagged.

**Safe zone.** Keep primary content centred and away from the edges. The system
crops during focus and motion, and it crops **foreground layers more than
background layers**.

**Small sizes.** Avoid hairlines and sharp corners; they lose crispness at
40 px. Avoid soft, feathered edges on foreground shapes; the system's highlights
need defined edges to catch.

If you import a background layer, make it full-bleed and opaque.

---

## What the 27 releases changed

Icon Composer 27 (the "Icon Composer 2" of the Xcode 27 betas and WWDC26
coverage) ships a new, sharper renderer for iOS/macOS 27, and existing `.icon`
files pick it up automatically. Apple says no recompile is needed for an app
to get the new look. What Apple said, what was verified here, and what is only
reported:

- **Sharper glass, more of it.** Apple's 27 icons gain definition by
  "integrating additional layers of Liquid Glass directly into the icon
  artwork": several distinct glass bodies on separate groups, rather than one
  thick glass over finished art, which is what read as blurry on 26. For your
  own icons that means slicing elements into their own groups, and exposing
  shapes the flat design hid or subtracted, so each one gets its own rim.
- **Less translucency.** Apple reduced translucency in its own icons for 27
  and said in the WWDC26 lab that this is *not* automatic: lower yours.
  Sharpness and legibility both improve.
- **Refraction you can tune, including inverse.** A strength (−1…1) and a
  depth per group; negative strength wraps the backdrop around the rim, the
  effect on the edges of the new Photos icon. Verified; see `file-format.md`.
- **Specular placement.** Inside, outside, or automatic, chosen per group;
  review it wherever layers overlap. Verified as the `specular` key.
- **Light from above.** The renderer lights from directly overhead, matching
  the system UI; `--light-angle` is ignored. Reported, not verified: the
  gyroscopic shimmer of 26 is gone.
- **One Mono annotation** covers Tinted and Clear in both appearances. Verified:
  it is the layer `tinted` slot.
- **Back-deployment preview.** `--design-generation 26` shows how a device not
  yet on 27 composites the same file. Apple's aim is "a reasonable version of
  the same icon identity" there, not a pixel match.
- **Legacy bitmap icons** are segmented and adapted by the 27 system on its own
  ("will do its best"); full control needs an Icon Composer file.

Sources: [Platforms State of the Union, WWDC26](https://developer.apple.com/videos/play/wwdc2026/102/),
[Icon Composer for Beginners group lab, WWDC26](https://developer.apple.com/videos/play/wwdc2026/8012/)
(notes: [antongubarenko.substack.com](https://antongubarenko.substack.com/p/wwdc26-icon-composer-for-beginners),
[kruschel.dev](https://kruschel.dev/notes/wwdc26-group-labs/wwdc2026-8012)),
[developer.apple.com/icon-composer](https://developer.apple.com/icon-composer/),
[MacStories on the macOS 27 icon refinements](https://www.macstories.net/linked/wwdc-2026-macos-27-icon-refinements/).
Every verified claim was proven by pixel-diffing ictool 27.1 renders.

---

## What actually makes these icons good

These are the expensive lessons. Each one cost a rebuild.

### Apply glass selectively, not globally

**Liquid Glass flatters solid volumes and ruins thin line art.** A sphere, a
blob, a chunky glyph become genuinely beautiful glass. Strokes, rails, hairlines
and outlines go soft and mushy; glass eats exactly the edges that were carrying
the meaning.

So: `glass: true` on the solid masses, `glass: false` on the linework. That split
is usually the single biggest quality jump available, and it is per-layer.

Related: **translucency mixes a layer down into whatever is behind it.** A thin
ribbon at `0.45` loses its colour entirely and reads grey. Drop thin elements to
`~0.2`; solid volumes can take `0.5+`.

Icon Composer 27 adds two more group controls, both pixel-verified to change
the render: `refractivity` (strength and depth of the lens effect on glass
layers) and `lighting` (`individual` lights each layer as its own body,
`combined` lights the group as one). `lighting` only matters when a group
holds two or more layers, and `combined` is the key to the next technique.

### A spectrum is several layers lit as one

A layer gradient has exactly two stops, so a rainbow, or any ramp that bends
through a third hue, cannot be one layer: blue to red interpolates through
magenta, not green. The way out:

1. Cut the shape into lengthwise segments, one layer each, with each segment's
   two stops picking up exactly where its neighbor's left off.
2. Put all of them in **one group with `lighting: "combined"`**. The group is
   then lit as a single glass body and the seams vanish. With `"individual"`
   every cut grows its own specular rim and the shape reads as a row of tiles.
3. **Anchor every segment's SVG to the full canvas** (`iconkit.mjs` `svg()`
   does it by default). Gradient orientation is relative to each layer's own
   bounding box, so without the anchors the stops of short and long segments
   land in different places and nothing meets at the cuts: you get visible
   steps of flat color, which is exactly what it looks like when this is wrong.
4. Space the cuts by **arc length**, not by Bézier parameter, or they bunch up
   where the curve bends. Let each segment reach back a few points under its
   neighbor so antialiasing never opens a hairline at a cut.

Eight segments along a full-canvas stroke was where the two-stop
approximation of a cosine palette stopped showing steps.

### Refraction needs something behind it

Refraction bends what lies behind the group. Over a smooth gradient ground an
opaque mark has nothing to bend: in one probe, strength ±0.5 on the frontmost
group changed under 0.1% of the image. It earns its place when a group sits
over *structure* (stripes, a pattern, another glass body), and Apple's advice
is to put it on layers that sit under the glass and keep the primary mark
unrefracted, since refracting the mark is part of what read as blurry on 26.
Don't add structure just to have something to refract; it costs the
composition more than the effect is worth.

### Light, not glass

Some marks are not objects: a flame, an aurora, a neon line, a spark. Glass
makes them worse, because it turns every soft edge into a hard slab, and layer
fills cannot help, because they are two stops at most and discard the
artwork's alpha. Build these from light instead, with the color in the SVG
and `glass: false` on every layer (`file-format.md`, "Artwork that carries its
own color"). What made one such icon, a rainbow flame of six ribbons, read as
silk of light rather than a striped leaf:

- **Light each ribbon along one edge.** The body is a stack of nested slices
  that all share the ribbon's upper edge, used as a luminance mask, so coverage
  is highest along that edge and falls off across the ribbon. Blur the mask to
  blend the steps and clip it to the ribbon so the lit edge stays crisp. Leave
  the last third of each ribbon empty: those dark seams between ribbons are
  what stop the whole thing reading as one solid shape.
- **Draw the lit edge as its own layer with `blend-mode: "plus-lighter"`**: a
  crisp line over a blurred copy of itself, so crossings add up the way light
  does. End the edges short of the point where they all converge, or they sum
  to a white blob there.
- **Keep the bodies at `normal` blend.** Plus-lighter on the bodies too pulled
  every warm hue toward pink and white over a blue ground, and red vanished.
- **Run hue along one straight axis** (a single SVG linear gradient per
  ribbon, with its own stops) rather than along each ribbon's length. Following
  the length meant cutting the ribbon into tiles, and their antialiased seams
  showed as cross-hatching. A radial gradient centered on the root was
  seamless but put green at the far end of the hook, where the concept was blue.
- **Add a bloom and a halo behind**, as layers: the silhouette blurred heavily
  at about half opacity, and a broad radial glow. The document fill can only
  run top to bottom, so light *around* the mark must be a layer. A build
  variant that changes the ground must change the halo with it: a violet halo
  over an orange Debug ground turned it maroon.
- **Leave Tinted and Clear to the system.** Bright light on a dark ground maps
  through luminance to white over the tint, which is the near-white foreground
  Apple asks for, with no specialization at all.

The groups are still separate depth planes (sparks in front, ribbons, glow at
the back), so the system still parallaxes them, but none of the group's glass
controls apply: with no glass layer they are no-ops.

### Shadows can be light

`shadow.kind: "layer-color"` (the UI's Chromatic) casts the layer's own color.
Under a vivid mark on a dark ground that reads as light spilling from the mark,
a glow the system draws, where a neutral shadow at the same opacity reads as a
smudge. Opacity 0.6–0.8 under the hero group. Keep `neutral` for marks whose
color is muddy, and for groups that only need to show they pass beneath another.
The shadow is cast only by glass layers; under a group of `glass: false` layers
it does nothing, and a glow there has to be drawn (previous section).

### Let a gradient do the lighting

The two-stop layer gradient is the most under-used tool in the format. Not for
decoration: for **direction**.

Four lines radiating from a vanishing point at equal weight read as a *graphic X
drawn over the icon*. The same four lines dark at one end and bright at the
other read as a *room you are standing in*. Identical geometry; one gradient axis
is the entire difference between a diagram and a place.

Give a motion trail a gradient along its own direction of travel and it reads as
arriving rather than as a static swoosh.

The document background is the one place this does not work: its gradient
always runs top to bottom, whatever `orientation` says. A background that must
light from a corner has to be a full-bleed layer at the back.

### Outlines do not create depth; value does

Concentric strokes of similar weight read as picture frames stacked inside each
other, no matter how correct the perspective maths. Depth needs a **value
ramp**: either shaded planes, or a gradient across the linework, or both.

If you are drawing receding geometry, derive size *and* stroke weight from the
same `1/z` law. Equal-weight nested shapes are the tell that nothing is receding.

### Fewer elements, heavier

Two depth rings read as distance; four read as a wireframe box. When something
looks busy, delete rather than thin; thinning makes it mushy at 40 px and busy
at 1024.

### Composition traps

- **A curve whose two ends both sit near the middle will curl into a comma.**
  Push the head far out toward a corner; the same lateral swing then reads as a
  bend in a long run.
- **A tapered trail should end as its subject's silhouette.** Set the ribbon's
  head half-width to the subject's radius and put the subject on the endpoint,
  with the subject in a nearer group. Otherwise a crescent of trail leaks past
  the edge and reads as a bug.
- **A dim element crossing the brightest element** reads as a scratch. Route
  around it or start it elsewhere.
- **A bright rounded rectangle in the centre reads as a label or a TV.** Tint it
  into the palette's own hue instead of letting it go near-white.

### Light and dark

Do not design two icons. Design **one room at two exposures**: dark drops the
background nearly to black and lifts every emissive element, which is what neon
does when the house lights go off. The mark keeps its identity instead of being
swapped for a flat monochrome stand-in.

The dark background goes in the document's `fill-specializations` (a plain
document `fill` is replaced by neutral grey in Dark; see gotcha 4 in
`file-format.md`). Tinted and Clear backgrounds are always the system's; you
can only recolour layers there, and a saturated tinted value lands as a grey of
the same lightness.

The layer `tinted` slot is Icon Composer's Mono annotation and drives Clear as
well as Tinted. Leave it out and the system derives the mono stroke from your
colors' luminance: a rainbow comes out dim wherever it is blue and flat
elsewhere. Apple's WWDC26 lab advice is to maximize range: real darks, and
foreground elements near white. A gray ramp from about 0.8 up to 1.0 along
the mark gives you crisp white glass in Clear and a high-contrast glyph in
Tinted, while keeping a hint of direction.

### Colour

If the icon represents an existing product, take the palette from the product's
own source of truth (its theme file, tokens, or config) rather than inventing
one that merely looks similar. Inherit the exact values.

Build variants (Debug, Beta, Tests) should keep **identical geometry** and rotate
only hue. They need to be distinguishable at a glance on a home screen while
remaining obviously the same app.

---

## Verification

You cannot judge this format by reading JSON. Every structural mistake
(inverted group order, a background swallowing everything, glass melting the
linework, a trail crescent) is invisible in the source and obvious in a render.

Render and **look**, at three scales:

- **1024 px**: craft, gradients, glass behaviour
- **80 px**: the real home-screen size
- **40 px**: Settings and notifications; the silhouette test

Plus Dark and TintedDark, which are the two most likely to surprise you, and
design generation 26, which is how the icon looks on a device that has not
updated.

`scripts/preview.sh <bundle>` produces exactly these as contact sheets.

Work in **bounded passes**: build fully, inspect once in one batched round, fix
everything it shows in a single batch, confirm once, stop. Do not iterate
one-tweak-one-render; it burns time and converges slower than a considered batch.
