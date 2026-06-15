import { APP_GUIDE_ROUTES } from '@timeline/shared/app-guide';

export interface ArtifactRoutePreview {
  id: string;
  title: string;
  description: string;
  href: string;
  group: 'dashboard' | 'help';
}

const ARTIFACT_ROUTE_PREVIEWS: readonly ArtifactRoutePreview[] = APP_GUIDE_ROUTES.map(
  ({ id, title, description, href, group }) => ({ id, title, description, href, group }),
);

export function getArtifactRoutePreview(id: string): ArtifactRoutePreview | null {
  return ARTIFACT_ROUTE_PREVIEWS.find((route) => route.id === id) ?? null;
}
