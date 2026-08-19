#!/usr/bin/env node
/**
 * Read-only: why did (or didn't) Cognito challenge this user for a code?
 *
 * Registering an authenticator and being ASKED for it at sign-in are two
 * different pieces of state, set by two different API calls:
 *   - VerifySoftwareToken   registers the token   (Amplify: verifyTOTPSetup)
 *   - SetUserMFAPreference  makes it required     (Amplify: updateMFAPreference)
 *
 * With the pool at MfaConfiguration=OPTIONAL, a user who has done the first but
 * not the second is enrolled on paper and never challenged in practice. That is
 * the gap this reports: PreferredMfaSetting is the field that decides it.
 *
 * A remembered device is the other way a challenge legitimately disappears, so
 * the pool's DeviceConfiguration is printed alongside; without it you cannot
 * tell a missing preference from a device Cognito chose to trust.
 *
 * The pool's email settings are printed too, because the enrollment screen
 * offers "Email me a code" and Cognito will not deliver one from a pool on its
 * built-in sender. That option enrolls a user the moment they pick it, so a
 * pool without SES turns the fallback into a lockout.
 *
 * Usage:
 *   RENDER_SERVICE_ID=srv-d8fn3628qa3s73afc9q0 \
 *     node packages/backend/scripts/check-user-mfa.mjs <email> [poolId]
 *
 * Makes no writes of any kind, so it is safe against production.
 */

import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  DescribeUserPoolCommand,
  GetUserPoolMfaConfigCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const POOLS = { 'us-east-1_SXOvfeegD': 'PRODUCTION', 'us-east-1_3niv16hsO': 'staging' };

const email = process.argv[2];
let poolId = process.argv[3] || process.env.COGNITO_USER_POOL_ID;
const region = process.env.AWS_REGION || 'us-east-1';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d6212t7pm1nc73fjkdk0';

if (!email) {
  console.error('Usage: node packages/backend/scripts/check-user-mfa.mjs <email> [poolId]');
  process.exit(1);
}

async function borrowFromRender() {
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
  return {
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null,
    poolId: vars.COGNITO_USER_POOL_ID,
  };
}

let credentials =
  process.env.COGNITO_AWS_ACCESS_KEY_ID && process.env.COGNITO_AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.COGNITO_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.COGNITO_AWS_SECRET_ACCESS_KEY,
      }
    : null;

if (!credentials && !process.env.AWS_ACCESS_KEY_ID) {
  const borrowed = await borrowFromRender();
  if (borrowed) {
    credentials = borrowed.credentials;
    poolId ||= borrowed.poolId;
  }
}

if (!poolId) {
  console.error('No pool id. Pass one as the second argument, or set COGNITO_USER_POOL_ID.');
  process.exit(1);
}

const client = new CognitoIdentityProviderClient(credentials ? { region, credentials } : { region });

console.log(`\nPool:  ${poolId}  (${POOLS[poolId] ?? 'unrecognised'})`);
console.log(`User:  ${email}\n`);

// The pool questions are answerable without the user, and the pool answers are
// often the ones that matter, so a missing user must not take the run down with
// it: a pool where email codes are impossible is worth knowing about whether or
// not the address you happened to type exists in it.
const [user, pool, mfaConfig] = await Promise.all([
  client
    .send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }))
    .catch((err) => {
      if (err.name === 'UserNotFoundException') return null;
      throw err;
    }),
  client.send(new DescribeUserPoolCommand({ UserPoolId: poolId })),
  client.send(new GetUserPoolMfaConfigCommand({ UserPoolId: poolId })),
]);

const registered = user?.UserMFASettingList ?? [];
const preferred = user?.PreferredMfaSetting ?? null;
const devices = pool.UserPool?.DeviceConfiguration;

console.log(`Account status:      ${user ? user.UserStatus : 'NO SUCH USER in this pool'}`);
console.log(`Pool MFA setting:    ${mfaConfig.MfaConfiguration}`);
console.log(`Registered methods:  ${registered.length ? registered.join(', ') : 'NONE'}`);
console.log(`Preferred method:    ${preferred ?? 'NOT SET'}`);
// Email codes are the fallback for anyone without an authenticator app, and
// Cognito refuses to enable them unless the pool sends through SES. A pool on
// COGNITO_DEFAULT cannot deliver a second factor by email, whatever the
// enrollment screen offers.
const emailCfg = pool.UserPool?.EmailConfiguration;
console.log(`Email MFA allowed:   ${mfaConfig.EmailMfaConfiguration ? 'yes' : 'NO'}`);
console.log(
  `Email sender:        ${emailCfg?.EmailSendingAccount ?? 'COGNITO_DEFAULT'}${
    emailCfg?.From ? ` (from ${emailCfg.From})` : ''
  }`
);
console.log(
  `Remembered devices:  ${
    devices
      ? `on (challenge required on new device: ${devices.DeviceOnlyRememberedOnUserPrompt ? 'user prompted' : 'always remembered'})`
      : 'off'
  }\n`
);

// The verdict is the whole point of the script; spelling it out beats leaving
// six fields on screen for someone to cross-reference by hand.
if (!user) {
  console.log(
    'VERDICT: pool details above are good; the user half was skipped.\n' +
      '  No account with that address in this pool. Pools do not share users, so\n' +
      '  an address that works in one is absent from the other.'
  );
} else if (!registered.length) {
  console.log('VERDICT: not enrolled. No authenticator is registered against this account.');
} else if (!preferred) {
  console.log(
    'VERDICT: registered but NOT enforced.\n' +
      '  The authenticator exists, but no preferred method is set, so Cognito has\n' +
      '  nothing to insist on and signs the user straight in. The enrollment flow\n' +
      '  needs updateMFAPreference() after verifyTOTPSetup().'
  );
} else if (devices) {
  console.log(
    `VERDICT: enforced (${preferred}).\n` +
      '  Device remembering is ON for this pool, so a trusted device can still skip\n' +
      '  the code legitimately. Test in a private window to see the real challenge.'
  );
} else {
  console.log(
    `VERDICT: enforced (${preferred}).\n` +
      '  Device remembering is off, so every sign-in should ask for a code.\n' +
      '  If one did not, that is a genuine bug.'
  );
}
console.log();
