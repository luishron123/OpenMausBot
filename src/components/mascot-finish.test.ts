import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CursorAvatar } from "./CursorAvatar";
import { finishGradient } from "./mascot-finish";
import { MAUS_COLORS } from "@/lib/mascot";
import { MASCOT_BODIES, MASCOT_BODY_IDS } from "../../shared/mascot-bodies";

const luma = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

const svg = (props: Partial<Parameters<typeof CursorAvatar>[0]>) =>
  renderToStaticMarkup(createElement(CursorAvatar, { paused: true, ...props }));

describe("the glass finish", () => {
  it("runs every bot colour from a lighter stop to a deeper one", () => {
    for (const fill of Object.values(MAUS_COLORS)) {
      const stops = finishGradient(fill);
      for (const stop of stops) expect(stop).toMatch(/^#[0-9a-f]{6}$/);
      expect(luma(stops[0])).toBeGreaterThan(luma(stops[1]));
      expect(luma(stops[1])).toBeGreaterThan(luma(stops[2]));
    }
  });

  it("keeps a grey grey", () => {
    for (const stop of finishGradient("#808080")) expect(new Set([stop.slice(1, 3), stop.slice(3, 5), stop.slice(5, 7)]).size).toBe(1);
  });

  it("draws the rim inside the body's own clip on every body, so the outline does not grow", () => {
    for (const id of MASCOT_BODY_IDS) {
      const markup = svg({ size: 44, silhouette: MASCOT_BODIES[id] });
      expect(markup).toMatch(/<g clip-path="url\(#[^)]+-clip\)" opacity="1"><use href="#[^"]+-shape"[^>]*fill="none" stroke="url\(#[^)]+-rim\)"/);
      expect(markup.split(MASCOT_BODIES[id].clip).length - 1).toBe(2);
    }
  });

  it("keeps the rim the same width on screen whatever the body's fit scale", () => {
    const width = (id: "cursor" | "circle") => Number(/stroke-width="([\d.]+)" stroke-linejoin/.exec(svg({ size: 44, silhouette: MASCOT_BODIES[id] }))![1]);
    const scale = (id: "cursor" | "circle") => Number(/scale\(([\d.]+)\)/.exec(MASCOT_BODIES[id].fit)![1]);
    expect(width("cursor") * scale("cursor")).toBeCloseTo(width("circle") * scale("circle"), 5);
  });

  it("drops the rim, the core glow and the eye halo at sidebar sizes and keeps the gloss", () => {
    const small = svg({ size: 20 });
    expect(small).toMatch(/fill="url\(#[^)]+-gloss\)"/);
    expect(small).not.toMatch(/-rim|-core|stroke-opacity/);
  });

  it("fades the fine details in between 20 and 28 px instead of switching them on", () => {
    const rimOpacity = (size: number) => Number(/<g clip-path="[^"]+" opacity="([\d.]+)"><use/.exec(svg({ size }))![1]);
    expect([21, 24, 27, 28, 96].map(rimOpacity)).toEqual([0.125, 0.5, 0.875, 1, 1]);
    expect(svg({ size: 24 })).toContain('stroke-opacity="0.12"');
  });

  it("halos white eyes only", () => {
    expect(svg({ size: 96 })).toContain('stroke-opacity="0.24"');
    expect(svg({ size: 96, eyeColor: "#000000" })).not.toContain("stroke-opacity");
  });

  it("paints nothing over a picture body", () => {
    const steel = svg({ size: 96, picture: "/steel/cursor-128.webp" });
    expect(steel).not.toMatch(/<use |-gloss|-core|-rim|-shape/);
    expect(steel).toContain("-grad");
  });
});
