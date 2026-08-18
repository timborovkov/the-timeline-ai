export function copyAnnouncement(label: string): string {
  const noun = label.replace(/^Copy\s+/iu, '').trim();
  return noun && noun.toLowerCase() !== 'copy' ? `Copied ${noun}.` : 'Copied.';
}
