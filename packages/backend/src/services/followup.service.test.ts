import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./email.service.js', () => ({
  emailService: {
    sendEmail: vi.fn(),
  },
}));

import { followUpService } from './followup.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { emailService } from './email.service.js';

// --- Fixtures ---

const mockProvider = {
  id: 'prov-1',
  firstName: 'Jane',
  lastName: 'Smith',
  npi: '1234567890',
  practiceLocations: [
    { id: 'loc-1', isPrimary: false, locationName: 'Branch Office', npi: '9876543210', city: 'Dallas', state: 'TX' },
    { id: 'loc-2', isPrimary: true, locationName: 'Main Office', npi: '1111111111', city: 'Austin', state: 'TX' },
  ],
};

const mockPayer = { id: 'payer-1', name: 'Aetna' };

const mockEnrollment = {
  id: 'enrl-1',
  status: 'in_progress',
  followUpEnabled: true,
  followUpEmail: 'payer@aetna.com',
  followUpFrequencyDays: 14,
  nextFollowUpDate: new Date('2026-01-01'),
  lastFollowUpDate: new Date('2025-12-15'),
  lastFollowUpSentAt: null,
  applicationDate: new Date('2025-11-01'),
  providerNumber: 'PRV-001',
  productTypes: ['HMO', 'PPO'],
  notes: 'Waiting on credentialing committee review',
  provider: mockProvider,
  payer: mockPayer,
} as any;

beforeEach(() => {
  vi.resetAllMocks();
});

// --- Tests ---

describe('FollowUpService', () => {
  // 1. extractProviderData
  describe('extractProviderData', () => {
    it('finds the primary location', () => {
      const data = followUpService.extractProviderData(mockEnrollment);
      expect(data.providerName).toBe('Jane Smith');
      expect(data.providerNpi).toBe('1234567890');
      expect(data.groupNpi).toBe('1111111111');
      expect(data.practiceName).toBe('Main Office');
      expect(data.practiceCity).toBe('Austin');
      expect(data.practiceState).toBe('TX');
      expect(data.payerName).toBe('Aetna');
    });

    it('falls back to first location when no primary', () => {
      const enrollment = {
        ...mockEnrollment,
        provider: {
          ...mockProvider,
          practiceLocations: [
            { id: 'loc-1', isPrimary: false, locationName: 'Branch Office', npi: '9876543210', city: 'Dallas', state: 'TX' },
          ],
        },
      };
      const data = followUpService.extractProviderData(enrollment);
      expect(data.groupNpi).toBe('9876543210');
      expect(data.practiceName).toBe('Branch Office');
      expect(data.practiceCity).toBe('Dallas');
    });

    it('handles missing locations with empty strings', () => {
      const enrollment = {
        ...mockEnrollment,
        provider: {
          ...mockProvider,
          practiceLocations: [],
        },
      };
      const data = followUpService.extractProviderData(enrollment);
      expect(data.groupNpi).toBe('');
      expect(data.practiceName).toBe('');
      expect(data.practiceCity).toBe('');
      expect(data.practiceState).toBe('');
    });
  });

  // 2. generateProfessionalEmail
  describe('generateProfessionalEmail', () => {
    it('includes provider data fields', () => {
      const data = followUpService.extractProviderData(mockEnrollment);
      const html = followUpService.generateProfessionalEmail(data);
      expect(html).toContain('Jane Smith');
      expect(html).toContain('1234567890');
      expect(html).toContain('1111111111');
      expect(html).toContain('Main Office');
      expect(html).toContain('Austin, TX');
      expect(html).toContain('Aetna');
    });

    it('includes optional customMessage block', () => {
      const data = followUpService.extractProviderData(mockEnrollment);
      const html = followUpService.generateProfessionalEmail(data, 'Please expedite this application');
      expect(html).toContain('Please expedite this application');
    });

    it('omits groupNpi, practiceName, and location when empty', () => {
      const data = {
        providerName: 'Jane Smith',
        providerNpi: '1234567890',
        groupNpi: '',
        practiceName: '',
        practiceCity: '',
        practiceState: '',
        payerName: 'Aetna',
      };
      const html = followUpService.generateProfessionalEmail(data);
      expect(html).not.toContain('Group NPI');
      expect(html).not.toContain('Practice Name');
      expect(html).not.toContain('Location');
    });
  });

  // 3. generateFollowUpEmail
  describe('generateFollowUpEmail', () => {
    it('maps status label (in_progress -> "In Progress")', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      expect(html).toContain('In Progress');
    });

    it('maps status color for in_progress', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      expect(html).toContain('#f59e0b');
    });

    it('formats applicationDate', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      // toLocaleDateString produces locale-dependent output; just check it's not "Not submitted"
      expect(html).not.toContain('Not submitted');
    });

    it('shows "Not submitted" when applicationDate is null', () => {
      const enrollment = { ...mockEnrollment, applicationDate: null };
      const html = followUpService.generateFollowUpEmail(enrollment);
      expect(html).toContain('Not submitted');
    });

    it('includes lastFollowUpDate with days-ago calculation', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      expect(html).toContain('days ago');
    });

    it('shows "Never" when lastFollowUpDate is null', () => {
      const enrollment = { ...mockEnrollment, lastFollowUpDate: null };
      const html = followUpService.generateFollowUpEmail(enrollment);
      expect(html).toContain('Never');
      expect(html).not.toContain('days ago');
    });

    it('includes notes when present', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      expect(html).toContain('Waiting on credentialing committee review');
    });

    it('omits notes section when notes is null', () => {
      const enrollment = { ...mockEnrollment, notes: null };
      const html = followUpService.generateFollowUpEmail(enrollment);
      expect(html).not.toContain('<strong>Notes:</strong>');
    });

    it('includes providerNumber when present', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      expect(html).toContain('PRV-001');
    });

    it('includes productTypes when present', () => {
      const html = followUpService.generateFollowUpEmail(mockEnrollment);
      expect(html).toContain('HMO, PPO');
    });

    it('omits providerNumber row when not present', () => {
      const enrollment = { ...mockEnrollment, providerNumber: null };
      const html = followUpService.generateFollowUpEmail(enrollment);
      expect(html).not.toContain('Provider #');
    });

    it('omits productTypes row when empty array', () => {
      const enrollment = { ...mockEnrollment, productTypes: [] };
      const html = followUpService.generateFollowUpEmail(enrollment);
      expect(html).not.toContain('Product Types');
    });
  });

  // 4. sendFollowUpEmail
  describe('sendFollowUpEmail', () => {
    it('success: calls emailService.sendEmail and updates prisma, returns success=true', async () => {
      vi.mocked(emailService.sendEmail).mockResolvedValue({ success: true } as any);
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      const result = await followUpService.sendFollowUpEmail(mockEnrollment);

      expect(result.success).toBe(true);
      expect(result.enrollmentId).toBe('enrl-1');
      expect(result.providerName).toBe('Jane Smith');
      expect(result.payerName).toBe('Aetna');
      expect(result.email).toBe('payer@aetna.com');
      expect(emailService.sendEmail).toHaveBeenCalledOnce();
      expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'enrl-1' },
          data: expect.objectContaining({
            lastFollowUpSentAt: expect.any(Date),
            nextFollowUpDate: expect.any(Date),
            lastFollowUpDate: expect.any(Date),
          }),
        })
      );
    });

    it('returns error when no followUpEmail', async () => {
      const enrollment = { ...mockEnrollment, followUpEmail: null };
      const result = await followUpService.sendFollowUpEmail(enrollment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No follow-up email configured');
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('returns error without updating prisma when email fails', async () => {
      vi.mocked(emailService.sendEmail).mockResolvedValue({ success: false, error: 'SES error' } as any);

      const result = await followUpService.sendFollowUpEmail(mockEnrollment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SES error');
      expect(prismaMock.payerEnrollment.update).not.toHaveBeenCalled();
    });
  });

  // 5. processAllDueFollowUps
  describe('processAllDueFollowUps', () => {
    it('processes multiple enrollments and returns correct counts', async () => {
      const enrollment2 = { ...mockEnrollment, id: 'enrl-2', followUpEmail: null };
      prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollment, enrollment2] as any);
      vi.mocked(emailService.sendEmail).mockResolvedValue({ success: true } as any);
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      const result = await followUpService.processAllDueFollowUps();

      expect(result.processed).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(2);
    });

    it('handles empty list', async () => {
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

      const result = await followUpService.processAllDueFollowUps();

      expect(result.processed).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  // 6. sendCustomFollowUp
  describe('sendCustomFollowUp', () => {
    it('returns error when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const result = await followUpService.sendCustomFollowUp('enrl-missing', 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Enrollment not found');
      expect(result.providerName).toBe('Unknown');
    });

    it('returns error when no toEmail', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment);

      const result = await followUpService.sendCustomFollowUp('enrl-1', '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No email address provided');
    });

    it('success: sends professional email with attachment, updates dates', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment);
      vi.mocked(emailService.sendEmail).mockResolvedValue({ success: true } as any);
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      const attachment = {
        filename: 'doc.pdf',
        content: Buffer.from('pdf-data'),
        contentType: 'application/pdf',
      };

      const result = await followUpService.sendCustomFollowUp('enrl-1', 'custom@example.com', {
        customMessage: 'Please review',
        attachment,
      });

      expect(result.success).toBe(true);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'custom@example.com',
          attachments: [expect.objectContaining({ filename: 'doc.pdf' })],
        })
      );
      expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'enrl-1' },
          data: expect.objectContaining({
            lastFollowUpSentAt: expect.any(Date),
            lastFollowUpDate: expect.any(Date),
          }),
        })
      );
    });

    it('does not update dates when email fails', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment);
      vi.mocked(emailService.sendEmail).mockResolvedValue({ success: false, error: 'SES error' } as any);

      const result = await followUpService.sendCustomFollowUp('enrl-1', 'custom@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('SES error');
      expect(prismaMock.payerEnrollment.update).not.toHaveBeenCalled();
    });
  });

  // 7. getEnrollmentEmailData
  describe('getEnrollmentEmailData', () => {
    it('returns extracted data for found enrollment', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment);

      const data = await followUpService.getEnrollmentEmailData('enrl-1');

      expect(data).not.toBeNull();
      expect(data!.providerName).toBe('Jane Smith');
      expect(data!.payerName).toBe('Aetna');
      expect(data!.groupNpi).toBe('1111111111');
    });

    it('returns null for not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const data = await followUpService.getEnrollmentEmailData('enrl-missing');

      expect(data).toBeNull();
    });
  });

  // 8. sendTestFollowUp
  describe('sendTestFollowUp', () => {
    it('delegates to sendCustomFollowUp with provided email', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment);
      vi.mocked(emailService.sendEmail).mockResolvedValue({ success: true } as any);
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      const result = await followUpService.sendTestFollowUp('enrl-1', 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.email).toBe('test@example.com');
    });

    it('delegates with empty string when no testEmail provided', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment);

      const result = await followUpService.sendTestFollowUp('enrl-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No email address provided');
    });
  });

  // 9. configureFollowUp
  describe('configureFollowUp', () => {
    it('enabled with custom frequency sets nextFollowUpDate', async () => {
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      await followUpService.configureFollowUp('enrl-1', {
        enabled: true,
        email: 'payer@aetna.com',
        frequencyDays: 7,
      });

      expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'enrl-1' },
          data: expect.objectContaining({
            followUpEnabled: true,
            followUpEmail: 'payer@aetna.com',
            followUpFrequencyDays: 7,
            nextFollowUpDate: expect.any(Date),
          }),
        })
      );

      // Verify the nextFollowUpDate is roughly 7 days from now
      const callData = prismaMock.payerEnrollment.update.mock.calls[0]![0].data as any;
      const diffDays = (callData.nextFollowUpDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });

    it('disabled sets nextFollowUpDate to null', async () => {
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      await followUpService.configureFollowUp('enrl-1', { enabled: false });

      expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            followUpEnabled: false,
            nextFollowUpDate: null,
          }),
        })
      );
    });

    it('defaults to 14 day frequency when not specified', async () => {
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment);

      await followUpService.configureFollowUp('enrl-1', { enabled: true });

      const callData = prismaMock.payerEnrollment.update.mock.calls[0]![0].data as any;
      expect(callData.followUpFrequencyDays).toBe(14);
      const diffDays = (callData.nextFollowUpDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(13.9);
      expect(diffDays).toBeLessThan(14.1);
    });
  });

  // 10. getEnrollmentsDueForFollowUp
  describe('getEnrollmentsDueForFollowUp', () => {
    it('calls prisma findMany with correct filters', async () => {
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

      await followUpService.getEnrollmentsDueForFollowUp();

      expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledOnce();
      expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            followUpEnabled: true,
            followUpEmail: { not: null },
            status: { notIn: ['approved', 'denied', 'terminated'] },
          }),
          include: expect.objectContaining({
            provider: expect.objectContaining({
              include: { practiceLocations: true },
            }),
            payer: true,
          }),
        })
      );
    });
  });
});
