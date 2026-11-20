import styles from '@/app/(landing)/home.module.css';
import {
  HERO_MESH_EDGES,
  meshEdgePath,
  meshNodePath,
  projectMeshPoint,
} from '@/components/marketing/home/hero-mesh-geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TURNS = Array.from({ length: 49 }, (_, frame) => frame / 48);

function animate(path: SVGPathElement, attribute: string, values: string[]) {
  const element = document.createElementNS(SVG_NS, 'animate');
  element.setAttribute('attributeName', attribute);
  element.setAttribute('values', values.join(';'));
  element.setAttribute('dur', '24s');
  element.setAttribute('repeatCount', 'indefinite');
  path.append(element);
}

export function mountHeroMeshMotion(mesh: SVGGElement) {
  const group = mesh.querySelector('[data-hero-mesh-motion]');
  if (!group || mesh.hasAttribute('data-mesh-ready')) return;
  const nodes = document.createElementNS(SVG_NS, 'path');
  nodes.setAttribute('class', styles.heroMeshNodes ?? '');
  nodes.setAttribute('d', meshNodePath(0));
  animate(nodes, 'd', TURNS.map(meshNodePath));
  const edges = HERO_MESH_EDGES.map(([start, end]) => {
    const frames = TURNS.map((turn) => {
      const a = projectMeshPoint(start, turn);
      const b = projectMeshPoint(end, turn);
      return {
        d: meshEdgePath(a, b),
        opacity: (0.18 + ((a.depth + b.depth + 4) / 8) * 0.5).toFixed(2),
      };
    });
    const edge = document.createElementNS(SVG_NS, 'path');
    edge.setAttribute('d', frames[0]?.d ?? '');
    animate(
      edge,
      'd',
      frames.map(({ d }) => d),
    );
    animate(
      edge,
      'opacity',
      frames.map(({ opacity }) => opacity),
    );
    return edge;
  });
  group.replaceChildren(nodes, ...edges);
  mesh.setAttribute('data-mesh-ready', '');
}
