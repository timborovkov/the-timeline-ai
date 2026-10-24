export {
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@timeline/shared/legal-versions';

export const LEGAL_PROVIDER = 'Nyxone OÜ';
export const LEGAL_REGISTRY_CODE = '16172329';
export const LEGAL_SERVICE_URL = 'https://thetimeline.cc';
export const LEGAL_ADDRESS =
  'Harju maakond, Tallinn, Kesklinna linnaosa, Narva mnt 5, 10117, Estonia';

export function getLegalContactEmail(): string {
  const email = process.env.SUPPORT_EMAIL?.trim();
  return email === '' ? 'contact@thetimeline.cc' : (email ?? 'contact@thetimeline.cc');
}
