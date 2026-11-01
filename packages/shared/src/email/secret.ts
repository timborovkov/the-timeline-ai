import { Webhook } from 'svix';

/** Verify the untouched body, signature, delivery id and timestamp before parsing. */
export function verifyResendWebhook(body: string, headers: Headers, secret: string): unknown {
  new Webhook(secret).verify(body, {
    'svix-id': headers.get('svix-id') ?? '',
    'svix-timestamp': headers.get('svix-timestamp') ?? '',
    'svix-signature': headers.get('svix-signature') ?? '',
  });
  return JSON.parse(body) as unknown;
}
