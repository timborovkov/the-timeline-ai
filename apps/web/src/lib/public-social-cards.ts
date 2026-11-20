interface PublicSocialCard {
  id: string;
  path: string;
  title: string;
  alt: string;
  label: string;
  steps: readonly [string, string, string];
  markers: readonly [string, string, string];
}

export const PUBLIC_SOCIAL_CARDS: readonly PublicSocialCard[] = [
  {
    id: 'pricing',
    path: '/pricing',
    title: 'Pricing that starts free',
    alt: 'The Timeline pricing preview showing how to start free and choose a plan.',
    label: 'Pricing options',
    steps: ['Start free', 'Pay as you go', 'Team or Business'],
    markers: ['FREE', 'USAGE', 'PLAN'],
  },
  {
    id: 'product-tour',
    path: '/product-tour',
    title: 'See your work become a record',
    alt: 'The Timeline product tour preview showing capture, cited answers, and approvals.',
    label: 'Product tour',
    steps: ['Capture selected work', 'Ask with citations', 'Approve record changes'],
    markers: ['08:40', '10:15', '11:04'],
  },
  {
    id: 'slack-google-drive',
    path: '/guides/search-slack-and-google-drive-together',
    title: 'Search Slack and Google Drive together',
    alt: 'Guide preview showing Slack threads and Drive documents feeding a cited answer.',
    label: 'Cross-tool search',
    steps: ['Slack threads', 'Drive documents', 'One cited answer'],
    markers: ['CHAT', 'DOC', 'ASK'],
  },
  {
    id: 'meeting-action-items',
    path: '/guides/track-action-items-meetings-slack-email',
    title: 'Track action items across conversations',
    alt: 'Guide preview showing how to capture commitments, confirm owners, and track follow-up.',
    label: 'Action items',
    steps: ['Capture commitments', 'Confirm owners', 'Track follow-up'],
    markers: ['LOG', 'OWN', 'DO'],
  },
  {
    id: 'daily-slack-updates',
    path: '/guides/automate-daily-team-updates-in-slack',
    title: 'Automate daily team updates in Slack',
    alt: 'Guide preview showing how selected work becomes a daily Slack update with sources.',
    label: 'Daily team updates',
    steps: ['Select the sources', 'Summarize changes', 'Send the update'],
    markers: ['IN', 'LOG', 'OUT'],
  },
];
