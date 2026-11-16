import styles from '@/app/(landing)/home.module.css';

const PHI = (1 + Math.sqrt(5)) / 2;
const BASE_VERTICES = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
] as const;
const BASE_EDGES = BASE_VERTICES.flatMap((point, a) =>
  BASE_VERTICES.flatMap((other, b) =>
    b > a && Math.abs(Math.hypot(...point.map((n, i) => n - (other[i] ?? 0))) - 2) < 0.01
      ? [[a, b] as const]
      : [],
  ),
);

const VERTICES: number[][] = BASE_VERTICES.map((point) => [...point]);
const midpointIds = new Map<string, number>();
function midpoint(a: number, b: number) {
  const key = [a, b].sort((x, y) => x - y).join('-');
  const existing = midpointIds.get(key);
  if (existing !== undefined) return existing;
  const point = (VERTICES[a] ?? []).map((n, i) => (n + (VERTICES[b]?.[i] ?? 0)) / 2);
  const scale = Math.hypot(1, PHI) / Math.hypot(...point);
  const id = VERTICES.push(point.map((n) => n * scale)) - 1;
  midpointIds.set(key, id);
  return id;
}
const edgeKeys = new Set(BASE_EDGES.map(([a, b]) => `${a}-${b}`));
const meshEdges = new Map<string, readonly [number, number]>();
function edge(a: number, b: number) {
  const pair = [Math.min(a, b), Math.max(a, b)] as const;
  meshEdges.set(pair.join('-'), pair);
}
// Subdivide each triangular face once and project the midpoints to the sphere.
for (let a = 0; a < BASE_VERTICES.length; a++) {
  for (let b = a + 1; b < BASE_VERTICES.length; b++) {
    for (let c = b + 1; c < BASE_VERTICES.length; c++) {
      if (!edgeKeys.has(`${a}-${b}`) || !edgeKeys.has(`${a}-${c}`) || !edgeKeys.has(`${b}-${c}`))
        continue;
      const ab = midpoint(a, b),
        ac = midpoint(a, c),
        bc = midpoint(b, c);
      for (const [start, end] of [
        [a, ab],
        [a, ac],
        [b, ab],
        [b, bc],
        [c, ac],
        [c, bc],
        [ab, ac],
        [ab, bc],
        [ac, bc],
      ] as const)
        edge(start, end);
    }
  }
}
const EDGES = [...meshEdges.values()];

function project(index: number, turn: number) {
  const [x = 0, y = 0, z = 0] = VERTICES[index] ?? [];
  const angle = turn * Math.PI * 2 + 0.3;
  const side = x * Math.cos(angle) + z * Math.sin(angle);
  const depth = -x * Math.sin(angle) + z * Math.cos(angle);
  const tilt = 0.35;
  return {
    x: (300 + side * 52).toFixed(2),
    y: (300 + (y * Math.cos(tilt) - depth * Math.sin(tilt)) * 52).toFixed(2),
    depth: y * Math.sin(tilt) + depth * Math.cos(tilt),
  };
}

function nodePath(turn: number) {
  return VERTICES.map((_, index) => {
    const point = project(index, turn);
    return `M${point.x} ${point.y}h0.01`;
  }).join(' ');
}
const NODE_FRAMES = Array.from({ length: 49 }, (_, frame) => nodePath(frame / 48));

/** Precomputed SVG geometry shares the hero's pause and reduced-motion timeline. */
export function HeroRecordMesh() {
  return (
    <g className={styles.heroRecordMesh} data-hero-record-mesh aria-hidden="true">
      <g className={styles.heroMeshStatic}>
        <path className={styles.heroMeshNodes} d={NODE_FRAMES[0]} />
        {EDGES.map(([a, b]) => {
          const start = project(a, 0),
            end = project(b, 0);
          return (
            <path key={`${a}-${b}`} d={`M${start.x} ${start.y}L${end.x} ${end.y}`} opacity="0.35" />
          );
        })}
      </g>
      <g className={styles.heroMeshMotion}>
        <path className={styles.heroMeshNodes} d={NODE_FRAMES[0]}>
          <animate
            attributeName="d"
            values={NODE_FRAMES.join(';')}
            dur="24s"
            repeatCount="indefinite"
          />
        </path>
        {EDGES.map(([a, b]) => {
          const frames = Array.from({ length: 49 }, (_, frame) => {
            const start = project(a, frame / 48);
            const end = project(b, frame / 48);
            return {
              path: `M${start.x} ${start.y}L${end.x} ${end.y}`,
              opacity: (0.18 + ((start.depth + end.depth + 4) / 8) * 0.5).toFixed(2),
            };
          });
          return (
            <path key={`${a}-${b}`} d={frames[0]?.path} opacity={frames[0]?.opacity}>
              <animate
                attributeName="d"
                values={frames.map((frame) => frame.path).join(';')}
                dur="24s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values={frames.map((frame) => frame.opacity).join(';')}
                dur="24s"
                repeatCount="indefinite"
              />
            </path>
          );
        })}
      </g>
    </g>
  );
}
