import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerGetProviderProfile(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_provider_profile',
    'Get full provider profile including licenses, board certifications, education, work history, and hospital affiliations.',
    {
      providerId: z.string().uuid().describe('The provider ID'),
    },
    async ({ providerId }) => {
      const provider = await prisma.providerProfile.findFirst({
        where: {
          id: providerId,
          ...getPracticeProviderFilter(ctx),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          middleName: true,
          suffix: true,
          npi: true,
          providerType: true,
          status: true,
          email: true,
          phone: true,
          mobilePhone: true,
          fax: true,
          taxonomy: true,
          specialties: true,
          languages: true,
          gender: true,
          dateOfBirth: true,
          caqhProviderId: true,
          caqhStatus: true,
          createdAt: true,
          updatedAt: true,
          licenses: {
            select: {
              id: true,
              licenseType: true,
              licenseNumber: true,
              state: true,
              issueDate: true,
              expirationDate: true,
              status: true,
              verificationDate: true,
              notes: true,
            },
            orderBy: { expirationDate: 'asc' },
          },
          boardCertifications: {
            select: {
              id: true,
              boardType: true,
              boardName: true,
              certificationNumber: true,
              specialty: true,
              initialCertificationDate: true,
              expirationDate: true,
              status: true,
              isBoardEligible: true,
              notes: true,
            },
            orderBy: { expirationDate: 'asc' },
          },
          educations: {
            select: {
              id: true,
              institutionName: true,
              degree: true,
              fieldOfStudy: true,
              city: true,
              state: true,
              graduationDate: true,
              isCompleted: true,
            },
            orderBy: { graduationDate: 'desc' },
          },
          workHistories: {
            select: {
              id: true,
              organizationName: true,
              position: true,
              startDate: true,
              endDate: true,
              isCurrent: true,
              city: true,
              state: true,
            },
            orderBy: { startDate: 'desc' },
          },
          hospitalAffiliations: {
            select: {
              id: true,
              facilityName: true,
              facilityType: true,
              privilegeType: true,
              status: true,
              appointmentDate: true,
              reappointmentDate: true,
              city: true,
              state: true,
            },
          },
          malpracticeInsurances: {
            select: {
              id: true,
              carrierName: true,
              policyNumber: true,
              coverageType: true,
              perClaimAmount: true,
              aggregateAmount: true,
              effectiveDate: true,
              expirationDate: true,
              status: true,
            },
          },
        },
      });

      if (!provider) {
        return {
          content: [{ type: 'text' as const, text: 'Provider not found or access denied.' }],
        };
      }

      const formatDate = (d: Date | null | undefined) => d?.toISOString().split('T')[0] ?? null;

      const result = {
        id: provider.id,
        name: [provider.firstName, provider.middleName, provider.lastName, provider.suffix]
          .filter(Boolean).join(' '),
        npi: provider.npi,
        type: provider.providerType,
        status: provider.status,
        gender: provider.gender,
        dateOfBirth: formatDate(provider.dateOfBirth),
        contact: {
          email: provider.email,
          phone: provider.phone,
          mobilePhone: provider.mobilePhone,
          fax: provider.fax,
        },
        taxonomy: provider.taxonomy,
        specialties: provider.specialties,
        languages: provider.languages,
        caqh: {
          providerId: provider.caqhProviderId,
          status: provider.caqhStatus,
        },
        licenses: provider.licenses.map((l) => ({
          id: l.id,
          type: l.licenseType,
          number: l.licenseNumber,
          state: l.state,
          issueDate: formatDate(l.issueDate),
          expirationDate: formatDate(l.expirationDate),
          status: l.status,
          verificationDate: formatDate(l.verificationDate),
          notes: l.notes,
        })),
        boardCertifications: provider.boardCertifications.map((b) => ({
          id: b.id,
          boardType: b.boardType,
          boardName: b.boardName,
          certificationNumber: b.certificationNumber,
          specialty: b.specialty,
          initialCertificationDate: formatDate(b.initialCertificationDate),
          expirationDate: formatDate(b.expirationDate),
          status: b.status,
          isBoardEligible: b.isBoardEligible,
          notes: b.notes,
        })),
        education: provider.educations.map((e) => ({
          id: e.id,
          institution: e.institutionName,
          degree: e.degree,
          fieldOfStudy: e.fieldOfStudy,
          location: [e.city, e.state].filter(Boolean).join(', '),
          graduationDate: formatDate(e.graduationDate),
          completed: e.isCompleted,
        })),
        workHistory: provider.workHistories.map((w) => ({
          id: w.id,
          organization: w.organizationName,
          position: w.position,
          location: [w.city, w.state].filter(Boolean).join(', '),
          startDate: formatDate(w.startDate),
          endDate: formatDate(w.endDate),
          isCurrent: w.isCurrent,
        })),
        hospitalAffiliations: provider.hospitalAffiliations.map((h) => ({
          id: h.id,
          facility: h.facilityName,
          type: h.facilityType,
          privilegeType: h.privilegeType,
          status: h.status,
          appointmentDate: formatDate(h.appointmentDate),
          reappointmentDate: formatDate(h.reappointmentDate),
          location: [h.city, h.state].filter(Boolean).join(', '),
        })),
        malpracticeInsurance: provider.malpracticeInsurances.map((m) => ({
          id: m.id,
          carrier: m.carrierName,
          policyNumber: m.policyNumber,
          coverageType: m.coverageType,
          perClaimAmount: Number(m.perClaimAmount),
          aggregateAmount: Number(m.aggregateAmount),
          effectiveDate: formatDate(m.effectiveDate),
          expirationDate: formatDate(m.expirationDate),
          status: m.status,
        })),
        createdAt: provider.createdAt.toISOString(),
        updatedAt: provider.updatedAt.toISOString(),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
