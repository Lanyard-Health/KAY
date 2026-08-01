import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DefactoService,
  DefactoApiError,
  DefactoNotConfiguredError,
  parseDefactoResponse,
} from './defacto.service.js';

// Field shapes mirror a CAPTURED live response (2026-07-31): numeric canon ids,
// *_canon_id relationship keys, referenced.* as ARRAYS, plans with carrier_name
// and short-code (often null) lob, org npi as a number.
const SAMPLE = {
  practitioners: [
    {
      npi: 1003016718,
      relationships: [
        {
          organization_canon_id: 101,
          location_canon_id: 201,
          plan_canon_ids: [301, 302],
          phone_numbers: ['4045551234'],
        },
        {
          organization_canon_id: 102,
          location_canon_id: null,
          plan_canon_ids: [301],
        },
        // relationship without plans produces no rows
        { organization_canon_id: 101, location_canon_id: 201, plan_canon_ids: [] },
      ],
    },
  ],
  referenced: {
    organizations: [
      { canon_id: 101, npi: 1902758505, name: 'Sunrise Counseling Group', organization_type: 'group' },
      { canon_id: 102, npi: null, name: 'Peachtree Behavioral' },
    ],
    locations: [
      { canon_id: 201, address_line: '1 Main St', city: 'Atlanta', state: 'GA', zipcode: '30303' },
    ],
    insurance_plans: [
      { canon_id: 301, carrier_id: 1, carrier_name: 'Aetna', name: 'Aetna Choice POS II', lob: 'commppo' },
      { canon_id: 302, carrier_id: 2, carrier_name: 'Humana', name: 'Humana Gold Plus', lob: null },
    ],
  },
};

describe('parseDefactoResponse', () => {
  it('emits one row per (plan × relationship) with IDs resolved', () => {
    const rows = parseDefactoResponse(SAMPLE as never);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      carrierName: 'Aetna',
      carrierOrPlanName: 'Aetna Choice POS II',
      lob: 'commppo',
      organizationName: 'Sunrise Counseling Group',
      organizationNpi: '1902758505',
      locationCity: 'Atlanta',
      locationState: 'GA',
    });
    expect(rows[1]!.carrierOrPlanName).toBe('Humana Gold Plus');
    expect(rows[1]!.lob).toBeNull();
    // second relationship: no location, org without npi
    expect(rows[2]).toEqual({
      carrierName: 'Aetna',
      carrierOrPlanName: 'Aetna Choice POS II',
      lob: 'commppo',
      organizationName: 'Peachtree Behavioral',
      organizationNpi: null,
      locationCity: null,
      locationState: null,
    });
  });

  it('handles referenced groups keyed by canon_id (docs shape) too', () => {
    const keyedForm = {
      ...SAMPLE,
      referenced: {
        organizations: Object.fromEntries(SAMPLE.referenced.organizations.map((o) => [String(o.canon_id), o])),
        locations: Object.fromEntries(SAMPLE.referenced.locations.map((l) => [String(l.canon_id), l])),
        insurance_plans: Object.fromEntries(SAMPLE.referenced.insurance_plans.map((p) => [String(p.canon_id), p])),
      },
    };
    const rows = parseDefactoResponse(keyedForm as never);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.organizationName).toBe('Sunrise Counseling Group');
  });

  it('falls back to "Unknown plan" for unresolvable plan ids', () => {
    const rows = parseDefactoResponse({
      practitioners: [{ relationships: [{ plan_canon_ids: [999] }] }],
      referenced: {},
    } as never);
    expect(rows).toEqual([
      {
        carrierName: null,
        carrierOrPlanName: 'Unknown plan',
        lob: null,
        organizationName: null,
        organizationNpi: null,
        locationCity: null,
        locationState: null,
      },
    ]);
  });
});

describe('DefactoService.lookupByNpi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env['DEFACTO_API_KEY'] = 'test-key';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env['DEFACTO_API_KEY'];
  });

  const jsonResponse = (status: number, body?: unknown, headers?: Record<string, string>) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

  it('throws DefactoNotConfiguredError without a key (no request made)', async () => {
    delete process.env['DEFACTO_API_KEY'];
    await expect(new DefactoService().lookupByNpi('1003016718')).rejects.toBeInstanceOf(
      DefactoNotConfiguredError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the x-api-key header and include params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, SAMPLE));
    await new DefactoService().lookupByNpi('1003016718');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://insurances.defacto.health/api/v2/practitioners/relations/1003016718?include=organizations,locations,insurance_plans'
    );
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'test-key' });
  });

  it('returns found with parsed rows on a valid 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, SAMPLE));
    const result = await new DefactoService().lookupByNpi('1003016718');
    expect(result.status).toBe('found');
    expect(result.planRows).toHaveLength(3);
    expect(result.rawResponse).toEqual(SAMPLE);
  });

  it('treats 404 as a normal not_found outcome without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: 'not found' }));
    const result = await new DefactoService().lookupByNpi('1999999999');
    expect(result).toEqual({ status: 'not_found', rawResponse: null, planRows: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an empty practitioners array as not_found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { practitioners: [], referenced: {} }));
    const result = await new DefactoService().lookupByNpi('1999999999');
    expect(result.status).toBe('not_found');
  });

  it.each([401, 403])('does not retry a %i bad key and says so plainly', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { detail: 'bad key' }));
    await expect(new DefactoService().lookupByNpi('1003016718')).rejects.toMatchObject({
      name: 'DefactoApiError',
      status,
      message: 'Defacto rejected our API key — check DEFACTO_API_KEY.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with backoff then gives up gracefully', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(429, { detail: 'slow down' }, { 'retry-after': '1' }));
    const promise = new DefactoService().lookupByNpi('1003016718');
    const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries 5xx then reports Defacto as unavailable', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(503, { detail: 'down' }));
    const promise = new DefactoService().lookupByNpi('1003016718');
    const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a 200 whose body does not match the documented structure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { unexpected: true }));
    await expect(new DefactoService().lookupByNpi('1003016718')).rejects.toBeInstanceOf(
      DefactoApiError
    );
  });
});
