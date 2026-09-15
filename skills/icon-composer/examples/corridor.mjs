#!/usr/bin/env node
// Worked example: a one-point-perspective corridor with a curving motion trail,
// with light and dark appearances, in as many colourways as the palette table
// has rows.
//
//   node corridor.mjs <output-dir>
//
// This is a template, not a fixed design. What is worth copying is the shape of
// it: geometry derived from real numbers, colour driven entirely from icon.json
// rather than the SVGs, one gradient axis doing the lighting, and Liquid Glass
// applied per-layer instead of globally.

import { join } from "node:path";
import {
  buildIcon, iconDocument, group, layer,
  gradient, appearances,
  svg, rr, strokedRect, ribbon, f,
} from "../scripts/iconkit.mjs";

const OUT = process.argv[2] || ".";
const S = 1024;
const CX = 512;
const CY = 512;

// ── Perspective ──────────────────────────────────────────────────────────────
// Screen size goes as 1/z. That single law sizes the rings AND their stroke
// weights, which is what makes the corridor recede instead of looking like
// rectangles nested inside each other.
const ASPECT = 5.0 / 3.2; // the room's real width:height
const K = 1628; // half-width at z = 1m; tune until the far wall lands where you want
const hw = (z) => K / z;
const hh = (z) => K / z / ASPECT;

const RINGS = [5.0, 9.5]; // metres. Two. A third reads as a wireframe box.
const RING_WEIGHT = 122;
const RAIL_WIDTH = 44;
const CAP_Z = 29;

/** A corner rail from the far wall out past the frame edge, tapering as 1/z. */
const cornerRail = (sx, sy, maxWidth) => {
  const [dx, dy] = [sx - CX, sy - CY];
  const len = Math.hypot(dx, dy);
  const [ux, uy] = [dx / len, dy / len];
  const tx = ux > 0 ? (S - CX) / ux : -CX / ux;
  const ty = uy > 0 ? (S - CY) / uy : -CY / uy;
  // Overshoot so the system mask cuts the rail, rather than the artwork
  // stopping short of the edge and leaving a visible tip.
  const t = Math.min(Math.abs(tx), Math.abs(ty)) * 1.06;
  const [ex, ey] = [CX + ux * t, CY + uy * t];
  const wStart = (maxWidth * len) / Math.hypot(ex - CX, ey - CY);
  const [nx, ny] = [-uy, ux];
  return (
    `M${f(sx + (nx * wStart) / 2)} ${f(sy + (ny * wStart) / 2)}` +
    `L${f(ex + (nx * maxWidth) / 2)} ${f(ey + (ny * maxWidth) / 2)}` +
    `L${f(ex - (nx * maxWidth) / 2)} ${f(ey - (ny * maxWidth) / 2)}` +
    `L${f(sx - (nx * wStart) / 2)} ${f(sy - (ny * wStart) / 2)}Z`
  );
};

// ── The arc ──────────────────────────────────────────────────────────────────
// The head must finish a long way from the vanishing point. Land it near the
// middle and the curve has nowhere to go but around itself, which reads as a
// comma; out at the near corner the same lateral swing becomes a bend in a long
// run. It also starts at the BASE of the far wall rather than through it, so a
// dim tail never crosses the brightest element in the icon.
const ARC = [
  [488, 548],
  [310, 600],
  [400, 830],
  [726, 726],
];
const BALL = { x: ARC[3][0], y: ARC[3][1], r: 112 };

// ── Artwork ──────────────────────────────────────────────────────────────────
// One flat shape per layer. Colour is set by the layer fill, so the ink here is
// only so the raw SVGs stay viewable on their own.
const INK = "#3D9BFF";
const capCorners = () => {
  const [w, h] = [hw(CAP_Z), hh(CAP_Z)];
  return [
    [CX + w, CY + h], [CX - w, CY + h],
    [CX + w, CY - h], [CX - w, CY - h],
  ];
};

const ASSETS = {
  "rails.svg": svg(
    `  <path fill="${INK}" d="${capCorners().map(([x, y]) => cornerRail(x, y, RAIL_WIDTH)).join("")}"/>`,
  ),
  "rings.svg": svg(
    RINGS.map((z) =>
      `  <path fill="${INK}" fill-rule="evenodd" d="${strokedRect(CX, CY, hw(z), hh(z), RING_WEIGHT / z, hh(z) * 0.12)}"/>`,
    ).join("\n"),
  ),
  "cap.svg": (() => {
    const [w, h] = [hw(CAP_Z), hh(CAP_Z)];
    return svg(`  <path fill="${INK}" d="${rr(CX - w, CY - h, w * 2, h * 2, h * 0.34)}"/>`);
  })(),
  // hw1 == the ball's radius, and the curve ends at the ball's centre, so the
  // ribbon terminates as the ball's own silhouette and is occluded cleanly.
  "trail.svg": svg(`  <path fill="${INK}" d="${ribbon(ARC, 2, BALL.r - 14)}"/>`),
  "ball.svg": svg(`  <circle fill="${INK}" cx="${BALL.x}" cy="${BALL.y}" r="${BALL.r}"/>`),
};

// ── Lighting ─────────────────────────────────────────────────────────────────
// Four rails of equal weight are a graphic X drawn over the icon. The same four
// rails dark at the ceiling and blazing at the floor are a room you are standing
// in. One gradient axis, shared by rails and rings so a single source lights the
// whole corridor.
const FLOOR_LIGHT = [[0.5, 0.08], [0.5, 0.96]];
const RING_LIGHT = [[0.5, 0.2], [0.5, 0.82]];
// The trail's axis is its own direction of travel: dim far, bright at the head.
const TRAVEL = [[ARC[0][0] / S, ARC[0][1] / S], [ARC[3][0] / S, ARC[3][1] / S]];
const BALL_LIGHT = [
  [(BALL.x - BALL.r * 0.7) / S, (BALL.y - BALL.r * 0.8) / S],
  [(BALL.x + BALL.r * 0.9) / S, (BALL.y + BALL.r * 0.9) / S],
];

// Light and dark are the same room at two exposures, not two designs: dark drops
// the ground nearly to black and lifts every emissive element.
//
// Build variants (Debug, Beta, ...) go in as extra rows: identical geometry,
// different hue, one .icon per row.
const VARIANTS = {
  Corridor: {
    light: {
      void: ["#16205E", "#07091A"], rail: ["#0A3272", "#6CC4FF"], ring: ["#0C3A82", "#47A6F7"],
      cap: ["#3FBFF5", "#B6ECFF"], trail: ["#1591D6", "#A8FEFF"], ball: ["#FF4DA6", "#C1005F"],
    },
    dark: {
      void: ["#0A0E30", "#000206"], rail: ["#0C3E96", "#8FD6FF"], ring: ["#0E4693", "#5CB8FF"],
      cap: ["#59CEFF", "#CDF4FF"], trail: ["#1FA8E8", "#C2FFFF"], ball: ["#FF63B6", "#D4006E"],
    },
  },
};

const AXES = {
  rail: FLOOR_LIGHT, ring: RING_LIGHT, cap: RING_LIGHT,
  trail: TRAVEL, ball: BALL_LIGHT,
};

const lit = (name, image, key, glass, { light, dark }) =>
  layer({
    name, image, glass,
    specializations: appearances({
      base: gradient(light[key], AXES[key]),
      dark: gradient(dark[key], AXES[key]),
    }),
  });

for (const [name, v] of Object.entries(VARIANTS)) {
  buildIcon(join(OUT, `${name}.icon`), {
    assets: ASSETS,
    document: iconDocument({
      // The background per appearance. A plain `fill` would be swapped for the
      // system's neutral grey in Dark; only fill-specializations survives.
      // No orientation: the document fill always runs top to bottom, which is
      // the direction wanted here anyway. A background that must run some
      // other way has to be a full-bleed layer at the back.
      fillSpecializations: appearances({
        base: gradient(v.light.void),
        dark: gradient(v.dark.void),
      }),
      // FRONT to BACK.
      groups: [
        group({ layers: [lit("Ball", "ball.svg", "ball", true, v)], shadow: 0.6, translucency: 0.55 }),
        // Low translucency: glass mixes a thin ribbon down into the background
        // until its colour is gone. A solid volume like the ball can afford more.
        group({ layers: [lit("Trail", "trail.svg", "trail", true, v)], shadow: 0.45, translucency: 0.22 }),
        // Glass OFF: it softens exactly the edges that carry the perspective.
        group({
          layers: [
            lit("Far wall", "cap.svg", "cap", false, v),
            lit("Depth rings", "rings.svg", "ring", false, v),
            lit("Corner rails", "rails.svg", "rail", false, v),
          ],
          shadow: 0.3, translucency: 0.3,
        }),
      ],
    }),
  });
  console.log(`wrote ${join(OUT, `${name}.icon`)}`);
}
