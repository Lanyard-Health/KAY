import {
  CheckIcon,
  ArrowUpIcon,
  EllipsisHorizontalIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import type { ComponentType, SVGProps } from 'react';

export type EnrollmentStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'pending_review'
  | 'approved' | 'denied' | 'terminated';

type Glyph = ComponentType<SVGProps<SVGSVGElement>> | null;

interface StatusMeta {
  label: string;
  dotHex: string;
  chip: string;     // StatusBadge-convention soft chip classes
  Glyph: Glyph;
  hollow?: boolean; // not_started renders as outlined white dot
}

// Single source of truth — labels + hexes per DESIGN.md (dashboards). Never
// render a raw enum; never use the legacy hexes (#F59E0B submitted, #22C55E approved).
export const STATUS_META: Record<EnrollmentStatus, StatusMeta> = {
  not_started:    { label: 'Not started',        dotHex: '#a49d8f', chip: 'bg-gray-100 text-gray-800',     Glyph: null, hollow: true },
  in_progress:    { label: 'In progress',        dotHex: '#3B82F6', chip: 'bg-yellow-100 text-yellow-800', Glyph: EllipsisHorizontalIcon },
  submitted:      { label: 'Submitted to payer', dotHex: '#0E7490', chip: 'bg-cyan-50 text-cyan-800',      Glyph: ArrowUpIcon },
  pending_review: { label: 'Payer reviewing',    dotHex: '#8B5CF6', chip: 'bg-purple-100 text-purple-800', Glyph: ClockIcon },
  approved:       { label: 'Approved',           dotHex: '#15803D', chip: 'bg-green-100 text-green-800',   Glyph: CheckIcon },
  denied:         { label: 'Denied',             dotHex: '#EF4444', chip: 'bg-red-100 text-red-800',       Glyph: XMarkIcon },
  terminated:     { label: 'No longer active',   dotHex: '#8a8478', chip: 'bg-gray-100 text-gray-800',     Glyph: null },
};

// Client-facing surfaces say "Running long" (two-vocabulary rule) — never "Delayed" here.
export const DELAYED_META = {
  label: 'Running long',
  dotHex: '#B45309',
  chip: 'bg-[#FDF3E3] text-[#B45309]',
};

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function etaCaption(
  dayCount: number | null,
  minDays: number | null,
  maxDays: number | null,
): string | null {
  if (dayCount === null) return null;
  if (minDays !== null && maxDays !== null) return `Day ${dayCount} · typically ${minDays}–${maxDays} days`;
  return `Day ${dayCount} · no typical timeline on file`;
}

export interface AttentionItemView {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  kind: 'delayed' | 'denied';
  lastFollowUpDate: string | null;
  nextFollowUpDate: string | null;
}

// EXPERIENCE.md critical rule: every attention item states what Lanyard is
// doing + the next check-in. This builder guarantees a plan line exists.
export function attentionCopy(item: AttentionItemView): { headline: string; plan: string } {
  const checkIn = item.nextFollowUpDate
    ? ` Next check-in: ${fmtDate(item.nextFollowUpDate)}.`
    : " We'll post the next update here.";
  if (item.kind === 'denied') {
    return {
      headline: `${item.providerName} — ${item.payerName} was denied.`,
      plan: `We're reviewing the denial and preparing the resubmission.${checkIn}`,
    };
  }
  const followUp = item.lastFollowUpDate
    ? `Our team followed up with ${item.payerName} on ${fmtDate(item.lastFollowUpDate)}.`
    : 'Our team is monitoring this application.';
  return {
    headline: `${item.providerName} — ${item.payerName} is running longer than usual.`,
    plan: `${followUp}${checkIn}`,
  };
}
