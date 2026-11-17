import type { ReactNode, SVGProps } from "react";

export type MascotFinish = "glass";

export const DEFAULT_FINISH: MascotFinish = "glass";

export type MascotGradient = [string, string, string];

export interface FinishInput {
  uid: string;
  gradient: MascotGradient;
  silhouette: { fit: string; clip: string };
  sizePx: number;
  eyeColor: string;
}

export interface FinishPaint {
  /** Must define the gradient `${uid}-grad`: the body and the state glyphs are filled with it. */
  defs: ReactNode;
  /** Drawn over the filled body and under the face. */
  over: ReactNode;
  eye?: SVGProps<SVGPathElement>;
}

interface FinishStyle {
  /** The body's three stops, light to deep, from a bot colour. */
  gradient: (fill: string) => MascotGradient;
  paint: (input: FinishInput) => FinishPaint;
}

type Hsl = [number, number, number];

function toHsl(hex: string): Hsl {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [h, s, l];
}

function toHex([h, s, l]: Hsl): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number) => {
    const t = (((h + offset) / 360) % 1 + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(120)}${channel(0)}${channel(-120)}`;
}

function hueToward(hue: number, target: number, degrees: number): number {
  const delta = ((target - hue + 540) % 360) - 180;
  return hue + Math.sign(delta) * Math.min(Math.abs(delta), degrees);
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const GLASS = {
  hueShift: 16,
  lightHue: 60,
  deepHue: 255,
  /** Below this the rim, the core glow and the eye halo are finer than a pixel and only blur the mark. */
  detailFromPx: 24,
  rimUnits: 5,
};

function glassGradient(fill: string): MascotGradient {
  const [h, s, l] = toHsl(fill);
  const vivid = clamp01(s * 1.12);
  return [
    toHex([hueToward(h, GLASS.lightHue, GLASS.hueShift), clamp01(s * 1.2), l + (1 - l) * 0.3]),
    toHex([h, vivid, l]),
    toHex([hueToward(h, GLASS.deepHue, GLASS.hueShift), vivid, l * 0.7]),
  ];
}

const fitScale = (fit: string) => Number(/scale\(([\d.]+)/.exec(fit)?.[1] ?? 1) || 1;

function glassPaint({ uid, gradient, silhouette, sizePx, eyeColor }: FinishInput): FinishPaint {
  const detailed = sizePx >= GLASS.detailFromPx;
  const fit = silhouette.fit || undefined;
  const shape = `#${uid}-shape`;
  return {
    defs: (
      <>
        <linearGradient id={`${uid}-grad`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor={gradient[0]} />
          <stop offset="48%" stopColor={gradient[1]} />
          <stop offset="100%" stopColor={gradient[2]} />
        </linearGradient>
        <radialGradient id={`${uid}-gloss`} cx="0.42" cy="-0.42" r="0.98">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="88%" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="89%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {detailed && (
          <>
            <radialGradient id={`${uid}-core`} cx="0.5" cy="0.56" r="0.5">
              <stop offset="0%" stopColor={gradient[0]} stopOpacity="0.5" />
              <stop offset="100%" stopColor={gradient[0]} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-rim`} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.62" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.3" />
            </linearGradient>
          </>
        )}
        <g id={`${uid}-shape`} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      </>
    ),
    over: (
      <>
        {detailed && <use href={shape} transform={fit} fill={`url(#${uid}-core)`} />}
        <use href={shape} transform={fit} fill={`url(#${uid}-gloss)`} />
        {detailed && (
          <g clipPath={`url(#${uid}-clip)`}>
            <use
              href={shape}
              transform={fit}
              fill="none"
              stroke={`url(#${uid}-rim)`}
              strokeWidth={(GLASS.rimUnits * 2) / fitScale(silhouette.fit)}
              strokeLinejoin="round"
            />
          </g>
        )}
      </>
    ),
    eye: detailed && eyeColor.toLowerCase() === "#ffffff"
      ? { stroke: eyeColor, strokeOpacity: 0.24, strokeWidth: 9, strokeLinejoin: "round" }
      : undefined,
  };
}

const FINISHES: Record<MascotFinish, FinishStyle> = {
  glass: { gradient: glassGradient, paint: glassPaint },
};

export const finishGradient = (fill: string, finish: MascotFinish = DEFAULT_FINISH) => FINISHES[finish].gradient(fill);

export const finishPaint = (input: FinishInput, finish: MascotFinish = DEFAULT_FINISH) => FINISHES[finish].paint(input);
