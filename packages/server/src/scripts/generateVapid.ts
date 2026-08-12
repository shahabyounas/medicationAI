import webpush from 'web-push';

/**
 * Generate a VAPID keypair.
 *
 * Run once per deployment: `npm run vapid`, then paste the output into `.env`.
 * Changing the keys invalidates every existing subscription, because the
 * browser bound them to the old public key — so keep the pair once you have it.
 */
const keys = webpush.generateVAPIDKeys();

console.log(`
Add these to your .env file:

VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:you@example.com

Keep the private key out of version control. Rotating the pair unsubscribes
every device that is already registered.
`);
