/**
 * Generate a fresh Ed25519 keypair for AgentEvent signing.
 *
 * Usage:
 *   npx tsx packages/backend/scripts/generate-signing-key.ts
 *
 * Emits PEM-formatted private + public keys plus a fresh keyId. Update env vars:
 *   AGENT_SIGNING_PRIVATE_KEY=<private PEM, with literal newlines>
 *   AGENT_SIGNING_PUBLIC_KEY=<public PEM>
 *   AGENT_SIGNING_KEY_ID=<keyId from output>
 *
 * Rotation procedure: when generating a replacement keypair, move the OLD
 * entry into AGENT_SIGNING_RETIRED_KEYS as JSON
 *   [{ "keyId": "<old>", "publicKey": "<old PEM>", "retiredAt": "<ISO8601>" }, ...]
 * so /.well-known/lanyard-signing-keys.json continues to expose it and external
 * verifiers can still verify historical signatures.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const keyId = `ed25519-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

console.log('=== Lanyard agent signing keypair ===');
console.log(`AGENT_SIGNING_KEY_ID=${keyId}`);
console.log('');
console.log('AGENT_SIGNING_PRIVATE_KEY=');
console.log(privatePem);
console.log('AGENT_SIGNING_PUBLIC_KEY=');
console.log(publicPem);
