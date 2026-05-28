'use client';

import { ErrorState } from '@/components/error-state';

export default function ErrorPage() {
  return (
    <ErrorState
      title="Couldn't load Slack settings"
      description="The Slack settings failed to load. This is usually transient."
    />
  );
}
