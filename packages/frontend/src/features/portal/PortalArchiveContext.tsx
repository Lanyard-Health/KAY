import { createContext, useContext } from 'react';

/**
 * Carries the "is my own provider profile soft-deleted?" flag through the portal layout
 * to any descendant form that renders write controls. PortalLayout reads it from the
 * `/portal/me` response (`isArchived` top-level field) and provides it once.
 *
 * Default is false so any portal page rendered outside the provider works the same as
 * before — only an active-archived provider session flips it on.
 */
export interface PortalArchiveValue {
  isArchived: boolean;
}

export const PortalArchiveContext = createContext<PortalArchiveValue>({ isArchived: false });

export function usePortalArchive(): PortalArchiveValue {
  return useContext(PortalArchiveContext);
}
