import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatusDotGrid from './StatusDotGrid';

const payers = [{ id: 'p1', name: 'Aetna' }, { id: 'p2', name: 'Optum' }];
const rows = [{
  providerId: 'pr1',
  providerName: 'Amara Osei',
  credential: 'MD',
  approvedCount: 1,
  totalCount: 2,
  cells: [
    { enrollmentId: 'e1', status: 'approved' as const, isDelayed: false, dayCount: null, minDays: null, maxDays: null, updatedDaysAgo: 3 },
    { enrollmentId: 'e2', status: 'submitted' as const, isDelayed: true, dayCount: 97, minDays: 45, maxDays: 90, updatedDaysAgo: 12 },
  ],
}];

function renderGrid() {
  return render(<MemoryRouter><StatusDotGrid payers={payers} rows={rows} /></MemoryRouter>);
}

describe('StatusDotGrid', () => {
  it('renders a grid with provider row, payer columns, and row summary', () => {
    renderGrid();
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getAllByText('Amara Osei').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 of 2 approved').length).toBeGreaterThan(0);
  });
  it('delayed cell announces Running long (flag replaces status; status stays in the name)', () => {
    renderGrid();
    const cell = screen.getByRole('button', { name: /Optum — Running long/i });
    expect(cell.getAttribute('aria-label')).toMatch(/Submitted to payer/); // underlying status in the fact set
    expect(cell.getAttribute('aria-label')).toMatch(/day 97/i);
  });
  it('legend enumerates all seven statuses plus Running long (8 entries)', () => {
    renderGrid();
    const legend = screen.getByTestId('grid-legend');
    for (const label of ['Not started', 'In progress', 'Submitted to payer', 'Payer reviewing', 'Approved', 'Denied', 'No longer active', 'Running long']) {
      expect(legend.textContent).toContain(label);
    }
  });
  it('never renders raw enums', () => {
    const { container } = renderGrid();
    expect(container.textContent).not.toContain('pending_review');
    expect(container.textContent).not.toContain('not_started');
  });
});
