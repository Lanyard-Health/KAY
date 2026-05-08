/**
 * Phase 4 — Practice Documents tab tests.
 *
 * Covers practice-context resolution, upload happy path + validation errors,
 * inline document-type editing, and OCR-status rendering. Role-gating of the
 * tab itself is exercised in DocumentList.test.tsx (the tab is hidden for the
 * 'provider' role at the parent component level — this component does not
 * enforce that gate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockUseAuthStore = vi.fn();
const mockUsePractices = vi.fn();
const mockUsePracticeDocuments = vi.fn();
const mockUseUploadPracticeDocument = vi.fn();
const mockUseUpdatePracticeDocumentType = vi.fn();

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../stores/auth.store', () => ({
  useAuthStore: (selector: any) => selector(mockUseAuthStore()),
}));

vi.mock('../../hooks/usePractices', () => ({
  usePractices: () => mockUsePractices(),
}));

vi.mock('../../hooks/usePracticeDocuments', () => ({
  usePracticeDocuments: (...args: any[]) => mockUsePracticeDocuments(...args),
  useUploadPracticeDocument: (...args: any[]) => mockUseUploadPracticeDocument(...args),
  useUpdatePracticeDocumentType: (...args: any[]) => mockUseUpdatePracticeDocumentType(...args),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

import PracticeDocumentsTab from './PracticeDocumentsTab';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const PRACTICE_A = '00000000-0000-4000-a000-0000000000aa';
const PRACTICE_B = '00000000-0000-4000-a000-0000000000bb';

const practiceAdminWithOnePractice = {
  id: 'u1',
  role: 'practice_admin' as const,
  practices: [{ practiceId: PRACTICE_A, role: 'PRACTICE_ADMIN', practice: { id: PRACTICE_A, name: 'Acme Health' } }],
};

const practiceAdminNoPractice = {
  id: 'u-orphan',
  role: 'practice_admin' as const,
  practices: [],
};

const adminWithMultiplePractices = {
  id: 'u-multi',
  role: 'admin' as const,
  practices: [],
};

function setUploadHookDefaults(overrides: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean }> = {}) {
  const mutate = overrides.mutate ?? vi.fn();
  mockUseUploadPracticeDocument.mockReturnValue({
    mutate,
    isPending: overrides.isPending ?? false,
  });
  return mutate;
}

function setUpdateHookDefaults(overrides: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean }> = {}) {
  const mutate = overrides.mutate ?? vi.fn();
  mockUseUpdatePracticeDocumentType.mockReturnValue({
    mutate,
    isPending: overrides.isPending ?? false,
  });
  return mutate;
}

describe('PracticeDocumentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePractices.mockReturnValue({ data: [] });
    mockUsePracticeDocuments.mockReturnValue({ data: [], isLoading: false, error: null });
    setUploadHookDefaults();
    setUpdateHookDefaults();
  });

  describe('practice context resolution', () => {
    it('shows the "no practice assigned" empty state for a non-admin with no practices', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminNoPractice });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.getByText(/no practice assigned/i)).toBeInTheDocument();
    });

    it('does NOT show a picker for a single-practice user', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.queryByLabelText(/^practice$/i)).not.toBeInTheDocument();
      expect(screen.getByText(/upload practice document/i)).toBeInTheDocument();
    });

    it('shows a practice picker for an admin with multiple practices', () => {
      mockUseAuthStore.mockReturnValue({ user: adminWithMultiplePractices });
      mockUsePractices.mockReturnValue({
        data: [
          { id: PRACTICE_A, name: 'Acme Health' },
          { id: PRACTICE_B, name: 'Other Clinic' },
        ],
      });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.getByLabelText(/^practice$/i)).toBeInTheDocument();
      expect(screen.getByText(/select a practice/i)).toBeInTheDocument();
    });
  });

  describe('upload flow', () => {
    it('rejects an invalid file type with a toast and does not call upload', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      const mutate = setUploadHookDefaults();

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      const input = screen.getByLabelText(/click or drop a file here/i);
      const docx = new File(['x'], 'doc.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      fireEvent.change(input, { target: { files: [docx] } });

      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/invalid file type/i));
      expect(mutate).not.toHaveBeenCalled();
    });

    it('rejects oversize files with a toast and does not call upload', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      const mutate = setUploadHookDefaults();

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      const input = screen.getByLabelText(/click or drop a file here/i);
      // Construct a "large" PDF without actually allocating 26 MB of memory.
      const big = new File([new Uint8Array(2)], 'big.pdf', { type: 'application/pdf' });
      Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
      fireEvent.change(input, { target: { files: [big] } });

      expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/file too large/i));
      expect(mutate).not.toHaveBeenCalled();
    });

    it('happy path: selecting a valid file and clicking Upload calls the upload mutation with the right shape', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      const mutate = setUploadHookDefaults();

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      const input = screen.getByLabelText(/click or drop a file here/i);
      const pdf = new File(['hello'], 'w9.pdf', { type: 'application/pdf' });
      fireEvent.change(input, { target: { files: [pdf] } });

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      fireEvent.click(uploadButton);

      expect(mutate).toHaveBeenCalledTimes(1);
      const args = mutate.mock.calls[0]![0];
      expect(args.file).toBe(pdf);
      // Default state: documentType empty → omitted (auto-detect).
      expect(args.documentType).toBeUndefined();
    });

    it('passes documentType when the user picks one before uploading', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      const mutate = setUploadHookDefaults();

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      const fileInput = screen.getByLabelText(/click or drop a file here/i);
      const pdf = new File(['hello'], 'doc.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [pdf] } });

      const typeSelect = screen.getByLabelText(/document type/i);
      fireEvent.change(typeSelect, { target: { value: 'w9' } });

      fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

      const args = mutate.mock.calls[0]![0];
      expect(args.documentType).toBe('w9');
    });

    it('surfaces a backend error message via toast on upload failure', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      // Simulate the mutation calling its onError handler with a backend-style error
      const mutate = vi.fn((_input, opts) => {
        opts?.onError?.({
          response: { data: { error: { message: 'SSRF guard rejected the URL' } } },
        });
      });
      setUploadHookDefaults({ mutate });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      const input = screen.getByLabelText(/click or drop a file here/i);
      const pdf = new File(['hello'], 'a.pdf', { type: 'application/pdf' });
      fireEvent.change(input, { target: { files: [pdf] } });
      fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

      expect(mockToastError).toHaveBeenCalledWith('SSRF guard rejected the URL');
    });
  });

  describe('document list rendering + inline edit', () => {
    const baseDoc = {
      id: 'd1',
      practiceId: PRACTICE_A,
      providerId: null,
      fileName: 'd1.pdf',
      originalFileName: 'w9.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      documentType: 'w9',
      description: null,
      expirationDate: null,
      ocrStatus: 'completed' as const,
      ocrConfidence: 0.95,
      ocrData: { Name: { value: 'Acme', confidence: 0.99 } },
      isVerified: false,
      createdAt: '2026-05-07T04:00:00Z',
      updatedAt: '2026-05-07T04:00:00Z',
      createdById: 'u1',
    };

    it('renders the row with humanized type and Completed status', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({ data: [baseDoc], isLoading: false, error: null });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.getByText('w9.pdf')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /w-9 form/i })).toBeInTheDocument();
      expect(screen.getByText(/completed/i)).toBeInTheDocument();
    });

    it('shows a processing spinner while OCR is in flight', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({
        data: [{ ...baseDoc, ocrStatus: 'processing' }],
        isLoading: false,
        error: null,
      });

      const { container } = render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      // Spinner uses .animate-spin
      expect(container.querySelector('.animate-spin')).not.toBeNull();
      expect(screen.getByText(/processing/i)).toBeInTheDocument();
    });

    it('happy path: clicking the type, picking a new value, and clicking save fires the PATCH mutation', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({ data: [baseDoc], isLoading: false, error: null });
      const update = setUpdateHookDefaults();

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      // Open the inline editor
      fireEvent.click(screen.getByRole('button', { name: /w-9 form/i }));

      // Pick a different type — the dropdown is the only select now (the upload-card type select
      // is also in the DOM, but we target the one with role 'combobox' inside the row by
      // matching the option set: editing dropdown does NOT have an empty "Auto-detect" option).
      const selects = screen.getAllByRole('combobox');
      const editSelect = selects.find((s) =>
        Array.from((s as HTMLSelectElement).options).every((opt) => opt.value !== '')
      );
      expect(editSelect).toBeDefined();
      fireEvent.change(editSelect as HTMLSelectElement, { target: { value: 'cp575' } });

      // Click save
      fireEvent.click(screen.getByRole('button', { name: /save document type/i }));

      expect(update).toHaveBeenCalledWith(
        { documentId: 'd1', documentType: 'cp575' },
        expect.any(Object)
      );
    });

    it('cancel button reverts the edit without firing PATCH', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({ data: [baseDoc], isLoading: false, error: null });
      const update = setUpdateHookDefaults();

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      fireEvent.click(screen.getByRole('button', { name: /w-9 form/i }));
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(update).not.toHaveBeenCalled();
      // Type label is back
      expect(screen.getByRole('button', { name: /w-9 form/i })).toBeInTheDocument();
    });
  });

  describe('list states', () => {
    it('shows "Loading documents…" while the query is loading', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({ data: undefined, isLoading: true, error: null });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.getByText(/loading documents/i)).toBeInTheDocument();
    });

    it('shows the empty-state when the list returns zero documents', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({ data: [], isLoading: false, error: null });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.getByText(/no practice documents yet/i)).toBeInTheDocument();
    });

    it('shows an error card when the list query fails', () => {
      mockUseAuthStore.mockReturnValue({ user: practiceAdminWithOnePractice });
      mockUsePracticeDocuments.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('boom'),
      });

      render(<PracticeDocumentsTab />, { wrapper: wrapper() });

      expect(screen.getByText(/failed to load documents/i)).toBeInTheDocument();
    });
  });
});
