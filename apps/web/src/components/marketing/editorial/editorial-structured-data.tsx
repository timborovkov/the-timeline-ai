import { stringifyJsonLdForHtml } from '@/lib/public-site/structured-data';

export function EditorialStructuredData({ data }: { data: unknown }) {
  return (
    // react-doctor-disable-next-line react-doctor/no-danger, react-doctor/dangerous-html-sink
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: stringifyJsonLdForHtml(data) }}
    />
  );
}
