/**
 * Production legal publication is fail-closed until the operator approves
 * the legal text for publication.
 * Non-production environments keep the clickwrap flow available for review
 * and automated tests.
 */
export function isLegalPublicationReady(
  env: { NODE_ENV?: string; LEGAL_PUBLICATION_READY?: string } = process.env,
): boolean {
  return env.NODE_ENV !== 'production' || env.LEGAL_PUBLICATION_READY === 'true';
}
