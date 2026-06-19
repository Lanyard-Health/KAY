import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockExtractTextract,
  mockExtractVision,
  mockClassify,
  mockMapToCredential,
  mockS3Send,
  MockS3Client,
} = vi.hoisted(() => {
  const mockS3Send = vi.fn();
  const MockS3Client = vi.fn();
  return {
    mockExtractTextract: vi.fn(),
    mockExtractVision: vi.fn(),
    mockClassify: vi.fn(),
    mockMapToCredential: vi.fn(),
    mockS3Send,
    MockS3Client,
  };
});

// Mock prisma
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
}));

vi.mock('./websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
}));

// coordinator.service reaches into BullMQ/Redis via notifyTaskCompletion; without
// this mock the pipeline tests hang to the 10s timeout under test (no Redis).
vi.mock('./coordinator.service.js', () => ({
  notifyTaskCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./extractors/textract-extractor.js', () => ({
  extractWithTextract: mockExtractTextract,
}));

vi.mock('./extractors/vision-extractor.js', () => ({
  extractWithVision: mockExtractVision,
}));

vi.mock('./document-classifier.js', () => ({
  classifyDocumentType: mockClassify,
}));

vi.mock('./credential-mapper.js', () => ({
  mapToCredential: mockMapToCredential,
}));

// Mock S3
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Client,
  GetObjectCommand: vi.fn(),
}));

import { processDocumentJob } from './document-agent.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from './event-logger.js';
import { emitWorkflowEvent } from './websocket.js';

// Helper to mock S3 download returning a buffer
function mockS3Download(content = 'fake-file-content') {
  const buf = Buffer.from(content);
  mockS3Send.mockResolvedValueOnce({
    Body: {
      [Symbol.asyncIterator]: async function* () {
        yield buf;
      },
    },
  });
}

describe('document-agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-setup S3Client mock after reset
    MockS3Client.mockImplementation(function () {
      return { send: mockS3Send };
    });
  });

  const baseJobData = {
    workflowId: 'wf-1',
    taskId: 'task-1',
    documentId: 'doc-1',
    providerId: 'prov-1',
  };

  it('processes a PDF document through Textract pipeline', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      originalFileName: 'license.pdf',
      providerId: 'prov-1',
    } as never);

    mockS3Download('fake-pdf');

    mockExtractTextract.mockResolvedValueOnce({
      fields: {
        'License Number': { value: 'MD12345', confidence: 0.95 },
        State: { value: 'California', confidence: 0.98 },
      },
      rawLines: ['State Medical License'],
      averageConfidence: 0.965,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD12345', state: 'CA' },
      unmappedFields: [],
      fieldConfidences: { 'License Number': 0.95, State: 0.98 },
    });

    prismaMock.license.create.mockResolvedValueOnce({ id: 'lic-1' } as never);
    prismaMock.document.update.mockResolvedValueOnce({} as never);
    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(result.status).toBe('completed');
    expect(result.extractionMethod).toBe('textract');
    expect(result.documentType).toBe('license');
    expect(result.credentialId).toBe('lic-1');
    expect(logAgentEvent).toHaveBeenCalled();
    expect(mockExtractTextract).toHaveBeenCalled();
  });

  it('processes an image document through Vision pipeline', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.jpg',
      mimeType: 'image/jpeg',
      documentType: 'license',
      originalFileName: 'license.jpg',
      providerId: 'prov-1',
    } as never);

    mockS3Download('fake-image');

    mockExtractVision.mockResolvedValueOnce({
      fields: {
        licenseNumber: { value: 'MD12345', confidence: 0.96 },
      },
      averageConfidence: 0.96,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD12345' },
      unmappedFields: [],
      fieldConfidences: { licenseNumber: 0.96 },
    });

    prismaMock.license.create.mockResolvedValueOnce({ id: 'lic-1' } as never);
    prismaMock.document.update.mockResolvedValueOnce({} as never);
    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(result.status).toBe('completed');
    expect(result.extractionMethod).toBe('vision');
    expect(mockExtractVision).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBase64: expect.any(String),
        mimeType: 'image/jpeg',
        documentType: 'license',
      })
    );
  });

  it('flags for human review when confidence < 0.90', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      originalFileName: 'license.pdf',
      providerId: 'prov-1',
    } as never);

    mockS3Download('fake-pdf');

    mockExtractTextract.mockResolvedValueOnce({
      fields: { 'License Number': { value: 'MD???', confidence: 0.60 } },
      rawLines: [],
      averageConfidence: 0.60,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD???' },
      unmappedFields: [],
      fieldConfidences: { 'License Number': 0.60 },
    });

    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(result.status).toBe('needs_review');
    expect(result.confidence).toBeLessThan(0.90);
    // Should NOT create a credential
    expect(prismaMock.license.create).not.toHaveBeenCalled();
  });

  it('classifies unknown document type before extraction', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'other',
      originalFileName: 'unknown-doc.pdf',
      providerId: 'prov-1',
    } as never);

    mockClassify.mockResolvedValueOnce('license');

    mockS3Download('fake-pdf');

    mockExtractTextract.mockResolvedValueOnce({
      fields: { 'License Number': { value: 'MD12345', confidence: 0.95 } },
      rawLines: [],
      averageConfidence: 0.95,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD12345' },
      unmappedFields: [],
      fieldConfidences: { 'License Number': 0.95 },
    });

    prismaMock.license.create.mockResolvedValueOnce({ id: 'lic-1' } as never);
    prismaMock.document.update.mockResolvedValueOnce({} as never);
    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(mockClassify).toHaveBeenCalled();
    expect(result.documentType).toBe('license');
  });

  it('emits WebSocket events during processing', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      originalFileName: 'license.pdf',
      providerId: 'prov-1',
    } as never);

    mockS3Download('fake-pdf');

    mockExtractTextract.mockResolvedValueOnce({
      fields: {},
      rawLines: [],
      averageConfidence: 0,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: {},
      unmappedFields: [],
      fieldConfidences: {},
    });

    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    await processDocumentJob(baseJobData);

    // Should emit at least: started, extracted, complete
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      'wf-1',
      'agent:document_processing',
      expect.objectContaining({ documentId: 'doc-1', step: 'started' })
    );
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      'wf-1',
      'agent:document_extracted',
      expect.objectContaining({ documentId: 'doc-1' })
    );
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      'wf-1',
      'agent:document_complete',
      expect.objectContaining({ documentId: 'doc-1' })
    );
  });
});
