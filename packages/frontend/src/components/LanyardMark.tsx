/**
 * The Lanyard Health submark (the interlocking loop glyph), extracted from
 * public/logo-full.svg so it can be recolored/scaled freely. Exposes the
 * component plus a CSS background tile builder for the repeated-watermark
 * pattern on auth pages. Natural glyph box: 148.042 x 114.
 */
export const LANYARD_MARK_PATHS = [
  'M50.0884 48.9772C50.0884 21.9735 72.0619 -3.32124e-06 99.0657 -2.14086e-06C126.069 -9.60493e-07 148.043 21.9735 148.043 48.9773L148.043 86.868L134.206 86.868L134.206 48.9773C134.206 29.5972 118.446 13.8367 99.0657 13.8367C79.6857 13.8367 63.9252 29.5972 63.9252 48.9773L50.0884 48.9772Z',
  'M17.015 65.1222L17.015 27.146L30.8518 27.146L30.8518 65.1222C30.8518 75.1115 38.9885 83.2482 48.9778 83.2482C58.967 83.2482 67.1038 75.1115 67.1038 65.1222L67.1038 48.8915C67.1038 31.2642 81.4393 16.9287 99.0665 16.9287C116.694 16.9287 131.029 31.2642 131.029 48.8915L131.029 86.8677L117.193 86.8677L117.193 48.8915C117.193 38.9022 109.056 30.7655 99.0665 30.7655C89.0773 30.7655 80.9405 38.9022 80.9405 48.8915L80.9405 65.1222C80.9405 82.7495 66.605 97.085 48.9778 97.085C31.3505 97.085 17.015 82.7495 17.015 65.1222Z',
  'M0.000547335 65.0226L0.000548992 27.1318L13.8373 27.1318L13.8373 65.0226C13.8373 84.4026 29.5978 100.163 48.9778 100.163C68.3578 100.163 84.1183 84.4026 84.1183 65.0226L97.9551 65.0226C97.9551 92.0264 75.9816 114 48.9778 114C21.9741 114 0.000546155 92.0264 0.000547335 65.0226Z',
] as const;

/**
 * Repeating watermark tile: one submark per cell, meant to be layered twice
 * with a half-cell background-position offset for a staggered brick pattern.
 */
export function lanyardMarkTileUrl(fill: string, cellW = 340, cellH = 260): string {
  const x = (cellW - 148) / 2;
  const y = (cellH - 114) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${cellH}" viewBox="0 0 ${cellW} ${cellH}"><g fill="${fill}" transform="translate(${x},${y})">${LANYARD_MARK_PATHS.map(
    (d) => `<path d="${d}"/>`,
  ).join('')}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function LanyardMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 148.042 114"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {LANYARD_MARK_PATHS.map((d) => (
        <path key={d.slice(0, 16)} d={d} />
      ))}
    </svg>
  );
}
