import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { encryptSafe } from '../utils/crypto.js';
import { invalidateCache } from '../utils/cache.js';

const router = Router();

const onboardSchema = z.object({
  // Step 1: Basic Info
  npi: z.string().regex(/^\d{10}$/),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  middleName: z.string().max(100).optional(),
  suffix: z.string().max(20).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  providerType: z.string().min(1),

  // Step 2: Locations
  locations: z.array(z.object({
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().length(2),
    zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
    phone: z.string().optional(),
    isTelehealth: z.boolean().optional(),
  })).optional(),

  // Step 3: Education
  education: z.array(z.object({
    schoolName: z.string().min(1),
    degreeType: z.string().min(1),
    educationType: z.string().optional(),
    fieldOfStudy: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })).optional(),

  // Step 4: Licenses
  licenses: z.array(z.object({
    licenseType: z.string().min(1),
    licenseNumber: z.string().min(1),
    state: z.string().length(2),
    issueDate: z.string().optional(),
    expirationDate: z.string(),
  })).optional(),

  certifications: z.array(z.object({
    boardType: z.string().min(1),
    boardName: z.string().optional(),
    certificationNumber: z.string().optional(),
    specialty: z.string().optional(),
    initialCertificationDate: z.string().optional(),
    expirationDate: z.string().optional(),
  })).optional(),

  deaRegistrations: z.array(z.object({
    deaNumber: z.string().min(1),
    deaState: z.string().length(2).optional(),
    deaSchedules: z.array(z.string()).optional(),
    issueDate: z.string().optional(),
    expirationDate: z.string(),
  })).optional(),

  // Step 5: Insurance & Banking
  malpracticeInsurance: z.object({
    carrierName: z.string().min(1),
    policyNumber: z.string().min(1),
    coverageType: z.string().optional(),
    perClaimAmount: z.number().optional(),
    aggregateAmount: z.number().optional(),
    effectiveDate: z.string().optional(),
    expirationDate: z.string(),
  }).optional(),

  banking: z.object({
    bankName: z.string().min(1),
    routingNumber: z.string().regex(/^\d{9}$/),
    accountNumber: z.string().min(4).max(17),
    accountType: z.enum(['checking', 'savings']),
    accountHolderName: z.string().min(1),
  }).optional(),

  // Step 6: Work History
  workHistory: z.array(z.object({
    organizationName: z.string().min(1),
    organizationType: z.string().optional(),
    position: z.string().min(1),
    startDate: z.string(),
    endDate: z.string().optional(),
    isCurrent: z.boolean().optional(),
  })).optional(),

  // Step 7: Disclosures
  disclosures: z.array(z.object({
    category: z.string().min(1),
    questionText: z.string().min(1),
    answer: z.boolean(),
    explanation: z.string().optional(),
  })).optional(),

  supervisingPhysician: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    npi: z.string().regex(/^\d{10}$/).optional(),
    licenseNumber: z.string().optional(),
    licenseState: z.string().length(2).optional(),
    supervisionType: z.string().min(1),
  }).optional(),

  // Whether this is updating an existing provider
  providerId: z.string().uuid().optional(),
});

router.post(
  '/',
  authenticate,
  authorize('admin', 'practice_admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = onboardSchema.parse(req.body);

      const practiceId = req.practiceScope?.practiceIds?.[0];
      if (!practiceId) {
        return res.status(400).json({ error: 'Practice context required' });
      }

      const result = await prisma.$transaction(async (tx) => {
        // 1. Check provider limit if creating new
        let sub = await tx.subscription.findUnique({ where: { practiceId } });

        if (!validated.providerId) {
          if (sub && sub.providerCount >= sub.providerLimit) {
            throw new Error('PROVIDER_LIMIT_REACHED');
          }
        }

        // 2. Create or update Provider
        const providerData = {
          npi: validated.npi,
          firstName: validated.firstName,
          lastName: validated.lastName,
          middleName: validated.middleName,
          suffix: validated.suffix,
          dateOfBirth: validated.dateOfBirth ? new Date(validated.dateOfBirth) : new Date('1990-01-01'),
          gender: (validated.gender || 'prefer_not_to_say') as any,
          email: validated.email,
          phone: validated.phone || '',
          providerType: validated.providerType as any,
          practiceId,
          status: 'active' as const,
          onboardingCompletedAt: new Date(),
          onboardingData: null as any,
        };

        let provider;
        if (validated.providerId) {
          // Verify provider belongs to practice
          const existing = await tx.provider.findFirst({
            where: { id: validated.providerId, practiceId },
          });
          if (!existing) throw new Error('PROVIDER_NOT_FOUND');

          provider = await tx.provider.update({
            where: { id: validated.providerId },
            data: providerData,
          });
        } else {
          provider = await tx.provider.create({
            data: {
              ...providerData,
              createdById: req.user?.id,
            },
          });

          // Increment subscription count
          if (sub) {
            await tx.subscription.update({
              where: { practiceId },
              data: { providerCount: { increment: 1 } },
            });
          }
        }

        // 3. Locations → PracticeLocation
        if (validated.locations?.length) {
          await tx.practiceLocation.deleteMany({ where: { providerId: provider.id } });
          for (const loc of validated.locations) {
            await tx.practiceLocation.create({
              data: {
                providerId: provider.id,
                practiceId,
                locationName: loc.isTelehealth ? 'Telehealth' : 'Office',
                locationType: loc.isTelehealth ? 'telehealth' : 'office',
                addressLine1: loc.addressLine1,
                addressLine2: loc.addressLine2,
                city: loc.city,
                state: loc.state,
                zipCode: loc.zipCode,
                phone: loc.phone || '',
                isPrimary: false,
              },
            });
          }
        }

        // 4. Education records
        if (validated.education?.length) {
          await tx.education.deleteMany({ where: { providerId: provider.id } });
          for (const edu of validated.education) {
            await tx.education.create({
              data: {
                providerId: provider.id,
                institutionName: edu.schoolName,
                degree: edu.degreeType as any,
                fieldOfStudy: edu.fieldOfStudy || edu.degreeType,
                educationType: (edu.educationType as any) || null,
                startDate: edu.startDate ? new Date(edu.startDate) : new Date(),
                endDate: edu.endDate ? new Date(edu.endDate) : null,
                createdById: req.user?.id,
              },
            });
          }
        }

        // 5. License records
        if (validated.licenses?.length) {
          await tx.license.deleteMany({ where: { providerId: provider.id } });
          for (const lic of validated.licenses) {
            await tx.license.create({
              data: {
                providerId: provider.id,
                licenseType: lic.licenseType as any,
                licenseNumber: lic.licenseNumber,
                state: lic.state,
                issueDate: lic.issueDate ? new Date(lic.issueDate) : new Date(),
                expirationDate: new Date(lic.expirationDate),
                status: 'active',
                createdById: req.user?.id,
              },
            });
          }
        }

        // 6. Board Certifications
        if (validated.certifications?.length) {
          await tx.boardCertification.deleteMany({ where: { providerId: provider.id } });
          for (const cert of validated.certifications) {
            await tx.boardCertification.create({
              data: {
                providerId: provider.id,
                boardType: cert.boardType as any,
                boardName: cert.boardName || cert.boardType,
                certificationNumber: cert.certificationNumber,
                specialty: cert.specialty || cert.boardType,
                initialCertificationDate: cert.initialCertificationDate ? new Date(cert.initialCertificationDate) : new Date(),
                expirationDate: cert.expirationDate ? new Date(cert.expirationDate) : null,
                status: 'active',
                createdById: req.user?.id,
              },
            });
          }
        }

        // 7. DEA Registrations
        if (validated.deaRegistrations?.length) {
          await tx.deaRegistration.deleteMany({ where: { providerId: provider.id } });
          for (const dea of validated.deaRegistrations) {
            await tx.deaRegistration.create({
              data: {
                providerId: provider.id,
                deaNumber: dea.deaNumber,
                deaState: dea.deaState,
                deaSchedules: dea.deaSchedules || [],
                issueDate: dea.issueDate ? new Date(dea.issueDate) : new Date(),
                expirationDate: new Date(dea.expirationDate),
                status: 'active',
                createdById: req.user?.id,
              },
            });
          }
        }

        // 8. Malpractice Insurance
        if (validated.malpracticeInsurance) {
          const mi = validated.malpracticeInsurance;
          await tx.malpracticeInsurance.deleteMany({ where: { providerId: provider.id } });
          await tx.malpracticeInsurance.create({
            data: {
              providerId: provider.id,
              carrierName: mi.carrierName,
              policyNumber: mi.policyNumber,
              coverageType: (mi.coverageType || 'occurrence') as any,
              perClaimAmount: mi.perClaimAmount || 0,
              aggregateAmount: mi.aggregateAmount || 0,
              effectiveDate: mi.effectiveDate ? new Date(mi.effectiveDate) : new Date(),
              expirationDate: new Date(mi.expirationDate),
              status: 'active',
              createdById: req.user?.id,
            },
          });
        }

        // 9. Banking (ENCRYPTED - never log values)
        if (validated.banking) {
          const b = validated.banking;
          await tx.providerBanking.deleteMany({ where: { providerId: provider.id } });
          await tx.providerBanking.create({
            data: {
              providerId: provider.id,
              bankName: b.bankName,
              bankAccountType: b.accountType as any,
              routingNumberEncrypted: encryptSafe(b.routingNumber),
              accountNumberEncrypted: encryptSafe(b.accountNumber),
              accountNumberLast4: b.accountNumber.slice(-4),
              accountHolderName: b.accountHolderName,
              isPrimary: true,
              createdById: req.user?.id,
            },
          });
        }

        // 10. Work History
        if (validated.workHistory?.length) {
          await tx.workHistory.deleteMany({ where: { providerId: provider.id } });
          for (const wh of validated.workHistory) {
            await tx.workHistory.create({
              data: {
                providerId: provider.id,
                organizationName: wh.organizationName,
                organizationType: wh.organizationType || 'other',
                position: wh.position,
                startDate: new Date(wh.startDate),
                endDate: wh.endDate ? new Date(wh.endDate) : null,
                isCurrent: wh.isCurrent || false,
                createdById: req.user?.id,
              },
            });
          }
        }

        // 11. Disclosures
        if (validated.disclosures?.length) {
          await tx.providerDisclosure.deleteMany({ where: { providerId: provider.id } });
          for (const disc of validated.disclosures) {
            await tx.providerDisclosure.create({
              data: {
                providerId: provider.id,
                category: disc.category as any,
                questionText: disc.questionText,
                answer: disc.answer,
                explanation: disc.explanation,
                createdById: req.user?.id,
              },
            });
          }
        }

        // 12. Supervising Physician
        if (validated.supervisingPhysician) {
          const sp = validated.supervisingPhysician;
          await tx.supervisingPhysician.deleteMany({ where: { providerId: provider.id } });
          await tx.supervisingPhysician.create({
            data: {
              providerId: provider.id,
              supervisorFirstName: sp.firstName,
              supervisorLastName: sp.lastName,
              supervisorNpi: sp.npi,
              supervisorLicenseNumber: sp.licenseNumber,
              supervisorLicenseState: sp.licenseState,
              supervisionType: sp.supervisionType as any,
              agreementStartDate: new Date(),
              isPrimary: true,
              createdById: req.user?.id,
            },
          });
        }

        return provider;
      });

      invalidateCache('dashboard:');
      invalidateCache('ops:');

      logger.info(`[Onboard] Provider ${result.id} onboarded for practice ${practiceId}`);

      return res.status(201).json({
        success: true,
        data: {
          id: result.id,
          firstName: validated.firstName,
          lastName: validated.lastName,
          npi: validated.npi,
        },
      });
    } catch (error: any) {
      if (error instanceof ZodError || error?.name === 'ZodError') {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      if (error?.message === 'PROVIDER_LIMIT_REACHED') {
        return res.status(402).json({
          error: 'Provider limit reached',
          billingUrl: '/settings/billing',
        });
      }

      if (error?.message === 'PROVIDER_NOT_FOUND') {
        return res.status(404).json({ error: 'Provider not found' });
      }

      // Prisma unique constraint violation (e.g., duplicate NPI)
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'A provider with this NPI already exists',
        });
      }

      return next(error);
    }
  }
);

export default router;
