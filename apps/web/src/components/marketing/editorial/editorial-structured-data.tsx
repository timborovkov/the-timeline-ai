const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
};

export function EditorialStructuredData({ data }: { data: Record<string, unknown> }) {
  return (
    // react-doctor-disable-next-line react-doctor/no-danger, react-doctor/dangerous-html-sink
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: stringifyJsonForHtmlScript(data) }}
    />
  );
}

function stringifyJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (char) => JSON_SCRIPT_ESCAPES[char] ?? char);
}
