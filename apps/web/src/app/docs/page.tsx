import { permanentRedirect } from 'next/navigation';

export default function DocsRedirectPage() {
  permanentRedirect('/help');
}
