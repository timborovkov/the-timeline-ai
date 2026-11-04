/**
 * Native Google Docs stay on the free text path. Drive `files.export`
 * `text/plain` is not documented as covering every document tab (the newer
 * Docs tabs feature, including nested child tabs). Docs API `documents.get`
 * without `includeTabsContent=true` returns the first tab only. Capture lists
 * every tab in UI order and formats a stable document text before `contentHash`.
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
        text += readParagraphElement(paragraphElement);
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

function readParagraphElement(element: unknown): string {
  if (!element || typeof element !== 'object') return '';
  const textRun = (element as { textRun?: { content?: unknown } }).textRun;
  if (!textRun || typeof textRun.content !== 'string') return '';
  return textRun.content;
}
