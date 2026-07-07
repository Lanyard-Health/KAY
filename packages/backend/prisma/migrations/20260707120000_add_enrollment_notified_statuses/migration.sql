-- Dedup guard for enrollment status alerts: statuses for which practice-facing
-- notifications (in-app + email) have already been sent. Claimed atomically in
-- notifyEnrollmentStatusChange before sending; cleared by status corrections.
ALTER TABLE "payer_enrollments" ADD COLUMN "notified_statuses" "EnrollmentStatus"[] DEFAULT ARRAY[]::"EnrollmentStatus"[];
