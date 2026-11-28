import type { UpdateSection, UpdateSettings } from '#src/messaging/update-settings.js';

export interface UpdateReportLink {
  label: string;
  href: string;
}

export interface UpdateReportItem {
  title: string;
  detail?: string;
  links: UpdateReportLink[];
  /** Used to recheck visibility before reading or sending a stored report. */
  evidence?: { kind: 'event' | 'object' | 'calendar'; ids: string[] };
}

export interface UpdateReportGroup {
  section: UpdateSection;
  items: UpdateReportItem[];
  /** Revalidate every event in the model input alongside display citations. */
  synthesisEventIds?: string[];
}

export interface UpdateReport {
  name: string;
  revision: string;
  detail: UpdateSettings['detail'];
  groups: UpdateReportGroup[];
}
