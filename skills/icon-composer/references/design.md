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
`combined` lights the group as one). Neither has a default worth guessing at;
render both and look. `lighting` only matters when a group holds two or more
layers.

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
the same lightness, so check those two renditions rather than designing for them.

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
