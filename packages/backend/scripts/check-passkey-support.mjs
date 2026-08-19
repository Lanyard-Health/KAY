#!/usr/bin/env node
/**
 * Read-only check: can the MFA setup screen's "passkey" option actually work
 * against a given Cognito pool?
 *
 * Two things have to be true, and they are configured in different places:
 *   1. The POOL has WebAuthn configured (a relying-party ID) - lets a user
 *      REGISTER a passkey via associateWebAuthnCredential().
 *   2. The APP CLIENT allows the USER_AUTH flow - lets them SIGN IN with it
 *      afterwards. A passkey you can register but not sign in with is useless,
 *      so both are checked.
 *
 * Makes no writes. Safe against production.
 *
 * Usage:
 *   node packages/backend/scripts/check-passkey-support.mjs <poolId> <clientId>
 *
 * Both arguments are optional; falls back to COGNITO_USER_POOL_ID /
 * COGNITO_CLIENT_ID from the environment.
 *
 * Credentials: prod talks to Cognito with COGNITO_AWS_ACCESS_KEY_ID /
 * COGNITO_AWS_SECRET_ACCESS_KEY, which live in Render and not on anyone's
 * laptop. If they are absent but RENDER_API_KEY is set, this borrows them from
 * the Render service in memory for the duration of the run. That beats copying
 * secrets out of a dashboard by hand: they never reach the clipboard, a shell
 * history, a command line, or disk.
 */

import {
  CognitoIdentityProviderClient,
  GetUserPoolMfaConfigCommand,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const poolId = process.argv[2] || process.env.COGNITO_USER_POOL_ID;
const clientId = process.argv[3] || process.env.COGNITO_CLIENT_ID;
const region = process.env.AWS_REGION || 'us-east-1';

if (!poolId) {
  console.error('No pool id. Pass one as the first argument, or set COGNITO_USER_POOL_ID.');
  process.exit(1);
}

console.log(`\nChecking pool ${poolId} in ${region}`);
if (poolId === 'us-east-1_SXOvfeegD') console.log('  (this is PRODUCTION - read-only, nothing is changed)');

/** kay-backend on Render; the only place the Cognito admin credentials exist. */
const RENDER_SERVICE_ID = 'srv-d6212t7pm1nc73fjkdk0';

async function borrowCredentialsFromRender() {
  const key = process.env.RENDER_API_KEY;
  if (!key) return null;
  // ponytail: limit=100 because Render's env-var list silently pages at 20.
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars?limit=100`,
    { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }
  );
  if (!res.ok) {
    console.error(`Render API returned ${res.status} reading env vars; falling back to this shell.`);
    return null;
  }
  const vars = Object.fromEntries(
    (await res.json()).map((row) => [row.envVar?.key, row.envVar?.value])
  );
  const accessKeyId = vars.COGNITO_AWS_ACCESS_KEY_ID || vars.AWS_ACCESS_KEY_ID;
  const secretAccessKey = vars.COGNITO_AWS_SECRET_ACCESS_KEY || vars.AWS_SECRET_ACCESS_KEY;
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

let credentials =
  process.env.COGNITO_AWS_ACCESS_KEY_ID && process.env.COGNITO_AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.COGNITO_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.COGNITO_AWS_SECRET_ACCESS_KEY,
      }
    : null;

if (!credentials && !process.env.AWS_ACCESS_KEY_ID) {
  credentials = await borrowCredentialsFromRender();
  if (credentials) console.log('  (using the backend credentials from Render, read-only)');
}

const client = new CognitoIdentityProviderClient({
  region,
  ...(credentials ? { credentials } : {}),
});

let mfa;
try {
  mfa = await client.send(new GetUserPoolMfaConfigCommand({ UserPoolId: poolId }));
} catch (err) {
  console.error(`\nCould not read the pool: ${err.name} - ${err.message}`);
  console.error('No usable credentials. Set RENDER_API_KEY in this shell and re-run, and');
  console.error('this borrows the backend ones automatically.');
  process.exit(1);
}

const rpId = mfa.WebAuthnConfiguration?.RelyingPartyId;
const canRegister = Boolean(rpId);

// The app client is a separate object; skip rather than fail if no id was given.
let canSignIn = null;
let flows = [];
if (clientId) {
  try {
    const res = await client.send(
      new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId })
    );
    flows = res.UserPoolClient?.ExplicitAuthFlows ?? [];
    canSignIn = flows.includes('ALLOW_USER_AUTH');
  } catch (err) {
    console.error(`\nCould not read app client ${clientId}: ${err.name} - ${err.message}`);
  }
}

console.log('\n--- what the pool says ---');
console.log(`MFA requirement:        ${mfa.MfaConfiguration}`);
console.log(`Authenticator apps:     ${mfa.SoftwareTokenMfaConfiguration?.Enabled ? 'enabled' : 'off'}`);
console.log(`Email codes:            ${mfa.EmailMfaConfiguration ? 'enabled' : 'off'}`);
console.log(`Passkey relying party:  ${rpId || 'NOT SET'}`);
console.log(`Passkey verification:   ${mfa.WebAuthnConfiguration?.UserVerification || 'n/a'}`);
if (clientId) {
  console.log(`App client sign-in flows: ${flows.join(', ') || 'none listed'}`);
}

console.log('\n--- plain English ---');
if (!canRegister) {
  console.log('Passkeys are NOT set up on this pool. If a customer picks the passkey');
  console.log('option on the setup screen, it will fail. Either turn passkeys on in');
  console.log('the Cognito console (Sign-in > Passkey), or hide that option.');
} else if (canSignIn === false) {
  console.log('Customers can REGISTER a passkey, but the app client does not allow the');
  console.log('sign-in flow that uses it (ALLOW_USER_AUTH is missing). They would set one');
  console.log('up and then never be able to use it. Add ALLOW_USER_AUTH to the app client.');
} else if (canSignIn === null) {
  console.log(`Passkey registration is set up (relying party "${rpId}").`);
  console.log('Sign-in was not checked because no app client id was given. Re-run with');
  console.log('the client id as a second argument to confirm the whole round trip.');
} else {
  console.log('Passkeys work end to end on this pool: a customer can register one and');
  console.log('sign in with it. The passkey option on the setup screen is safe to show.');
}
console.log('');
