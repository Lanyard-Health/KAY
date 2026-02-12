-- ============================================================
-- Demo Enrollment Data for Payer Intelligence
-- Inserts 32 enrollments across 5 payers and 7 providers
-- Constraint: unique (provider_id, payer_id) per enrollment
-- ============================================================

-- CLEANUP: Uncomment the following DELETE to remove all seeded records
-- DELETE FROM payer_enrollments WHERE id LIKE 'demo-%';

-- Payer IDs
-- Blue Cross Blue Shield: cdae50a2-b762-42e5-a404-28f5002e0f9a
-- Aetna:                  b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8
-- Cigna:                  cec0708d-4eb7-4b38-93e5-5f165481316b
-- UnitedHealthcare:       0c85bc27-c872-4c53-9705-7b732454acb1
-- Medicare:               26c73692-d89e-475e-a3ae-9468a53e563e

-- Provider IDs
-- P1 Sarah Mitchell:          9369a1f9-0171-4ae6-a336-171877811eb5
-- P2 Tania Rinchere-Georges:  a6426728-a581-4d37-8c07-d078ee1b6862
-- P3 Hiren Patel:             e8233948-c5bf-4b88-b5d1-6521942ab41f
-- P4 Dev Provider A:          cml73pweg00003xtf8cuknu7y
-- P5 Dev Provider B:          bff8e187-5758-4cc4-b7ae-c88ab3de063b
-- P6 Sheree Mitchell:         f47e9ee8-cc0e-4195-b382-12a4eaeb5500
-- P7 Linda Jeffreys:          e6c42d76-4d3d-4acc-806d-a8f167d949b4

-- NOTE: Sheree (P6) already has enrollments with BCBS, Cigna, Medicare — excluded from those payers

INSERT INTO payer_enrollments (
  id, provider_id, payer_id, status,
  application_date, effective_date, termination_date,
  provider_number, notes,
  created_at, updated_at,
  follow_up_enabled, follow_up_frequency_days, pdm_enabled
) VALUES

-- ============================================================
-- BLUE CROSS BLUE SHIELD (6): 4 approved, 1 denied, 1 in_progress
-- Profile: Good approval rate (80%), avg ~33 days
-- Providers: P1, P2, P3, P4, P5, P7 (not P6/Sheree — conflict)
-- ============================================================
('demo-bcbs-01', '9369a1f9-0171-4ae6-a336-171877811eb5', 'cdae50a2-b762-42e5-a404-28f5002e0f9a',
 'approved', '2025-06-15', '2025-07-20', NULL, 'BCBS-10001', NULL,
 '2025-06-15', '2025-07-20', false, 14, false),

('demo-bcbs-02', 'a6426728-a581-4d37-8c07-d078ee1b6862', 'cdae50a2-b762-42e5-a404-28f5002e0f9a',
 'approved', '2025-07-01', '2025-08-05', NULL, 'BCBS-10002', NULL,
 '2025-07-01', '2025-08-05', false, 14, false),

('demo-bcbs-03', 'e8233948-c5bf-4b88-b5d1-6521942ab41f', 'cdae50a2-b762-42e5-a404-28f5002e0f9a',
 'approved', '2025-08-10', '2025-09-12', NULL, 'BCBS-10003', NULL,
 '2025-08-10', '2025-09-12', false, 14, false),

('demo-bcbs-04', 'cml73pweg00003xtf8cuknu7y', 'cdae50a2-b762-42e5-a404-28f5002e0f9a',
 'approved', '2025-10-01', '2025-10-28', NULL, 'BCBS-10004', NULL,
 '2025-10-01', '2025-10-28', false, 14, false),

('demo-bcbs-05', 'bff8e187-5758-4cc4-b7ae-c88ab3de063b', 'cdae50a2-b762-42e5-a404-28f5002e0f9a',
 'denied', '2025-09-05', NULL, NULL, NULL, 'Missing NPI documentation',
 '2025-09-05', '2025-10-10', false, 14, false),

('demo-bcbs-06', 'e6c42d76-4d3d-4acc-806d-a8f167d949b4', 'cdae50a2-b762-42e5-a404-28f5002e0f9a',
 'in_progress', '2026-01-10', NULL, NULL, NULL, 'Application under review',
 '2026-01-10', '2026-01-25', false, 14, false),

-- ============================================================
-- AETNA (7): 3 approved, 3 denied, 1 pending_review
-- Profile: High denial rate (50%), slow (~58 days avg), difficult payer
-- Providers: all 7
-- ============================================================
('demo-aetna-01', '9369a1f9-0171-4ae6-a336-171877811eb5', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'approved', '2025-05-01', '2025-07-02', NULL, 'AET-20001', NULL,
 '2025-05-01', '2025-07-02', false, 14, false),

('demo-aetna-02', 'a6426728-a581-4d37-8c07-d078ee1b6862', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'approved', '2025-06-15', '2025-08-18', NULL, 'AET-20002', NULL,
 '2025-06-15', '2025-08-18', false, 14, false),

('demo-aetna-03', 'e6c42d76-4d3d-4acc-806d-a8f167d949b4', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'approved', '2025-08-01', '2025-09-25', NULL, 'AET-20003', NULL,
 '2025-08-01', '2025-09-25', false, 14, false),

('demo-aetna-04', 'e8233948-c5bf-4b88-b5d1-6521942ab41f', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'denied', '2025-07-10', NULL, NULL, NULL, 'Credentialing requirements not met',
 '2025-07-10', '2025-08-25', false, 14, false),

('demo-aetna-05', 'cml73pweg00003xtf8cuknu7y', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'denied', '2025-09-01', NULL, NULL, NULL, 'Incomplete application - missing malpractice proof',
 '2025-09-01', '2025-10-10', false, 14, false),

('demo-aetna-06', 'bff8e187-5758-4cc4-b7ae-c88ab3de063b', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'denied', '2025-11-01', NULL, NULL, NULL, 'Panel closed for specialty',
 '2025-11-01', '2025-12-05', false, 14, false),

('demo-aetna-07', 'f47e9ee8-cc0e-4195-b382-12a4eaeb5500', 'b74eb3f4-6338-4bb7-ba8c-4c8762f5d3a8',
 'pending_review', '2026-01-05', NULL, NULL, NULL, 'Awaiting committee review',
 '2026-01-05', '2026-01-20', false, 14, false),

-- ============================================================
-- CIGNA (6): 4 approved, 1 denied, 1 submitted
-- Profile: Fast approvals (~18 days avg), low denial, easiest payer
-- Providers: P1, P2, P3, P4, P5, P7 (not P6/Sheree — conflict)
-- ============================================================
('demo-cigna-01', '9369a1f9-0171-4ae6-a336-171877811eb5', 'cec0708d-4eb7-4b38-93e5-5f165481316b',
 'approved', '2025-06-01', '2025-06-15', NULL, 'CIG-30001', NULL,
 '2025-06-01', '2025-06-15', false, 14, false),

('demo-cigna-02', 'a6426728-a581-4d37-8c07-d078ee1b6862', 'cec0708d-4eb7-4b38-93e5-5f165481316b',
 'approved', '2025-07-10', '2025-07-28', NULL, 'CIG-30002', NULL,
 '2025-07-10', '2025-07-28', false, 14, false),

('demo-cigna-03', 'e8233948-c5bf-4b88-b5d1-6521942ab41f', 'cec0708d-4eb7-4b38-93e5-5f165481316b',
 'approved', '2025-08-20', '2025-09-08', NULL, 'CIG-30003', NULL,
 '2025-08-20', '2025-09-08', false, 14, false),

('demo-cigna-04', 'cml73pweg00003xtf8cuknu7y', 'cec0708d-4eb7-4b38-93e5-5f165481316b',
 'approved', '2025-10-05', '2025-10-22', NULL, 'CIG-30004', NULL,
 '2025-10-05', '2025-10-22', false, 14, false),

('demo-cigna-05', 'bff8e187-5758-4cc4-b7ae-c88ab3de063b', 'cec0708d-4eb7-4b38-93e5-5f165481316b',
 'denied', '2025-09-10', NULL, NULL, NULL, 'Duplicate application on file',
 '2025-09-10', '2025-09-25', false, 14, false),

('demo-cigna-06', 'e6c42d76-4d3d-4acc-806d-a8f167d949b4', 'cec0708d-4eb7-4b38-93e5-5f165481316b',
 'submitted', '2026-01-20', NULL, NULL, NULL, 'New application submitted',
 '2026-01-20', '2026-01-20', false, 14, false),

-- ============================================================
-- UNITEDHEALTHCARE (7): 4 approved, 2 denied, 1 in_progress (stuck >60 days)
-- Profile: Mixed results, stuck enrollment, moderate difficulty
-- Providers: all 7
-- ============================================================
('demo-uhc-01', '9369a1f9-0171-4ae6-a336-171877811eb5', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'approved', '2025-04-15', '2025-05-30', NULL, 'UHC-40001', NULL,
 '2025-04-15', '2025-05-30', false, 14, false),

('demo-uhc-02', 'a6426728-a581-4d37-8c07-d078ee1b6862', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'approved', '2025-05-20', '2025-06-25', NULL, 'UHC-40002', NULL,
 '2025-05-20', '2025-06-25', false, 14, false),

('demo-uhc-03', 'e8233948-c5bf-4b88-b5d1-6521942ab41f', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'approved', '2025-07-01', '2025-08-15', NULL, 'UHC-40003', NULL,
 '2025-07-01', '2025-08-15', false, 14, false),

('demo-uhc-04', 'cml73pweg00003xtf8cuknu7y', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'approved', '2025-09-10', '2025-10-20', NULL, 'UHC-40004', NULL,
 '2025-09-10', '2025-10-20', false, 14, false),

('demo-uhc-05', 'bff8e187-5758-4cc4-b7ae-c88ab3de063b', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'denied', '2025-06-10', NULL, NULL, NULL, 'Provider not eligible for network',
 '2025-06-10', '2025-07-20', false, 14, false),

('demo-uhc-06', 'f47e9ee8-cc0e-4195-b382-12a4eaeb5500', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'denied', '2025-10-05', NULL, NULL, NULL, 'Insufficient work history documentation',
 '2025-10-05', '2025-11-10', false, 14, false),

-- Stuck enrollment: in_progress since Oct 2025, last updated Nov 2025 (>60 days ago)
('demo-uhc-07', 'e6c42d76-4d3d-4acc-806d-a8f167d949b4', '0c85bc27-c872-4c53-9705-7b732454acb1',
 'in_progress', '2025-10-01', NULL, NULL, NULL, 'Waiting on credentialing committee — no response',
 '2025-10-01', '2025-11-05', false, 14, false),

-- ============================================================
-- MEDICARE (6): 5 approved, 0 denied, 1 in_progress
-- Profile: 100% approval of decided, slow (~50 days avg), very reliable
-- Providers: P1, P2, P3, P4, P5, P7 (not P6/Sheree — conflict)
-- ============================================================
('demo-medicare-01', '9369a1f9-0171-4ae6-a336-171877811eb5', '26c73692-d89e-475e-a3ae-9468a53e563e',
 'approved', '2025-03-01', '2025-04-25', NULL, 'MCR-50001', NULL,
 '2025-03-01', '2025-04-25', false, 14, false),

('demo-medicare-02', 'a6426728-a581-4d37-8c07-d078ee1b6862', '26c73692-d89e-475e-a3ae-9468a53e563e',
 'approved', '2025-04-15', '2025-06-05', NULL, 'MCR-50002', NULL,
 '2025-04-15', '2025-06-05', false, 14, false),

('demo-medicare-03', 'e8233948-c5bf-4b88-b5d1-6521942ab41f', '26c73692-d89e-475e-a3ae-9468a53e563e',
 'approved', '2025-06-01', '2025-07-20', NULL, 'MCR-50003', NULL,
 '2025-06-01', '2025-07-20', false, 14, false),

('demo-medicare-04', 'cml73pweg00003xtf8cuknu7y', '26c73692-d89e-475e-a3ae-9468a53e563e',
 'approved', '2025-07-10', '2025-09-01', NULL, 'MCR-50004', NULL,
 '2025-07-10', '2025-09-01', false, 14, false),

('demo-medicare-05', 'bff8e187-5758-4cc4-b7ae-c88ab3de063b', '26c73692-d89e-475e-a3ae-9468a53e563e',
 'approved', '2025-08-20', '2025-10-10', NULL, 'MCR-50005', NULL,
 '2025-08-20', '2025-10-10', false, 14, false),

('demo-medicare-06', 'e6c42d76-4d3d-4acc-806d-a8f167d949b4', '26c73692-d89e-475e-a3ae-9468a53e563e',
 'in_progress', '2026-01-20', NULL, NULL, NULL, 'PECOS enrollment processing',
 '2026-01-20', '2026-02-05', false, 14, false)

ON CONFLICT (id) DO NOTHING;
