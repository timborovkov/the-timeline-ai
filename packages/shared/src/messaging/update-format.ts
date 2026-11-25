import {
  absoluteDigestAppUrl,
  formatDigestDate,
  formatDigestWindowRange,
} from '#src/messaging/digest-format.js';
import type { DailyDigestPayload } from '#src/messaging/types.js';
import type { UpdateReportGroup } from '#src/messaging/update-report-types.js';
import { UPDATE_SECTIONS } from '#src/messaging/update-settings.js';

export function updateSectionLabel(section: UpdateReportGroup['section']): string {
  return UPDATE_SECTIONS.find((option) => option.value === section)?.label ?? 'Activity';
}

export function updateSubject(payload: DailyDigestPayload): string {
  if (!payload.update && payload.updateRevision) return 'Timeline update';
  return `${payload.update?.name ?? 'Update'} · ${payload.teamName}`.replace(/[\r\n]/g, ' ');
}

export function updateWorkspaceUrl(baseUrl: string, href: string, teamId: string): string | null {
  const destination = absoluteDigestAppUrl(baseUrl, href);
  if (!destination) return null;
  const target = new URL(destination);
  return new URL(
    `/app/updates/open?${new URLSearchParams({
      team: teamId,
      to: `${target.pathname}${target.search}${target.hash}`,
    }).toString()}`,
    target.origin,
  ).toString();
}

export function formatUpdateChatText(input: {
  payload: DailyDigestPayload;
  digestUrl: string;
  teamId: string;
  channel: 'telegram' | 'slack';
}): string {
  const { payload, digestUrl, teamId, channel } = input;
  const clean = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const bold = (text: string) =>
    channel === 'telegram' ? `<b>${clean(text)}</b>` : `*${clean(text).replaceAll('*', '∗')}*`;
  const link = (text: string, url: string) =>
    channel === 'telegram'
      ? `<a href="${clean(url).replaceAll('"', '&quot;')}">${clean(text)}</a>`
      : `<${clean(url)}|${clean(text).replaceAll('|', ' ')}>`;
  const date = formatDigestDate(payload.windowEnd, payload.timezone);
  const grouped = [];
  for (const group of payload.update?.groups ?? []) {
    const limit = payload.update?.detail === 'detailed' ? 4 : 3;
    const lines = group.items.slice(0, limit).map((item) => {
      const source = item.links[0];
      const url = source && updateWorkspaceUrl(digestUrl, source.href, teamId);
      return `• ${url ? link(item.title, url) : clean(item.title)}${group.section !== 'activity' && item.detail ? ` · ${clean(item.detail)}` : ''}`;
    });
    if (lines.length) grouped.push([bold(updateSectionLabel(group.section)), ...lines]);
  }
  const intro = `${bold(updateSubject(payload))}\n${clean(date)}`;
  const more = link('Open update', digestUrl);
  const lines = [intro];
  for (const [heading, ...items] of grouped) {
    if (!heading) continue;
    const fitting: string[] = [];
    for (const item of items) {
      const candidate = [...lines, [heading, ...fitting, item].join('\n'), more].join('\n\n');
      if (candidate.length > 3900) break;
      fitting.push(item);
    }
    if (fitting.length) lines.push([heading, ...fitting].join('\n'));
  }
  return [...lines, more].join('\n\n');
}

export function updateCoveringRange(payload: DailyDigestPayload): string {
  return formatDigestWindowRange(payload.windowStart, payload.windowEnd, payload.timezone);
}
