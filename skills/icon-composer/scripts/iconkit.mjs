#!/usr/bin/env node
// iconkit: build, inspect and validate Apple Icon Composer (.icon) bundles.
//
// Use as a library from a generator script:
//
//   import { buildIcon, iconDocument, group, layer, gradient, solid, appearances } from "./iconkit.mjs";
//
// Or as a CLI:
//
//   node iconkit.mjs inspect  <bundle.icon>     # readable structure dump + lint
//   node iconkit.mjs validate <bundle.icon>     # lint, then render every rendition x platform
//   node iconkit.mjs ictool                     # print the resolved ictool path
//
// Every constraint encoded here was established by probing ictool (Icon
// Composer 27.0 and 27.1, Xcode 27), not from documentation. See
// ../references/file-format.md for the reasoning behind each one.
//
// No dependencies. Node 18+.

import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// ── Canvas ───────────────────────────────────────────────────────────────────
export const CANVAS = { ios: 1024, macos: 1024, watchos: 1088 };

// ── Colour ───────────────────────────────────────────────────────────────────
// Colour spaces ictool accepts. "named:" takes a system colour (named:system-blue).
const COLOUR_SPACES = ["srgb", "extended-srgb", "display-p3", "gray", "extended-gray", "named"];

/**
 * "#RGB", "#RGBA", "#RRGGBB" or "#RRGGBBAA" -> the "srgb:r,g,b,a" string the
 * format wants. Shorthand is expanded rather than truncated: silently reading
 * "#fff" as 0x000FFF produces a plausible-looking wrong colour, which is far
 * worse than an error.
 */
export const srgb = (hex) => {
  let h = String(hex).replace("#", "").trim();
  if (!/^[0-9a-fA-F]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) {
    throw new Error(`bad hex colour "${hex}": expected #RGB, #RGBA, #RRGGBB or #RRGGBBAA`);
  }
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return `srgb:${[(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => (v / 255).toFixed(5))
    .join(",")},${a.toFixed(5)}`;
};

/**
 * Accepts a hex colour OR an already-encoded "<space>:<components>" string
 * (srgb, extended-srgb, display-p3, gray, extended-gray, named:system-*), so a
 * palette can mix hex from a theme file with P3 values from a designer.
 */
export const color = (c) => {
  const s = String(c).trim();
  const i = s.indexOf(":");
  if (i > 0) {
    const space = s.slice(0, i);
    if (!COLOUR_SPACES.includes(space)) {
      throw new Error(`unknown colour space "${space}" in "${s}"; ictool accepts ${COLOUR_SPACES.join(", ")}`);
    }
    return s;
  }
  return srgb(s);
};

export const solid = (c) => ({ solid: color(c) });

/** The system derives a two-stop ramp from a single colour. */
export const automaticGradient = (c) => ({ "automatic-gradient": color(c) });

/**
 * A two-stop linear gradient. TWO stops is a hard limit; ictool reports
 * "Linear gradients require exactly 2 colors" for anything else, and there is
 * no radial kind. `start`/`stop` are canvas-normalised [x, y] and may point in
 * any direction, diagonals included.
 *
 * Orientation is honoured on LAYER fills only. On the document background
 * fill it is accepted and ignored: the background always runs top to bottom.
 * Draw a full-bleed layer if the background gradient must have a direction.
 */
export const gradient = (stops, orientation) => {
  if (!Array.isArray(stops) || stops.length !== 2) {
    throw new Error(`gradient needs exactly 2 colour stops, got ${stops?.length}`);
  }
  const g = { "linear-gradient": stops.map(color) };
  if (orientation) {
    const [start, stop] = orientation;
    g.orientation = { start: { x: start[0], y: start[1] }, stop: { x: stop[0], y: stop[1] } };
  }
  return g;
};

/**
 * Build an `X-specializations` array (fill, glass, hidden, opacity, position,
 * image-name, shadow, translucency, ...).
 *
 * CRITICAL: the base value must live INSIDE this array as an entry with no
 * `appearance` key, and the object must NOT also carry the plain key `X`. Emit
 * both and the plain key silently wins in every appearance, with no error.
 *
 * Appearance tokens are "light", "dark" and "tinted". The unlabelled base entry
 * already covers light, so `light` is only useful when the base is something
 * else, for example when base is `"automatic"`.
 *
 * Tinted and Clear backgrounds are always system-derived; a `tinted` entry only
 * has an effect on layers, not on the document fill.
 */
export const appearances = ({ base, light, dark, tinted }) => {
  if (base === undefined) throw new Error("appearances() needs a base value");
  const out = [{ value: base }];
  if (light !== undefined) out.push({ appearance: "light", value: light });
  if (dark !== undefined) out.push({ appearance: "dark", value: dark });
  if (tinted !== undefined) out.push({ appearance: "tinted", value: tinted });
  return out;
};

// ── Structure ────────────────────────────────────────────────────────────────
const BLEND_MODES = ["normal", "plus-lighter", "plus-darker", "overlay", "multiply", "soft-light", "hard-light", "darken", "lighten", "screen"];

/**
 * A layer position. Both keys are required together: `scale` without
 * `translation-in-points` fails with "The data couldn't be read because it is
 * missing." Translation is in canvas points; +y moves DOWN.
 */
export const position = ({ scale = 1, translate = [0, 0] }) => ({
  scale,
  "translation-in-points": translate,
});

/**
 * One layer. Pass `fill` for a single appearance, or `specializations` (built
 * with `appearances()`) for light/dark/tinted. Never both.
 */
export const layer = ({ name, image, fill, specializations, glass = true, hidden = false, opacity, blendMode, position: pos, hiddenSpecializations, imageSpecializations }) => {
  if (fill && specializations) {
    throw new Error(`layer "${name}": pass fill OR specializations, never both; see appearances()`);
  }
  if (image && imageSpecializations) {
    throw new Error(`layer "${name}": pass image OR imageSpecializations, never both`);
  }
  if (!image && !imageSpecializations) throw new Error(`layer "${name}": needs an image`);
  if (blendMode && !BLEND_MODES.includes(blendMode)) {
    throw new Error(`layer "${name}": blend-mode must be one of ${BLEND_MODES.join(", ")}`);
  }
  const l = { name, glass };
  if (image) l["image-name"] = image;
  else l["image-name-specializations"] = imageSpecializations;
  if (specializations) l["fill-specializations"] = specializations;
  else if (fill) l.fill = fill;
  if (hiddenSpecializations) l["hidden-specializations"] = hiddenSpecializations;
  else if (hidden) l.hidden = true;
  if (opacity !== undefined) l.opacity = opacity;
  if (blendMode) l["blend-mode"] = blendMode;
  if (pos) l.position = pos;
  return l;
};

/**
 * One group. Groups are the depth planes the system parallaxes independently.
 *
 *   shadow        0..1 opacity, or null for none. `shadowKind` is "neutral"
 *                 (the UI's "Natural") or "layer-color" (the UI's "Chromatic").
 *   translucency  0..1, or null to disable. Thin shapes lose their colour above
 *                 ~0.3; solid volumes can take 0.5+.
 *   specular      edge highlight. Off for full-bleed layers. `true` renders
 *                 identically to "automatic" in 27.1, which resolved to
 *                 "inside" in Default and "outside" in Dark in every probe.
 *   lighting      "individual" (the default) | "combined": whether the glass
 *                 lighting is computed per layer or across the group. Only
 *                 observable with 2+ layers. "combined" lights the group as ONE
 *                 glass body: abutting layers lose the rims at their seams,
 *                 which is how a multi-stop gradient is built (design.md).
 *   refractivity  { strength, depth }. strength -1..1, clamped (-1.5 renders
 *                 as -1); negative is Apple's "inverse refraction", bending the
 *                 backdrop toward the rim like a sphere. 0, or enabled:false, is
 *                 a no-op. depth 0..1 scales it. It only bends what is BEHIND
 *                 the group, so it needs structure back there to show.
 *   blurMaterial  0..1 material thickness; 0 and null are no-ops, strings are
 *                 rejected. The older `blur` key is inert.
 *   specularPlacement  "inside" | "outside" | "automatic". Accepted by ictool
 *                 27.0 but produced no pixel change in any probe; kept so a
 *                 document round-trips through the app unchanged.
 */
export const group = ({
  layers, name, shadow = 0.4, shadowKind = "neutral", translucency = 0.4, specular = true,
  lighting, refractivity, blurMaterial, specularPlacement, opacity, hidden,
}) => {
  if (!Array.isArray(layers) || layers.length === 0) throw new Error("group needs at least one layer");
  const g = {};
  if (name) g.name = name;
  g.layers = layers;
  g.specular = specular;
  if (shadow !== null) g.shadow = { kind: shadowKind, opacity: shadow };
  // Both sub-keys are required whenever the object is present.
  g.translucency = translucency === null ? { enabled: false, value: 0 } : { enabled: true, value: translucency };
  if (lighting) {
    if (!["individual", "combined"].includes(lighting)) throw new Error('lighting must be "individual" or "combined"');
    g.lighting = lighting;
  }
  if (refractivity) {
    // All three keys are required or the document will not open.
    const { strength, depth, enabled = true } = refractivity;
    if (strength === undefined || depth === undefined) throw new Error("refractivity needs strength AND depth");
    g.refractivity = { enabled, strength, depth };
  }
  if (blurMaterial !== undefined) g["blur-material"] = blurMaterial;
  if (specularPlacement) g["specular-highlight-placement"] = specularPlacement;
  if (opacity !== undefined) g.opacity = opacity;
  if (hidden) g.hidden = true;
  return g;
};

/**
 * Assemble icon.json.
 *
 * `groups` is ordered FRONT TO BACK: index 0 is the topmost plane. Layers
 * inside a group are ordered the same way. This is the opposite of most layer
 * formats and the single easiest thing to get wrong; the symptom is a
 * full-bleed background that hides the entire icon.
 *
 * `fill` is the background for a single appearance. `fillSpecializations`
 * (built with `appearances()`) is the background per appearance, and is the
 * only way to control the DARK background: a plain `fill` is replaced by the
 * system's neutral grey in Dark. Never pass both; the plain key would win.
 *
 * `features` is emitted automatically when a group uses refractivity or
 * specular placement. It is the gate Icon Composer uses to refuse documents
 * from a newer version rather than silently dropping an effect.
 */
export const iconDocument = ({ fill, fillSpecializations, groups, platforms, untaggedSvgColorSpace, features = [] }) => {
  if (fill && fillSpecializations) throw new Error("pass fill OR fillSpecializations, never both");
  // Apple's guideline is four groups (they are the parallax planes). ictool
  // will render more, but the design advice in references/design.md stands.
  if (groups.length > 4) throw new Error(`${groups.length} groups; Icon Composer allows at most 4`);
  const doc = {};
  const feats = new Set(features);
  for (const g of groups) {
    if (g.refractivity || g["refractivity-strength"] !== undefined) feats.add("refractivity");
    if (g["specular-highlight-placement"]) feats.add("specular-location");
  }
  if (feats.size) doc.features = [...feats];
  // Only "display-p3" is accepted here. Any other value, "srgb" included,
  // makes the entire document unparseable. Omit it to get sRGB.
  if (untaggedSvgColorSpace) {
    if (untaggedSvgColorSpace !== "display-p3") {
      throw new Error('untaggedSvgColorSpace accepts only "display-p3"; omit it for sRGB');
    }
    doc["color-space-for-untagged-svg-colors"] = untaggedSvgColorSpace;
  }
  if (fill) doc.fill = fill;
  if (fillSpecializations) doc["fill-specializations"] = fillSpecializations;
  doc.groups = groups;
  doc["supported-platforms"] = platforms ?? { circles: ["watchOS"], squares: "shared" };
  return doc;
};

/** Write a complete .icon bundle. `assets` maps filename -> file contents. */
export const buildIcon = (dir, { assets, document }) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "Assets"), { recursive: true });
  for (const [file, body] of Object.entries(assets)) {
    writeFileSync(join(dir, "Assets", file), body);
  }
  writeFileSync(join(dir, "icon.json"), JSON.stringify(document, null, 2) + "\n");
  const problems = lint(document, dir);
  if (problems.length) {
    throw new Error(`${basename(dir)} has ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  }
  return dir;
};

// ── SVG helpers ──────────────────────────────────────────────────────────────
/**
 * Wrap paths in a full-canvas SVG. Colour is irrelevant when the layer sets a
 * `fill` (the layer fill overrides the artwork entirely), so a placeholder ink
 * just keeps the raw file viewable on its own.
 *
 * Unless `anchor: false`, it also gets two transparent 1-pt rects in opposite
 * canvas corners. They are load-bearing: a layer gradient's `orientation` is
 * normalized to the artwork's BOUNDING BOX, not the canvas (pixel-verified,
 * ictool 27.1), so the same start/stop lands somewhere different on a small
 * shape than on a full-bleed one. Pinning every layer's bounds to the canvas
 * makes orientation the canvas fraction everything here computes it as.
 * Opacity 0 still counts toward the bounds (`fill="none"` does not), the
 * squircle mask removes those corners, and the render differs from an
 * unanchored one only in rim antialiasing, by under 3% per pixel.
 */
const ANCHORS = (size) =>
  `\n  <rect x="0" y="0" width="1" height="1" fill="#FFFFFF" fill-opacity="0"/>` +
  `\n  <rect x="${size - 1}" y="${size - 1}" width="1" height="1" fill="#FFFFFF" fill-opacity="0"/>`;
export const svg = (body, size = 1024, { anchor = true } = {}) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">\n` +
  body +
  (anchor ? ANCHORS(size) : "") +
  `\n</svg>\n`;

export const f = (n) => Number(n.toFixed(2));

/** Rounded-rect path data. */
export const rr = (x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  return (
    `M${f(x + r)} ${f(y)}` +
    `H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}` +
    `V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}` +
    `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}` +
    `V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
  );
};

/**
 * A stroked shape as an even-odd filled outline. Strokes are converted to fills
 * so nothing depends on how CoreSVG resolves stroke geometry at export scale.
 * Emit the returned path with fill-rule="evenodd".
 */
export const strokedRect = (cx, cy, halfW, halfH, weight, radius) =>
  rr(cx - halfW - weight / 2, cy - halfH - weight / 2, halfW * 2 + weight, halfH * 2 + weight, radius + weight / 2) +
  rr(cx - halfW + weight / 2, cy - halfH + weight / 2, halfW * 2 - weight, halfH * 2 - weight, Math.max(0, radius - weight / 2));

/** Sample a cubic Bézier and its derivative. */
export const bezier = (p, t) => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0],
    a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1],
  ];
};

export const bezierTangent = (p, t) => {
  const u = 1 - t;
  const [a, b, c] = [3 * u * u, 6 * u * t, 3 * t * t];
  return [
    a * (p[1][0] - p[0][0]) + b * (p[2][0] - p[1][0]) + c * (p[3][0] - p[2][0]),
    a * (p[1][1] - p[0][1]) + b * (p[2][1] - p[1][1]) + c * (p[3][1] - p[2][1]),
  ];
};

/**
 * A tapered ribbon along a cubic: a motion trail, comet tail or swash. The
 * half-width grows geometrically, which is what a trail receding in perspective
 * actually looks like and keeps the far end slim long enough to read as
 * distance rather than as a wedge.
 *
 * Set `hw1` to the radius of whatever sits at the head and place that shape on
 * the endpoint: the ribbon then terminates as that shape's own silhouette and is
 * occluded cleanly, with no crescent leaking past its edge.
 */
export const ribbon = (curve, hw0, hw1, steps = 96) => {
  const L = [];
  const R = [];
  const ratio = hw1 / hw0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = bezier(curve, t);
    const [dx, dy] = bezierTangent(curve, t);
    const m = Math.hypot(dx, dy);
    const w = hw0 * Math.pow(ratio, t);
    L.push([x - (dy / m) * w, y + (dx / m) * w]);
    R.push([x + (dy / m) * w, y - (dx / m) * w]);
  }
  const seg = (pts) => pts.map(([x, y]) => `L${f(x)} ${f(y)}`).join("");
  return (
    `M${f(L[0][0])} ${f(L[0][1])}` +
    seg(L.slice(1)) +
    `A${f(hw1)} ${f(hw1)} 0 0 1 ${f(R[R.length - 1][0])} ${f(R[R.length - 1][1])}` +
    seg(R.slice(0, -1).reverse()) +
    `A${f(hw0)} ${f(hw0)} 0 0 1 ${f(L[0][0])} ${f(L[0][1])}Z`
  );
};

// ── Lint ─────────────────────────────────────────────────────────────────────
// ictool validates VALUES, not KEYS. A misspelled key ("fil", "ligthing",
// "fill-specialization") is silently ignored and the document renders as if
// it were absent, so a clean render proves nothing about the keys. This is the
// check ictool does not do. The key inventory is what Icon Composer 27 itself
// reads and writes.
const spec = (keys) => keys.flatMap((k) => [k, `${k}-specializations`]);
export const KNOWN_KEYS = {
  document: ["features", "color-space-for-untagged-svg-colors", "groups", "supported-platforms", "implicit-asset-mirroring", "languages", ...spec(["fill"])],
  group: ["layers", "name", "specular", ...spec([
    "lighting", "specular-highlight-placement", "blur-material", "blur", "refractivity", "refractivity-strength",
    "refractivity-depth", "translucency", "shadow", "blend-mode", "opacity", "hidden", "asset-mirroring", "position",
  ])],
  layer: ["name", ...spec(["image-name", "fill", "blend-mode", "opacity", "glass", "hidden", "position", "asset-mirroring"])],
};
const PLAIN_VS_SPEC = (obj, where, out) => {
  for (const k of Object.keys(obj)) {
    if (k.endsWith("-specializations") && obj[k.slice(0, -"-specializations".length)] !== undefined) {
      const p = k.slice(0, -"-specializations".length);
      out.push(`${where}: both "${p}" and "${k}" are present; the plain key wins in EVERY appearance and the specializations are silently ignored`);
    }
  }
};
const unknownKeys = (obj, known, where, out) => {
  for (const k of Object.keys(obj)) {
    if (!known.includes(k)) out.push(`${where}: unknown key "${k}" (ictool ignores it silently; check the spelling)`);
  }
};

/**
 * Structural problems ictool will not report. Returns an array of messages;
 * empty means clean. Pass `bundleDir` to also cross-check `image-name`
 * references against Assets/ (a dangling name renders as an EMPTY layer, exit 0).
 */
export const lint = (doc, bundleDir) => {
  const out = [];
  unknownKeys(doc, KNOWN_KEYS.document, "document", out);
  PLAIN_VS_SPEC(doc, "document", out);
  if (doc["color-space-for-untagged-svg-colors"] && doc["color-space-for-untagged-svg-colors"] !== "display-p3") {
    out.push(`document: color-space-for-untagged-svg-colors must be "display-p3" or omitted; ictool rejects "${doc["color-space-for-untagged-svg-colors"]}"`);
  }
  if (!Array.isArray(doc.groups)) { out.push("document: groups is required"); return out; }
  if (doc.groups.length > 4) out.push(`document: ${doc.groups.length} groups; Apple's limit is 4 (ictool will still render it)`);
  const images = [];
  doc.groups.forEach((g, gi) => {
    const gw = `groups[${gi}]`;
    unknownKeys(g, KNOWN_KEYS.group, gw, out);
    PLAIN_VS_SPEC(g, gw, out);
    if (g.blur !== undefined) out.push(`${gw}: "blur" is inert in Icon Composer 27; use "blur-material"`);
    if (g.refractivity && (g.refractivity.enabled === undefined || g.refractivity.strength === undefined || g.refractivity.depth === undefined)) {
      out.push(`${gw}: refractivity needs enabled, strength AND depth`);
    }
    for (const k of ["shadow", "translucency"]) {
      const need = k === "shadow" ? ["kind", "opacity"] : ["enabled", "value"];
      if (g[k] && need.some((n) => g[k][n] === undefined)) out.push(`${gw}: ${k} needs ${need.join(" and ")}`);
    }
    if (!Array.isArray(g.layers) || g.layers.length === 0) { out.push(`${gw}: layers is required`); return; }
    g.layers.forEach((l, li) => {
      const lw = `${gw}.layers[${li}]${l.name ? ` "${l.name}"` : ""}`;
      unknownKeys(l, KNOWN_KEYS.layer, lw, out);
      PLAIN_VS_SPEC(l, lw, out);
      if (l.position && (l.position.scale === undefined || l.position["translation-in-points"] === undefined)) {
        out.push(`${lw}: position needs scale AND translation-in-points together`);
      }
      if (l["image-name"]) images.push([lw, l["image-name"]]);
      for (const s of l["image-name-specializations"] ?? []) images.push([lw, s.value]);
    });
  });
  if (bundleDir) {
    const have = existsSync(join(bundleDir, "Assets")) ? readdirSync(join(bundleDir, "Assets")) : [];
    for (const [lw, img] of images) {
      if (!have.includes(img)) out.push(`${lw}: image "${img}" is not in Assets/ (renders as an empty layer, no error)`);
    }
    const used = new Set(images.map(([, i]) => i));
    for (const fname of have) if (!used.has(fname) && !fname.startsWith(".")) out.push(`Assets/${fname} is not referenced by any layer`);
  }
  return out;
};

// ── ictool ───────────────────────────────────────────────────────────────────
export const RENDITIONS = ["Default", "Dark", "TintedLight", "TintedDark", "ClearLight", "ClearDark"];
export const PLATFORMS = ["iOS", "macOS", "watchOS"];

export const findIctool = () => {
  const candidates = [];
  try {
    const dev = execFileSync("xcode-select", ["-p"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    candidates.push(join(dev.replace(/\/Developer$/, ""), "Applications/Icon Composer.app/Contents/Executables/ictool"));
  } catch {}
  candidates.push(
    "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool",
    "/Applications/Xcode-beta.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool",
    "/Applications/Icon Composer.app/Contents/Executables/ictool",
  );
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error("ictool not found: install Xcode 26+ (Icon Composer ships inside it)");
  return hit;
};

/** `{ "bundle-version": "129", "short-bundle-version": "27.0" }` */
export const ictoolVersion = () =>
  JSON.parse(execFileSync(findIctool(), ["--version"], { encoding: "utf8" }));

/**
 * Render one rendition to a PNG. Returns the output path.
 * `designGeneration` 26 renders the way iOS/macOS 26 composite the icon;
 * 27 (the default) is the current look.
 */
export const render = (bundle, out, { platform = "iOS", rendition = "Default", size = 512, scale = 1, tint, designGeneration } = {}) => {
  const args = [bundle, "--export-image", "--output-file", out,
    "--platform", platform, "--rendition", rendition,
    "--width", String(size), "--height", String(size), "--scale", String(scale)];
  if (tint !== undefined) args.push("--tint-color", String(tint), "--tint-strength", "0.8");
  if (designGeneration !== undefined) args.push("--design-generation", String(designGeneration));
  execFileSync(findIctool(), args, { stdio: "pipe" });
  return out;
};

// ── CLI ──────────────────────────────────────────────────────────────────────
const describeFill = (v) => {
  if (!v) return "(none)";
  if (typeof v === "string") return `keyword ${v}`;
  if (v.solid) return `solid ${v.solid}`;
  if (v["linear-gradient"]) {
    const o = v.orientation;
    const dir = o ? ` @ (${o.start.x},${o.start.y})->(${o.stop.x},${o.stop.y})` : "";
    return `gradient ${v["linear-gradient"].join(" -> ")}${dir}`;
  }
  if (v["automatic-gradient"]) return `auto-gradient ${v["automatic-gradient"]}`;
  return JSON.stringify(v);
};
const slot = (s) => [s.appearance ?? "base", s.idiom, s.localization].filter(Boolean).join("/");

const readDoc = (bundle) => {
  const p = join(bundle, "icon.json");
  if (!existsSync(p)) throw new Error(`${bundle}: no icon.json (is this a .icon bundle?)`);
  return JSON.parse(readFileSync(p, "utf8"));
};

const inspect = (bundle) => {
  const doc = readDoc(bundle);
  console.log(`${basename(bundle)}`);
  if (doc.features) console.log(`  features        : ${doc.features.join(", ")}`);
  console.log(`  background fill : ${describeFill(doc.fill)}`);
  for (const s of doc["fill-specializations"] ?? []) console.log(`      [${slot(s)}] ${describeFill(s.value)}`);
  console.log(`  untagged SVG cs : ${doc["color-space-for-untagged-svg-colors"] ?? "(sRGB, key omitted)"}`);
  console.log(`  platforms       : ${JSON.stringify(doc["supported-platforms"] ?? "(omitted)")}`);
  console.log(`  groups          : ${doc.groups?.length ?? 0} (index 0 = FRONT)`);
  (doc.groups ?? []).forEach((g, gi) => {
    const bits = [
      `specular=${g.specular ?? "default"}`,
      `translucency=${g.translucency?.enabled ? g.translucency.value : "off"}`,
      `shadow=${g.shadow ? `${g.shadow.opacity} ${g.shadow.kind}` : g["shadow-specializations"] ? "specialized" : "none"}`,
    ];
    if (g.lighting) bits.push(`lighting=${g.lighting}`);
    if (g.refractivity) bits.push(`refractivity=${g.refractivity.enabled ? `${g.refractivity.strength}/${g.refractivity.depth}` : "off"}`);
    if (g["blur-material"] !== undefined) bits.push(`blur-material=${g["blur-material"]}`);
    if (g["specular-highlight-placement"]) bits.push(`specular-placement=${g["specular-highlight-placement"]}`);
    const tag = gi === 0 ? "FRONT" : gi === doc.groups.length - 1 ? "BACK " : "     ";
    console.log(`\n  [${gi}] ${tag}  ${g.name ? `"${g.name}"  ` : ""}${bits.join("  ")}`);
    (g.layers ?? []).forEach((l) => {
      const img = l["image-name"] ?? (l["image-name-specializations"] ?? []).map((s) => `${slot(s)}:${s.value}`).join(" ");
      console.log(`        · ${l.name ?? "(unnamed)"}  (${img})  glass=${l.glass ?? "default"}${l.hidden ? "  HIDDEN" : ""}${l["blend-mode"] ? `  blend=${l["blend-mode"]}` : ""}${l.opacity !== undefined ? `  opacity=${l.opacity}` : ""}`);
      if (l.fill) console.log(`            fill: ${describeFill(l.fill)}`);
      for (const s of l["fill-specializations"] ?? []) console.log(`            [${slot(s)}] ${describeFill(s.value)}`);
      if (l.position) console.log(`            position: ${JSON.stringify(l.position)}`);
    });
  });
  const problems = lint(doc, bundle);
  if (problems.length) {
    console.log(`\n  ${problems.length} problem(s) ictool will NOT report:`);
    for (const p of problems) console.log(`    ! ${p}`);
  }
  return problems.length;
};

const validate = (bundle) => {
  const doc = readDoc(bundle);
  const problems = lint(doc, bundle);
  for (const p of problems) console.log(`  LINT  ${p}`);
  const v = ictoolVersion();
  console.log(`  ictool ${v["short-bundle-version"]} (${v["bundle-version"]})`);
  const tmp = join(tmpdir(), `iconkit-validate-${process.pid}.png`);
  let failed = 0;
  const attempt = (opts, label) => {
    try {
      render(bundle, tmp, { size: 128, ...opts });
    } catch (e) {
      const msg = String(e.stdout ?? e.stderr ?? e.message).trim().split("\n").filter(Boolean).pop();
      console.log(`  FAIL  ${label}  ${msg}`);
      failed++;
    }
  };
  for (const platform of PLATFORMS) {
    for (const rendition of RENDITIONS) {
      // watchOS icons are circular and have no appearance variants.
      if (platform === "watchOS" && rendition !== "Default") continue;
      const tint = rendition.startsWith("Tinted") ? 0.55 : undefined;
      attempt({ platform, rendition, tint }, `${platform.padEnd(8)} ${rendition.padEnd(12)}`);
    }
  }
  // Devices still on the previous OS composite the icon differently.
  attempt({ designGeneration: 26 }, `${"iOS".padEnd(8)} ${"Default".padEnd(12)} (design generation 26)`);
  rmSync(tmp, { force: true });
  if (failed) {
    console.log(`\n${failed} rendition(s) failed.`);
    console.log(`Most ictool errors name the bad value. The generic "isn't in the correct format"`);
    console.log(`means a rejected VALUE (wrong type, bad enum, bad platform); "is missing" means a`);
    console.log(`required sub-key (shadow.opacity, translucency.value, position.translation-in-points,`);
    console.log(`refractivity.depth, groups). Misspelled KEYS never error: see the LINT lines above.`);
  }
  if (!failed && !problems.length) console.log(`  OK: lint clean, every rendition renders on every platform.`);
  else if (!failed) console.log(`  Renders, but ${problems.length} lint problem(s) above need fixing.`);
  process.exit(failed || problems.length ? 1 : 0);
};

// Compare REAL paths. Skills are commonly installed as a symlink (Claude Code
// reads ~/.claude/skills, which points into ~/.agents/skills), and
// import.meta.url is always the resolved path, so a plain string compare made
// every CLI call through the symlink exit 0 having printed nothing — and
// preview.sh, which shells out here for the ictool path, then failed.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "inspect" && arg) process.exit(inspect(arg) ? 1 : 0);
    else if (cmd === "validate" && arg) validate(arg);
    else if (cmd === "ictool") console.log(findIctool());
    else {
      console.log("usage: iconkit.mjs <inspect|validate> <bundle.icon>");
      console.log("       iconkit.mjs ictool");
      process.exit(2);
    }
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
