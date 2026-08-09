# Encryption Key Custody Runbook

**Closes exception E-9** (Information Security Policy §14) and Business Continuity Plan §3.4.

| | |
|---|---|
| **Owner** | Kentesha Ward, Founder |
| **Created** | 2026-08-08 |
| **Verification cadence** | Annual, and after any key rotation |
| **Last verified** | **2026-08-08** — Bitwarden copy verified against production, fingerprints matched |
| **Next verification due** | 2027-08-08 |
| **Status** | **Complete 2026-08-09.** Four copies: live, Bitwarden, Deputy share, sealed physical. Custody requirements in §2 are met. |

---

## 1. Why this exists

`ENCRYPTION_KEY` is the master key for all application-layer encryption (`packages/backend/src/utils/crypto.ts`). It protects SSNs, tax IDs, dates of birth for practice owners, bank routing and account numbers, DEA and CDS registration numbers, and payer portal credentials. Per-tenant keys for portal credentials are derived from it via HKDF-SHA256, so they die with it.

**Exactly one production secret is irreplaceable.** This is it.

| Secret | If lost |
|---|---|
| `ENCRYPTION_KEY` | **Every encrypted field becomes permanently unreadable.** Database backups contain ciphertext and nothing to decrypt it with. Unrecoverable by any means. |
| `DATABASE_URL`, `DATABASE_URL_ADMIN` | Reissue from the provider |
| `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `LINEAR_API_KEY`, all other vendor keys | Mint a new one |
| `JWT_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET` | Rotate; existing sessions and links break, nothing is destroyed |
| `AGENT_SIGNING_PRIVATE_KEY` | Generate a new pair and publish the new public key |
| `COGNITO_*` | Reissue from AWS |

Every other value on that list is recoverable in minutes. Losing `ENCRYPTION_KEY` destroys data permanently, with backups intact and useless.

Before this runbook, the key existed in exactly one location: the Render environment configuration for `kay-backend`. Loss of that account meant permanent loss of every encrypted field.

---

## 2. Custody requirements

1. **Minimum two copies**, in locations that cannot fail together. The Render environment configuration is the live copy and does not count as one of the two.
2. **At least one copy offline** — a password manager vault or sealed physical record, not a file on a laptop and not cloud storage synced from a machine that holds production access.
3. **Never** in source control, chat, email, a ticket, a note-taking app, or an unencrypted file.
4. **Access is logged.** Whoever retrieves the key records when and why.
5. **The fingerprint is stored alongside every copy**, so a copy can be verified without being exposed.

---

## 3. Establishing the offline copy

### Step 1 — Record the fingerprint

Run locally. Prints a hash; the key is never displayed:

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/srv-d6212t7pm1nc73fjkdk0/env-vars?limit=100" | python3 -c "
import sys,json,hashlib
for e in json.load(sys.stdin):
    v=e['envVar']
    if v['key']=='ENCRYPTION_KEY':
        val=v['value']
        print('length     :',len(val),'chars')
        print('decoded    :',len(bytes.fromhex(val)),'bytes (must be 32)')
        print('fingerprint:',hashlib.sha256(val.encode()).hexdigest()[:16])
        break
else: print('NOT FOUND')"
```

Expect 64 characters, 32 bytes decoded. Anything else means something is wrong — stop and investigate before proceeding.

**Recorded fingerprint: `7c00d4ffd0d403fe`** (sha256, first 16 hex chars — established 2026-08-08, key length 64 chars / 32 bytes).

Any future verification must produce exactly this value. A different value means either the key was rotated (update this record) or a stored copy is wrong (fix the copy).

The fingerprint is safe to write down. It is a one-way hash and truncated; it cannot be reversed to the key.

### Step 2 — Copy the key into Bitwarden

Render dashboard → `kay-backend` → Environment → reveal `ENCRYPTION_KEY` → copy.

In Bitwarden, create a new **Secure Note**:

| Field | Value |
|---|---|
| Name | `Lanyard PRODUCTION Master Encryption Key — DO NOT DELETE` |
| Custom field | Type **Hidden**, name `ENCRYPTION_KEY`, value = the key |
| Notes | Fingerprint from Step 1 · date established · `Losing this permanently destroys all encrypted provider data. Database backups contain ciphertext and do not help.` |

Use a **Hidden** custom field rather than the plain notes body — hidden fields are masked in the UI and have a copy button, so the key is not exposed on screen every time the item is opened.

Use the dashboard and the Bitwarden UI, not a terminal. The key should not land on disk in plaintext or enter shell history.

### Step 3 — Verify the copy

Paste from the password manager when prompted. `read -rs` does not echo and does not write to shell history:

```bash
printf 'Paste stored key: '; read -rs K; echo; \
printf '%s' "$K" | shasum -a 256 | cut -c1-16; unset K
```

The output must match the Step 1 fingerprint exactly. **If it does not match, the stored copy is wrong** — delete it and repeat Step 2. An incorrect offline copy is worse than none, because it produces false confidence.

### Step 4 — Second holder: share with the Deputy

Bitwarden's **free plan includes a two-user organization** with up to two collections — exactly Kay plus John Mayes, at no cost.

1. Bitwarden → New Organization (free tier).
2. Create a collection, e.g. `Lanyard Break-Glass`.
3. Invite John Mayes; he accepts and is confirmed.
4. Move the Secure Note from Step 2 into that collection.

This closes the second half of Business Continuity Plan §3.6: extended founder unavailability no longer means nobody can decrypt or restore.

**Optional — Emergency Access (Bitwarden Premium, ~$10/year).** Designates a trusted contact who can request vault access; if the grantor does not respond within a configured waiting period, access auto-approves. Two modes: **View** (read-only) and **Takeover** (contact sets a new master password, which removes the grantor's two-step login). **View is the correct mode here** — Takeover locks the Founder out of their own vault. The trusted contact may hold a free account.

Emergency Access covers the case the shared collection does not: the Founder becoming unreachable without having pre-shared everything.

### Step 4b — Independent second copy

**A shared Bitwarden collection is a second _holder_, not an independent second _copy_.** Both copies live in Bitwarden. A Bitwarden account lockout, a forgotten master password, or a Bitwarden-side failure takes both simultaneously — which is the exact failure mode this runbook exists to prevent.

At least one copy must sit outside Bitwarden entirely:

- **Sealed physical record.** Printed, sealed in a tamper-evident envelope, stored in a safe or bank deposit box. Immune to every digital failure mode. Recommended.
- **Encrypted offline medium.** A USB drive in a physically separate location.

Record locations here:

| Copy | Location | Established | Verified |
|---|---|---|---|
| Live | Render `kay-backend` environment configuration | — | 2026-08-08 — fingerprint `7c00d4ffd0d403fe` |
| Bitwarden | Personal vault, Secure Note (hidden custom field) | 2026-08-08 | 2026-08-08 — fingerprint matched |
| Deputy share | Bitwarden collection shared with John Mayes, Director of Operations | 2026-08-09 (Kay confirmed) | Inherits the Bitwarden verification — same item |
| Independent | Sealed physical record, outside Bitwarden | 2026-08-09 (Kay confirmed) | **Not independently verified** — see note below |

**On the physical copy.** If it was printed directly from the stored value, transcription error is not a realistic risk and the fingerprint carries over. If any part was written by hand, verify it before relying on it: type it back and hash it (Step 3). An incorrect sealed copy is the precise failure this runbook exists to prevent — it produces confidence without protection, and the error surfaces only on the day it is needed.

The two `Kay confirmed` entries above are recorded on the Founder's statement, not on independent verification. They are re-confirmed at the annual check (§4), which is when an auditor would expect the evidence to be exercised rather than asserted.

### Step 5 — Record completion

Update the header of this document with the verification date and record the same in the SOC 2 evidence file. This is the artifact that closes E-9.

---

## 4. Annual verification

Once a year, and after every rotation:

1. Re-run Step 1 against production to get the current fingerprint.
2. Re-run Step 3 against each stored copy.
3. Confirm every fingerprint matches.
4. Confirm the Deputy can still reach their copy.
5. Update the Last verified date.

A copy that has never been verified is a copy you are guessing about. Silent drift after a rotation is the realistic failure mode: the key is rotated, the offline copy is not updated, and nobody notices until the day it matters.

---

## 5. Retrieval

Retrieving the key from offline storage is justified only for:

- Restoring a lost or corrupted production environment configuration
- Executing a rotation (Information Security Policy §5.3)
- Emergency decryption during incident response

Record who retrieved it, when, and why. After use, confirm the key is not left in a terminal buffer, a file, or a clipboard.

Routine access to encrypted data does **not** require the key — the application handles decryption. Anyone asking for the key for routine work is asking for the wrong thing.

---

## 6. Rotation interaction

Every rotation invalidates every offline copy. Rotation is not complete until all copies are replaced and re-verified.

Note that the rotation procedure in Information Security Policy §5.3 is not yet implemented (exception E-11) — a rotation today would require an outage. That constraint does not affect this runbook, which addresses custody rather than rotation.

---

## 7. What this does not fix

- The key still lives in Render's environment configuration in production, and Render account compromise still exposes it. Custody addresses **loss**, not **theft**. Theft is addressed by MFA on the provider account and by rotation.
- Uploaded documents in object storage remain unbacked (exception E-10). Separate fix.
