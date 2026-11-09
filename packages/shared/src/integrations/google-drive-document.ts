/**
 * Native Google Docs stay on the free text path. Drive `files.export`
 * `text/plain` is not documented as covering every document tab (the newer
 * Docs tabs feature, including nested child tabs). Docs API `documents.get`
 * without `includeTabsContent=true` returns the first tab only. Capture lists
 * every tab in UI order and formats a stable document text before `contentHash`.
 * One paragraph serializer keeps person smart chips (name/email), rich/resource
 * links, ordinary `textStyle.link` destinations, and inline objects — not only
 * plain `textRun.content` — so an ownership chip, retargeted chip, or URL-only
 * hyperlink change hashes. Suggested insertions are omitted.
 */

export interface DriveDocumentTab {
  title: string;
  text: string;
}

export interface DriveDocumentApiTab {
  tabProperties?: { title?: string };
  documentTab?: { body?: { content?: readonly unknown[] } };
  childTabs?: readonly DriveDocumentApiTab[];
}

export interface DriveDocumentApiResource {
  title?: string;
  tabs?: readonly DriveDocumentApiTab[];
  body?: { content?: readonly unknown[] };
}

export function flattenDriveDocumentTabs(
  tabs: readonly DriveDocumentApiTab[] | undefined,
): DriveDocumentTab[] {
  const flattened: DriveDocumentTab[] = [];
  for (const tab of tabs ?? []) {
    addCurrentAndChildTabs(tab, flattened);
  }
  return flattened;
}

export function extractDriveDocumentStructuralText(
  elements: readonly unknown[] | undefined,
): string {
  if (!elements) return '';
  let text = '';
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const value = element as {
      paragraph?: { elements?: readonly unknown[] };
      table?: {
        tableRows?: readonly { tableCells?: readonly { content?: readonly unknown[] }[] }[];
      };
      tableOfContents?: { content?: readonly unknown[] };
    };
    if (value.paragraph?.elements) {
      for (const paragraphElement of value.paragraph.elements) {
        text += serializeDriveDocumentParagraphElement(paragraphElement);
      }
      continue;
    }
    if (value.table?.tableRows) {
      for (const row of value.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          text += extractDriveDocumentStructuralText(cell.content);
        }
      }
      continue;
    }
    if (value.tableOfContents?.content) {
      text += extractDriveDocumentStructuralText(value.tableOfContents.content);
    }
  }
  return text;
}

export function formatDriveDocumentTabs(tabs: readonly DriveDocumentTab[]): string {
  if (tabs.length === 1) return tabs[0]?.text ?? '';
  return tabs
    .map((tab) => {
      const body = tab.text.replace(/\n+$/u, '');
      return body.length > 0 ? `# Tab: ${tab.title}\n${body}` : `# Tab: ${tab.title}`;
    })
    .join('\n\n');
}

export function formatDriveDocumentFromApi(doc: DriveDocumentApiResource): string {
  const tabs = flattenDriveDocumentTabs(doc.tabs);
  if (tabs.length > 0) return formatDriveDocumentTabs(tabs);
  const text = extractDriveDocumentStructuralText(doc.body?.content);
  return formatDriveDocumentTabs([{ title: driveDocumentTabTitle(doc.title), text }]);
}

function addCurrentAndChildTabs(tab: DriveDocumentApiTab, flattened: DriveDocumentTab[]): void {
  flattened.push({
    title: driveDocumentTabTitle(tab.tabProperties?.title),
    text: extractDriveDocumentStructuralText(tab.documentTab?.body?.content),
  });
  for (const child of tab.childTabs ?? []) {
    addCurrentAndChildTabs(child, flattened);
  }
}

function driveDocumentTabTitle(title: string | undefined): string {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : 'Untitled tab';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function isSuggestedInsertion(record: Record<string, unknown> | null): boolean {
  const ids = record?.suggestedInsertionIds;
  return Array.isArray(ids) && ids.some((id) => typeof id === 'string' && id.length > 0);
}

function serializeDestination(input: { label: string; uri: string; mimeType?: string }): string {
  const label = input.label.trim();
  const uri = input.uri.trim();
  const mimeType = input.mimeType?.trim() ?? '';
  if (!label && !uri && !mimeType) return '';
  const text = label || uri;
  const href = uri && uri !== text ? `(${uri})` : '';
  const mime = mimeType ? ` {${mimeType}}` : '';
  if (href) return `[${text}]${href}${mime}`;
  return `[${text}]${mime}`;
}

/**
 * Single serializer for every meaningful non-plain Docs destination: person
 * chips, rich/resource links, ordinary textStyle hyperlinks, and inline objects.
 */
function serializeDriveDocumentParagraphElement(element: unknown): string {
  const record = asRecord(element);
  if (!record) return '';
  const textRun = asRecord(record.textRun);
  if (textRun) return serializeTextRun(textRun);
  const person = asRecord(record.person);
  if (person) {
    if (isSuggestedInsertion(person)) return '';
    const serialized = serializePersonChip(person);
    if (serialized) return serialized;
  }
  const richLink = asRecord(record.richLink);
  if (richLink) {
    if (isSuggestedInsertion(richLink)) return '';
    const serialized = serializeRichLink(richLink);
    if (serialized) return serialized;
  }
  const inline = asRecord(record.inlineObjectElement);
  if (!inline || isSuggestedInsertion(inline)) return '';
  const objectId = stringField(inline, 'inlineObjectId').trim();
  return objectId ? `[object:${objectId}]` : '';
}

function serializeTextRun(textRun: Record<string, unknown>): string {
  if (isSuggestedInsertion(textRun)) return '';
  const content = typeof textRun.content === 'string' ? textRun.content : '';
  const url = stringField(asRecord(asRecord(textRun.textStyle)?.link), 'url').trim();
  if (!url) return content;
  const newline = content.endsWith('\n') ? '\n' : '';
  const label = newline ? content.slice(0, -1) : content;
  if (!label) return content;
  if (url === label.trim()) return content;
  return `${serializeDestination({ label, uri: url })}${newline}`;
}

function serializePersonChip(person: Record<string, unknown> | null): string {
  const properties = asRecord(person?.personProperties);
  const name = stringField(properties, 'name').trim();
  const email = stringField(properties, 'email').trim();
  if (name && email) return `@${name} <${email}>`;
  if (email) return `@<${email}>`;
  if (name) return `@${name}`;
  const personId = stringField(person, 'personId').trim();
  return personId ? `@[${personId}]` : '';
}

function serializeRichLink(link: Record<string, unknown> | null): string {
  const properties = asRecord(link?.richLinkProperties);
  const title = stringField(properties, 'title').trim();
  const uri = stringField(properties, 'uri').trim();
  const mimeType = stringField(properties, 'mimeType').trim();
  if (!title && !uri && !mimeType) {
    const richLinkId = stringField(link, 'richLinkId').trim();
    return richLinkId ? `[link:${richLinkId}]` : '';
  }
  return serializeDestination({ label: title, uri, mimeType });
}
