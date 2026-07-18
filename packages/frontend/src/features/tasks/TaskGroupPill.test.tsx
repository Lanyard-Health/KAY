import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskGroupPill from './TaskGroupPill';

describe('TaskGroupPill', () => {
  it('renders the group label verbatim, including the spaced CAQH form', () => {
    render(<TaskGroupPill group="CAQH_UPDATE" />);
    expect(screen.getByText('CAQH Update / Re-attestation')).toBeInTheDocument();
  });
  it('renders the system variant for check-ins', () => {
    render(<TaskGroupPill group="CHECK_IN" />);
    expect(screen.getByText('Auto · Check-in')).toBeInTheDocument();
  });
});
