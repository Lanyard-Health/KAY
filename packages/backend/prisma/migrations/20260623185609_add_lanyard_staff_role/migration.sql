-- Add the lanyard_staff role to the UserRole enum.
-- lanyard_staff = Lanyard's own employees who deliver credentialing services across
-- ALL client practices. Distinct from `admin` (founder/CEO super-user) and from
-- `credentialing_staff` (a single practice's office worker, scoped to invited practices).
--
-- PostgreSQL cannot ADD an enum value inside a transaction in all versions, and it
-- cannot be referenced in the same transaction it is created. Prisma runs this file
-- on its own; `ADD VALUE IF NOT EXISTS` is idempotent and safe to re-run.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'lanyard_staff';
