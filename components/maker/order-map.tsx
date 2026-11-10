import { COUNTRY_POINTS, MAP_HEIGHT, MAP_WIDTH } from "@/lib/geo/world-points";

// Arcs from the maker's country to where orders shipped, over the land outline in public/world.svg
// (scripts/build-world-map.ts). Decorative: callers list the countries as text.

type Point = [number, number];

/** Quadratic curve bowed upward, flatter for short hops. */
export function arcPath([x1, y1]: Point, [x2, y2]: Point): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const bow = Math.hypot(dx, dy) * 0.3;
  let nx = -dy;
  let ny = dx;
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const len = Math.hypot(nx, ny) || 1;
  const cx = (x1 + x2) / 2 + (nx / len) * bow;
  const cy = (y1 + y2) / 2 + (ny / len) * bow;
  return `M${x1} ${y1}Q${Math.round(cx)} ${Math.round(cy)} ${x2} ${y2}`;
}

export function OrderMap({ from, to, className }: { from: string; to: string[]; className?: string }) {
  const origin = COUNTRY_POINTS[from];
  if (!origin) return null;
  const targets = to.filter((c) => c !== from).flatMap((c) => (COUNTRY_POINTS[c] ? [COUNTRY_POINTS[c]] : []));
  return (
    <div className={className} aria-hidden>
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="block h-auto w-full">
        <image href="/world.svg" width={MAP_WIDTH} height={MAP_HEIGHT} />
        {targets.map((p) => (
          <path key={`arc-${p.join()}`} d={arcPath(origin, p)} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinecap="round" />
        ))}
        {targets.map((p) => (
          <circle key={`dot-${p.join()}`} cx={p[0]} cy={p[1]} r={6} className="fill-foreground" />
        ))}
        <circle cx={origin[0]} cy={origin[1]} r={14} className="fill-primary/20" />
        <circle cx={origin[0]} cy={origin[1]} r={8} className="fill-primary stroke-card" strokeWidth={3} />
      </svg>
    </div>
  );
}
