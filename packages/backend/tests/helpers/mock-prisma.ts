import { type PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import { beforeEach } from 'vitest';

export type MockPrismaClient = DeepMockProxy<PrismaClient>;

export const prismaMock = mockDeep<PrismaClient>();

// All Prisma model names used across the codebase.
// If you add a new model to schema.prisma, add it here so tests that don't
// explicitly stub it still get a safe default ([] / null / 0) instead of undefined.
const MODELS = [
  'adminNotification', 'agentAction', 'agentEvent', 'agentTask', 'agentWorkflow',
  'aiRecommendation', 'auditLog', 'boardCertification', 'caqhSyncLog',
  'cdsRegistration', 'chatConversation', 'chatMessage', 'continuingEducation',
  'coveringColleague', 'customService', 'deaRegistration', 'denialTriage',
  'document', 'education', 'emailLog', 'emailTemplate', 'enrollment',
  'enrollmentRun', 'enrollmentWorkflowStep', 'enterpriseQueue', 'followUpRun',
  'followUpTemplate', 'followUpTemplateStep', 'hospitalAffiliation',
  'inAppNotification', 'license', 'malpracticeClaim', 'malpracticeInsurance',
  'malpracticePolicyLocation', 'notification', 'organizationType',
  'patientAgeGroup', 'patientGenderIdentity', 'patientSexualOrientation',
  'payer', 'payerContact', 'payerForm', 'payerFormField',
  'payerFormFieldMapping', 'payerRequirement', 'payerStateRule',
  'payerSubmissionConfig', 'payerTimeline', 'payerTrack', 'pendingApproval',
  'practice', 'practiceLocation', 'practicePayer', 'practiceSettings',
  'providerAddress', 'providerApplication', 'providerBanking',
  'providerCaqhMirror', 'providerCertification', 'providerChecklist',
  'providerDemographics', 'providerDisclosure', 'providerIdentifier',
  'providerImport', 'providerProfile', 'providerSpecialty',
  'requirementUniversal', 'retellCallLog', 'serviceCategory', 'specialPopulation',
  'specialty', 'subSpecialty', 'supervisingPhysician', 'task',
  'terminationLetter', 'user', 'userPractice', 'webhookDelivery',
  'webhookSubscription', 'workflowTemplate', 'workflowTemplateCondition',
  'workflowTemplateStep', 'workHistory', 'workHistoryGap',
] as const;

beforeEach(() => {
  mockReset(prismaMock);
  for (const model of MODELS) {
    const m = (prismaMock as any)[model];
    if (!m) continue;
    m.findMany?.mockResolvedValue([]);
    m.findFirst?.mockResolvedValue(null);
    m.findUnique?.mockResolvedValue(null);
    m.findFirstOrThrow?.mockResolvedValue(null);
    m.findUniqueOrThrow?.mockResolvedValue(null);
    m.count?.mockResolvedValue(0);
    m.aggregate?.mockResolvedValue({});
    m.groupBy?.mockResolvedValue([]);
  }
  (prismaMock as any).$queryRaw?.mockResolvedValue([]);
  (prismaMock as any).$queryRawUnsafe?.mockResolvedValue([]);
  (prismaMock as any).$transaction?.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(prismaMock);
    return arg;
  });
});
