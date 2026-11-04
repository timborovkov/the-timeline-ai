import { permanentRedirect } from 'next/navigation';

export default function SecurityRedirectPage() {
  permanentRedirect('/trust');
}
