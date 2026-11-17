import type { ReactNode, SVGProps } from "react";

export type MascotFinish = "mascot" | "glass";

export const DEFAULT_FINISH: MascotFinish = "glass";

export type MascotGradient = [string, string, string];

export interface FinishInput {
  uid: string;
  gradient: MascotGradient;
  silhouette: { fit: string; clip: string; anchor: { x: number; y: number } };
  sizePx: number;
  chosenFaceInk: string | undefined;
  bodyIsPicture: boolean;
}

export interface FinishPaint {
  defs: ReactNode;
  overBody: ReactNode;
  faceInk: string;
  eye: SVGProps<SVGPathElement>;
}

interface FinishStyle {
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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const DETAIL = { fadesInFromPx: 20, fullAtPx: 28 };

const detailAt = (sizePx: number) => clamp01((sizePx - DETAIL.fadesInFromPx) / (DETAIL.fullAtPx - DETAIL.fadesInFromPx));

const WHITE = "#ffffff";

const GLASS = {
  secondHueShift: -34,
  lightHueShift: 10,
  rimUnits: 5,
  glowUnits: 13,
};

function glassGradient(fill: string): MascotGradient {
  const [h, s, l] = toHsl(fill);
  return [
    toHex([h + GLASS.lightHueShift, clamp01(s * 1.2), l + (1 - l) * 0.34]),
    toHex([h, clamp01(s * 1.12), l]),
    toHex([h + GLASS.secondHueShift, clamp01(s * 1.12), l * 0.86]),
  ];
}

const fitScale = (fit: string) => Number(/scale\(([\d.]+)/.exec(fit)?.[1] ?? 1) || 1;

function glassPaint({ uid, gradient, silhouette, sizePx, chosenFaceInk, bodyIsPicture }: FinishInput): FinishPaint {
  const faceInk = chosenFaceInk ?? WHITE;
  const bodyGradient = (
    <linearGradient id={`${uid}-grad`} x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stopColor={gradient[0]} />
      <stop offset="45%" stopColor={gradient[1]} />
      <stop offset="100%" stopColor={gradient[2]} />
    </linearGradient>
  );
  if (bodyIsPicture) return { defs: bodyGradient, overBody: null, faceInk, eye: {} };
  const detail = detailAt(sizePx);
  const detailed = detail > 0;
  const fit = silhouette.fit || undefined;
  const shape = `#${uid}-shape`;
  const units = 1 / fitScale(silhouette.fit);
  return {
    defs: (
      <>
        {bodyGradient}
        <radialGradient id={`${uid}-gloss`} cx="0.4" cy="-0.3" r="1.05">
          <stop offset="0%" stopColor={WHITE} stopOpacity="0.55" />
          <stop offset="62%" stopColor={WHITE} stopOpacity="0.2" />
          <stop offset="100%" stopColor={WHITE} stopOpacity="0" />
        </radialGradient>
        {detailed && (
          <>
            <radialGradient id={`${uid}-core`} cx="0.5" cy="0.56" r="0.5">
              <stop offset="0%" stopColor={gradient[0]} stopOpacity="0.5" />
              <stop offset="100%" stopColor={gradient[0]} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-rim`} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stopColor={WHITE} stopOpacity="0.7" />
              <stop offset="55%" stopColor={WHITE} stopOpacity="0.16" />
              <stop offset="100%" stopColor={WHITE} stopOpacity="0.4" />
            </linearGradient>
          </>
        )}
        <g id={`${uid}-shape`} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      </>
    ),
    overBody: (
      <>
        {detailed && <use href={shape} transform={fit} fill={`url(#${uid}-core)`} opacity={detail} />}
        <use href={shape} transform={fit} fill={`url(#${uid}-gloss)`} />
        {detailed && (
          <g clipPath={`url(#${uid}-clip)`} opacity={detail} fill="none" stroke={`url(#${uid}-rim)`} strokeLinejoin="round">
            <use href={shape} transform={fit} strokeWidth={GLASS.glowUnits * 2 * units} strokeOpacity="0.35" />
            <use href={shape} transform={fit} strokeWidth={GLASS.rimUnits * 2 * units} />
          </g>
        )}
      </>
    ),
    faceInk,
    eye: detailed && faceInk.toLowerCase() === WHITE
      ? { stroke: faceInk, strokeOpacity: 0.3 * detail, strokeWidth: 11, strokeLinejoin: "round" }
      : {},
  };
}

const MASCOT = {
  ink: "#17171c",
  shadeLightness: 0.74,
  tintTowardWhite: 0.42,
  inkNeedsLumaAbove: 0.3,
  highlight: { dx: -30, dy: -50, rx: 25, ry: 10.5, tilt: -38, opacity: 0.7 },
};

function mascotGradient(fill: string): MascotGradient {
  const [h, s, l] = toHsl(fill);
  return [toHex([h, s, l + (1 - l) * MASCOT.tintTowardWhite]), fill, toHex([h, s, l * MASCOT.shadeLightness])];
}

const isHex = (color: string) => /^#[0-9a-f]{6}$/i.test(color);

function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

function mix(from: string, to: string, amount: number): string {
  const a = Number.parseInt(from.slice(1), 16), b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * amount));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

function mascotPaint({ uid, gradient, silhouette, sizePx, chosenFaceInk, bodyIsPicture }: FinishInput): FinishPaint {
  const [tint, fill, shade] = gradient;
  const bodyCarriesInk = isHex(fill) && luma(fill) > MASCOT.inkNeedsLumaAbove;
  const faceInk = chosenFaceInk ?? (bodyCarriesInk ? MASCOT.ink : WHITE);
  const flatFill = (
    <linearGradient id={`${uid}-grad`}>
      <stop offset="0%" stopColor={fill} />
    </linearGradient>
  );
  if (bodyIsPicture) return { defs: flatFill, overBody: null, faceInk: chosenFaceInk ?? WHITE, eye: {} };
  const detail = detailAt(sizePx);
  const sparkles = detail > 0 && isHex(faceInk) && faceInk.toLowerCase() !== WHITE;
  const fit = silhouette.fit || undefined;
  const { dx, dy, rx, ry, tilt, opacity } = MASCOT.highlight;
  const x = silhouette.anchor.x + dx, y = silhouette.anchor.y + dy;
  return {
    defs: (
      <>
        {flatFill}
        <radialGradient id={`${uid}-belly`} cx="0.5" cy="-1.3" r="2.115">
          <stop offset="99.4%" stopColor={shade} stopOpacity="0" />
          <stop offset="100%" stopColor={shade} />
        </radialGradient>
        {sparkles && (
          <radialGradient id={`${uid}-eye`} cx="0.7" cy="0.27" r="0.2">
            <stop offset="78%" stopColor={mix(faceInk, WHITE, detail)} />
            <stop offset="100%" stopColor={faceInk} />
          </radialGradient>
        )}
        <g id={`${uid}-shape`} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      </>
    ),
    overBody: (
      <>
        <use href={`#${uid}-shape`} transform={fit} fill={`url(#${uid}-belly)`} />
        {detail > 0 && (
          <g clipPath={`url(#${uid}-clip)`} opacity={detail * opacity}>
            <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={tint} transform={`rotate(${tilt} ${x} ${y})`} />
          </g>
        )}
      </>
    ),
    faceInk,
    eye: sparkles ? { fill: `url(#${uid}-eye)` } : {},
  };
}

const FINISHES: Record<MascotFinish, FinishStyle> = {
  mascot: { gradient: mascotGradient, paint: mascotPaint },
  glass: { gradient: glassGradient, paint: glassPaint },
};

export const finishGradient = (fill: string, finish: MascotFinish = DEFAULT_FINISH) => FINISHES[finish].gradient(fill);

export const finishPaint = (input: FinishInput, finish: MascotFinish = DEFAULT_FINISH) => FINISHES[finish].paint(input);
