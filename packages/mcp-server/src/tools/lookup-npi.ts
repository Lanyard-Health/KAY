import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { logger } from '../logger.js';

interface NPIAPIResponse {
  result_count: number;
  results: Array<{
    number: string;
    enumeration_type: 'NPI-1' | 'NPI-2';
    basic: Record<string, string | undefined>;
    addresses: Array<{
      address_1: string;
      address_2?: string;
      address_purpose: string;
      city: string;
      state: string;
      postal_code: string;
      telephone_number?: string;
      fax_number?: string;
    }>;
    taxonomies?: Array<{
      code: string;
      desc: string;
      primary: boolean;
      license?: string;
      state?: string;
    }>;
  }>;
}

const NPI_API_BASE = 'https://npiregistry.cms.hhs.gov/api/';

export function registerLookupNpi(server: McpServer, _ctx: UserContext) {
  server.tool(
    'lookup_npi',
    'Query the CMS NPI Registry to look up a provider by NPI number or search by name. Returns provider details, taxonomy, and practice location.',
    {
      npi: z.string().optional().describe('10-digit NPI number for direct lookup'),
      firstName: z.string().optional().describe('Provider first name (for name search)'),
      lastName: z.string().optional().describe('Provider last name (for name search)'),
      state: z.string().optional().describe('Two-letter state code (for name search)'),
    },
    async ({ npi, firstName, lastName, state }) => {
      if (!npi && !firstName && !lastName) {
        return {
          content: [{ type: 'text' as const, text: 'Please provide an NPI number or at least a first or last name to search.' }],
        };
      }

      try {
        const params = new URLSearchParams({ version: '2.1' });

        if (npi) {
          if (!/^\d{10}$/.test(npi)) {
            return {
              content: [{ type: 'text' as const, text: 'Invalid NPI format. Must be exactly 10 digits.' }],
            };
          }
          params.append('number', npi);
        } else {
          if (firstName) params.append('first_name', firstName);
          if (lastName) params.append('last_name', lastName);
          if (state) params.append('state', state);
          params.append('enumeration_type', 'NPI-1');
        }

        const url = `${NPI_API_BASE}?${params.toString()}`;
        logger.info(`NPI lookup: ${npi ?? `${firstName ?? ''} ${lastName ?? ''}`}`);

        const response = await fetch(url);
        if (!response.ok) {
          return {
            content: [{ type: 'text' as const, text: `NPI Registry API returned status ${String(response.status)}` }],
          };
        }

        const data = await response.json() as NPIAPIResponse;

        if (data.result_count === 0 || !data.results?.length) {
          return {
            content: [{ type: 'text' as const, text: 'No results found in the NPI Registry.' }],
          };
        }

        const formatZip = (zip: string) => {
          if (!zip) return '';
          return zip.length === 9 ? zip.substring(0, 5) : zip.replace(/-.*/, '');
        };

        const results = data.results.slice(0, 10).map((r) => {
          const isIndividual = r.enumeration_type === 'NPI-1';
          const practiceAddr = r.addresses.find((a) => a.address_purpose === 'LOCATION');
          const primaryTax = r.taxonomies?.find((t) => t.primary);

          return {
            npi: r.number,
            entityType: isIndividual ? 'individual' : 'organization',
            ...(isIndividual
              ? {
                  firstName: r.basic['first_name'],
                  lastName: r.basic['last_name'],
                  credential: r.basic['credential'],
                  gender: r.basic['sex'] === 'M' ? 'male' : r.basic['sex'] === 'F' ? 'female' : undefined,
                }
              : {
                  organizationName: r.basic['organization_name'],
                }),
            status: r.basic['status'] === 'A' ? 'Active' : 'Inactive',
            primaryTaxonomy: primaryTax
              ? { code: primaryTax.code, description: primaryTax.desc, license: primaryTax.license, state: primaryTax.state }
              : null,
            practiceLocation: practiceAddr
              ? {
                  address: practiceAddr.address_1,
                  city: practiceAddr.city,
                  state: practiceAddr.state,
                  zip: formatZip(practiceAddr.postal_code),
                  phone: practiceAddr.telephone_number,
                }
              : null,
          };
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        logger.error('NPI lookup failed', { error: String(error) });
        return {
          content: [{ type: 'text' as const, text: `NPI lookup failed: ${String(error)}` }],
        };
      }
    },
  );
}
