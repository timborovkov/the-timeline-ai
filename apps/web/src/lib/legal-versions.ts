export const TERMS_VERSION = '2026-06-02';
export const PRIVACY_VERSION = '2026-06-02';

export const LEGAL_EFFECTIVE_DATE = 'June 2, 2026';
export const LEGAL_PROVIDER = 'Nyxone OÜ';
export const LEGAL_SERVICE_URL = 'https://thetimeline.cc';
export const LEGAL_ADDRESS =
  'Harju maakond, Tallinn, Kesklinna linnaosa, Narva mnt 5, 10117, Estonia';

export function getLegalContactEmail(): string | null {
  const email = process.env.SUPPORT_EMAIL?.trim();
  return email === '' ? null : (email ?? null);
}
