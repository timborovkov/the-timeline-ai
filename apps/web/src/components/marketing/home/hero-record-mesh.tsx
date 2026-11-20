import styles from '@/app/(landing)/home.module.css';
import {
  HERO_MESH_EDGES,
  meshEdgePath,
  meshNodePath,
  projectMeshPoint,
} from '@/components/marketing/home/hero-mesh-geometry';

const staticEdges = HERO_MESH_EDGES.map(([start, end]) =>
  meshEdgePath(projectMeshPoint(start, 0), projectMeshPoint(end, 0)),
).join(' ');

export function HeroRecordMesh() {
  return (
    <g className={styles.heroRecordMesh} data-hero-record-mesh aria-hidden="true">
      <g className={styles.heroMeshStatic}>
        <path className={styles.heroMeshNodes} d={meshNodePath(0)} />
        <path d={staticEdges} opacity="0.35" />
      </g>
      <g className={styles.heroMeshMotion} data-hero-mesh-motion />
    </g>
  );
}
