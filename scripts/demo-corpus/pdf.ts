/** Minimal single-page PDF with wrapped Helvetica text. Deterministic bytes. */
export function buildSimplePdf(title: string, paragraphs: string[]): Buffer {
  const lines = [`${title}`, '', ...wrapParagraphs(paragraphs, 86)];
  const commands = ['BT', '/F1 11 Tf', '50 760 Td', '14 TL'];
  for (const [index, line] of lines.entries()) {
    if (index > 0) commands.push('T*');
    commands.push(`(${escapePdf(line)}) Tj`);
  }
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${String(Buffer.byteLength(stream))} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let offset = 9; // `%PDF-1.4\n`
  const offsets = [0];
  const body: string[] = [];
  for (const object of objects) {
    offsets.push(offset);
    body.push(object);
    offset += Buffer.byteLength(`${object}\n`);
  }
  const xrefStart = offset;
  const xrefLines = ['xref', '0 6', '0000000000 65535 f '];
  for (const value of offsets.slice(1)) {
    xrefLines.push(`${value.toString().padStart(10, '0')} 00000 n `);
  }
  const trailer = ['trailer << /Size 6 /Root 1 0 R >>', 'startxref', String(xrefStart), '%%EOF'];
  return Buffer.from(['%PDF-1.4', ...body, ...xrefLines, ...trailer].join('\n'), 'latin1');
}

function wrapParagraphs(paragraphs: string[], width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    lines.push('');
  }
  return lines.slice(0, 48);
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
