import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CursorAvatar } from "./CursorAvatar";
import { FACE_BOX } from "./cursor-face-data";
import { MOTION, VIEW_SPAN, bodyTransform } from "./mascot-motion";
import { DEFAULT_FINISH, finishGradient } from "./mascot-finish";
import { MAUS_COLORS } from "@/lib/mascot";
import { MASCOT_BODIES, MASCOT_BODY_IDS } from "../../shared/mascot-bodies";

const luma = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

type Props = Partial<Parameters<typeof CursorAvatar>[0]>;

const render = (props: Props) => renderToStaticMarkup(createElement(CursorAvatar, { paused: true, ...props }));

const svg = (props: Props) => render({ finish: "glass", ...props });

const mascot = (props: Props) => render({ finish: "mascot", gradient: finishGradient(MAUS_COLORS.blue, "mascot"), ...props });

const VIEW_MARGIN = (VIEW_SPAN - FACE_BOX) / 2;

type Point = [number, number];

function outlinePoints(clip: string): Point[] {
  const numbers = (/ d="([^"]+)"/.exec(clip)![1].match(/-?[\d.]+/g) ?? []).map(Number);
  const points: Point[] = [];
  let from: Point = [numbers[0], numbers[1]];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    const [x1, y1, x2, y2, x, y] = numbers.slice(i, i + 6);
    for (let step = 1; step <= 24; step++) {
      const t = step / 24, u = 1 - t;
      points.push([
        u * u * u * from[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * from[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
    from = [x, y];
  }
  return points;
}

function applyTransform(transform: string, point: Point): Point {
  let [x, y] = point;
  for (const [, name, args] of [...transform.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].reverse()) {
    const [a, b = name === "scale" ? a : 0, c = 0] = args.split(/[\s,]+/).map(Number);
    if (name === "translate") [x, y] = [x + a, y + b];
    if (name === "scale") [x, y] = [x * a, y * b];
    if (name === "rotate") {
      const cos = Math.cos((a * Math.PI) / 180), sin = Math.sin((a * Math.PI) / 180);
      [x, y] = [b + (x - b) * cos - (y - c) * sin, c + (x - b) * sin + (y - c) * cos];
    }
  }
  return [x, y];
}

function strokeReachPastOutline(markup: string, fit: string): number {
  const unclipped = markup.replace(/<g clip-path="[^"]+"[^>]*>(?:<use [^>]*><\/use>)+<\/g>/g, "");
  const scale = Number(/scale\(([\d.]+)\)/.exec(fit)?.[1] ?? 1);
  const widths = [...unclipped.matchAll(/<use [^>]*stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]) * scale);
  return Math.max(0, ...widths) / 2;
}

describe("the default finish", () => {
  it("is the bold mascot", () => {
    expect(DEFAULT_FINISH).toBe("mascot");
    expect(render({ size: 96 })).toContain("-belly");
  });
});

describe("the mascot finish", () => {
  it("gives every bot colour a lighter tint and a darker shade of itself", () => {
    for (const fill of Object.values(MAUS_COLORS)) {
      const [tint, flat, shade] = finishGradient(fill, "mascot");
      expect(flat).toBe(fill);
      expect(luma(tint)).toBeGreaterThan(luma(fill));
      expect(luma(shade)).toBeLessThan(luma(fill));
    }
  });

  it("fills the body with one flat colour and no outline", () => {
    const markup = mascot({ size: 96 });
    expect(markup).toMatch(/<linearGradient id="[^"]+-grad"><stop offset="0%" stop-color="#377FE6"><\/stop><\/linearGradient>/);
    expect(markup).not.toMatch(/-rim|-gloss|-core/);
  });

  it("shades the bottom of every body inside its own outline", () => {
    for (const id of MASCOT_BODY_IDS) {
      const markup = mascot({ size: 44, silhouette: MASCOT_BODIES[id] });
      expect(markup).toMatch(/<use href="#[^"]+-shape"[^>]*fill="url\(#[^)]+-belly\)"/);
      expect(markup).toMatch(/<g clip-path="url\(#[^)]+-clip\)" opacity="[\d.]+"><ellipse /);
    }
  });

  it("draws dark eyes with a sparkle and a dark mouth on every bot colour", () => {
    for (const fill of Object.values(MAUS_COLORS)) {
      const markup = mascot({ size: 96, gradient: finishGradient(fill, "mascot") });
      expect(markup.match(/<path fill="url\(#[^)]+-eye\)"/g)).toHaveLength(2);
      expect(markup).toContain('stroke="#17171c"');
    }
  });

  it("keeps a face colour the person chose", () => {
    const white = mascot({ size: 96, eyeColor: "#ffffff" });
    expect(white.match(/<path fill="#ffffff"/g)).toHaveLength(2);
    expect(white).not.toContain("-eye");
    expect(mascot({ size: 96, eyeColor: "#000000" }).match(/<path fill="url\(#[^)]+-eye\)"/g)).toHaveLength(2);
  });

  it("keeps white eyes on a dark body and on a body whose colour it cannot read", () => {
    expect(mascot({ size: 96, gradient: ["#555555", "#222222", "#111111"] }).match(/<path fill="#ffffff"/g)).toHaveLength(2);
    expect(mascot({ size: 96, gradient: ["var(--a)", "var(--b)", "var(--c)"] }).match(/<path fill="#ffffff"/g)).toHaveLength(2);
  });

  it("drops the highlight and the sparkle at sidebar sizes and fades them in up to 28 px", () => {
    const small = mascot({ size: 20 });
    expect(small).toContain("-belly");
    expect(small).not.toMatch(/<ellipse|-eye/);
    const highlight = (size: number) => Number(/-clip\)" opacity="([\d.]+)"><ellipse/.exec(mascot({ size }))![1]);
    expect(highlight(24)).toBeCloseTo(highlight(96) / 2, 5);
    expect(highlight(28)).toBe(highlight(96));
  });

  it("paints nothing over a picture body", () => {
    const steel = mascot({ size: 96, picture: "/steel/cursor-128.webp" });
    expect(steel).not.toMatch(/<use |-belly|-eye|<ellipse|-shape/);
    expect(steel).toContain("-grad");
  });
});

describe("the glass finish", () => {
  it("runs every bot colour from a lighter stop into a second hue", () => {
    for (const fill of Object.values(MAUS_COLORS)) {
      const stops = finishGradient(fill, "glass");
      for (const stop of stops) expect(stop).toMatch(/^#[0-9a-f]{6}$/);
      expect(luma(stops[0])).toBeGreaterThan(luma(stops[1]));
      expect(stops[2]).not.toBe(stops[1]);
    }
  });

  it("keeps a grey grey", () => {
    for (const stop of finishGradient("#808080", "glass")) expect(new Set([stop.slice(1, 3), stop.slice(3, 5), stop.slice(5, 7)]).size).toBe(1);
  });

  it("draws the rim inside the body's own clip on every body, so the outline does not grow", () => {
    for (const id of MASCOT_BODY_IDS) {
      const markup = svg({ size: 44, silhouette: MASCOT_BODIES[id] });
      expect(markup).toMatch(/<g clip-path="url\(#[^)]+-clip\)" opacity="1" fill="none" stroke="url\(#[^)]+-rim\)"[^>]*><use href="#[^"]+-shape"/);
      expect(markup.split(MASCOT_BODIES[id].clip).length - 1).toBe(2);
    }
  });

  it("paints no stroke past the outline, so no body motion can push the finish out of the viewBox", () => {
    for (const finish of ["glass", "mascot"] as const) {
      for (const id of MASCOT_BODY_IDS) {
        const body = MASCOT_BODIES[id];
        expect(strokeReachPastOutline(render({ finish, size: 96, silhouette: body }), body.fit), `${finish} ${id}`).toBe(0);
      }
    }
  });

  it.each(["bouncing", "celebrate"] as const)("adds nothing outside the viewBox to what the body itself reaches through the whole %s motion", (state) => {
    for (const id of MASCOT_BODY_IDS) {
      const body = MASCOT_BODIES[id];
      const reach = strokeReachPastOutline(svg({ size: 96, silhouette: body }), body.fit);
      const outline = outlinePoints(body.clip).map((point) => applyTransform(body.fit, point));
      let min = Infinity, max = -Infinity;
      for (let elapsed = 0; elapsed <= 2000; elapsed += 10) {
        const transform = bodyTransform(MOTION[state], elapsed, 1);
        for (const point of outline) {
          const [x, y] = applyTransform(transform, point);
          min = Math.min(min, x, y);
          max = Math.max(max, x, y);
        }
      }
      expect(min, id).toBeLessThan(-5);
      expect(min - reach, id).toBeGreaterThanOrEqual(Math.min(min, -VIEW_MARGIN));
      expect(max + reach, id).toBeLessThanOrEqual(Math.max(max, FACE_BOX + VIEW_MARGIN));
    }
  });

  it("measures a stroke drawn outside the body's clip as reaching past the outline", () => {
    const halo = '<g fill="none"><use href="#a-shape" transform="translate(4 4) scale(0.5)" stroke-width="42"></use></g>';
    expect(strokeReachPastOutline(halo, "translate(4 4) scale(0.5)")).toBe(10.5);
  });

  it("keeps the rim the same width on screen whatever the body's fit scale", () => {
    const width = (id: "cursor" | "circle") => Number(/-rim\)"[^>]*><use [^>]*stroke-width="([\d.]+)"/.exec(svg({ size: 44, silhouette: MASCOT_BODIES[id] }))![1]);
    const scale = (id: "cursor" | "circle") => Number(/scale\(([\d.]+)\)/.exec(MASCOT_BODIES[id].fit)![1]);
    expect(width("cursor") * scale("cursor")).toBeCloseTo(width("circle") * scale("circle"), 5);
  });

  it("drops the rim, the core glow and the eye halo at sidebar sizes and keeps the gloss", () => {
    const small = svg({ size: 20 });
    expect(small).toMatch(/fill="url\(#[^)]+-gloss\)"/);
    expect(small).not.toMatch(/-rim|-core|stroke-opacity/);
  });

  it("fades the fine details in between 20 and 28 px instead of switching them on", () => {
    const rimOpacity = (size: number) => Number(/<g clip-path="[^"]+" opacity="([\d.]+)" fill="none"/.exec(svg({ size }))![1]);
    expect([21, 24, 27, 28, 96].map(rimOpacity)).toEqual([0.125, 0.5, 0.875, 1, 1]);
    expect(svg({ size: 24 })).toContain('stroke-opacity="0.15" stroke-width="11"');
  });

  it("halos white eyes only", () => {
    expect(svg({ size: 96 })).toContain('stroke-opacity="0.3" stroke-width="11"');
    expect(svg({ size: 96, eyeColor: "#000000" })).not.toContain('stroke-width="11"');
  });

  it("paints nothing over a picture body", () => {
    const steel = svg({ size: 96, picture: "/steel/cursor-128.webp" });
    expect(steel).not.toMatch(/<use |-gloss|-core|-rim|-shape/);
    expect(steel).toContain("-grad");
  });
});
