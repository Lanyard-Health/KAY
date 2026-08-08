# Lanyard Partner API

Read-only access to your practice's providers and enrollments.

Base URL: `https://kay-os62.onrender.com`
All paths below are relative to it.

---

## Authentication

Send your API key as a bearer token on every request:

```bash
curl -H "Authorization: Bearer lyd_live_xxxxxxxx..." \
  https://kay-os62.onrender.com/api/v1/partner/providers
```

Your key is scoped to a single practice. It cannot read any other practice's
data, and it cannot write anything — every non-GET request returns `403`.

Keys expire. You will be told the expiry date when the key is issued. Ask for a
replacement before then; there is no self-service rotation.

**If a key is exposed, tell us immediately.** Revocation takes effect on the
next request — there is no cache and no propagation delay.

---

## Endpoints

### `GET /api/v1/partner/providers`

```bash
curl -H "Authorization: Bearer $LANYARD_KEY" \
  "https://kay-os62.onrender.com/api/v1/partner/providers?page=1&pageSize=50"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "npi": "1234567890",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "middleName": null,
      "suffix": null,
      "providerType": "MD",
      "taxonomy": "207Q00000X",
      "specialties": ["Family Medicine"],
      "status": "active",
      "practiceId": "8c533a87-1bb6-4002-a924-412d793bdf0e",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-02T00:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 8
}
```

### `GET /api/v1/partner/providers/:id`

Returns a single provider in the same shape, as `data` (not an array).
Returns `404` if the provider does not exist **or** is not in your practice —
the two cases are deliberately indistinguishable.

### `GET /api/v1/partner/enrollments`

Payer enrollments for your practice. Draft enrollments are excluded.

```bash
curl -H "Authorization: Bearer $LANYARD_KEY" \
  "https://kay-os62.onrender.com/api/v1/partner/enrollments?page=1&pageSize=50"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "9c1e...",
      "status": "submitted",
      "subjectType": "PROVIDER",
      "providerId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "practiceId": "8c533a87-1bb6-4002-a924-412d793bdf0e",
      "payer": { "id": "…", "name": "Aetna", "payerId": "60054" },
      "productTypes": ["medical"],
      "applicationDate": "2026-02-01T00:00:00.000Z",
      "effectiveDate": null,
      "terminationDate": null,
      "providerNumber": "PN-1",
      "groupNumber": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-02-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 21
}
```

`subjectType` is `PROVIDER` or `PRACTICE`. Practice-level enrollments have
`providerId: null` — do not infer the subject from which id is null, use
`subjectType`.

### `GET /api/v1/partner/enrollments/:id`

Single enrollment, same shape, as `data`. `404` rules match providers.

---

## Pagination

`?page=` (default 1) and `?pageSize=` (default 20, **max 100**).

`pageSize` above 100 returns `400` rather than silently capping, so you always
know how much you actually asked for. Page through using `total`.

There is no cursor pagination. Results are ordered by last name (providers) and
most-recently-updated (enrollments).

---

## Rate limit

60 requests per minute, per key.

Exceeding it returns `429` with:
```json
{ "success": false, "error": { "message": "...", "code": "RATE_LIMITED" } }
```
Standard `RateLimit-*` response headers are included. Back off and retry.

---

## Errors

| Status | Meaning |
|---|---|
| `400` | Invalid query parameter (e.g. `pageSize` over 100) |
| `401` | Missing, malformed, expired, or revoked key |
| `403` | Non-GET request — the API is read-only |
| `404` | Not found, or not in your practice |
| `429` | Rate limited |

`401` is intentionally identical for every cause. It does not tell you whether a
key exists, has expired, or was revoked. If you are getting `401` and expect not
to, contact us rather than probing.

Error bodies are always:
```json
{ "success": false, "error": { "message": "...", "code": "..." } }
```

---

## What this API does not return

By design, and this will not change on request:

- Dates of birth, SSNs, tax IDs
- License, DEA, or CDS numbers
- Disciplinary actions or malpractice detail
- Internal staff notes on enrollments
- Documents or their contents
- Any data belonging to another practice

Field additions are contract changes and will be communicated before they ship.
Treat unknown fields as additive — do not fail on them.

---

## Support

Contact your Lanyard representative for a new key, revocation, expiry
extension, or to request additional fields.
