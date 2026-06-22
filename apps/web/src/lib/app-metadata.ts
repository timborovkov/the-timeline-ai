import type { Metadata } from 'next';

const APP_TITLE = 'The Timeline';

export function appMetadataForTeam(teamName: string | null): Metadata {
  const titleSuffix = teamName ? `${teamName} · ${APP_TITLE}` : APP_TITLE;
  return {
    robots: { index: false, follow: false },
    title: {
      default: titleSuffix,
      template: `%s · ${titleSuffix}`,
    },
  };
}
