import hashes from '@/lib/legal-archive/hashes.json';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

export function legalDocumentHashes() {
  const termsContentHash = (hashes.terms as Record<string, string>)[TERMS_VERSION];
  const privacyContentHash = (hashes.privacy as Record<string, string>)[PRIVACY_VERSION];
  if (!termsContentHash || !privacyContentHash) {
    throw new Error('Current legal texts are missing from the legal archive');
  }
  return { termsContentHash, privacyContentHash };
}
