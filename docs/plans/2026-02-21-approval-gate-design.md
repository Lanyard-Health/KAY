# Approval Gate Design

## Goal

Complete the human-in-the-loop approval circuit for autonomous credentialing agents. When the orchestrator needs human authorization (e.g., before submitting a payer application), staff see the request on the Agent Dashboard, review context, and approve or deny. Expired requests are auto-denied after 48 hours.

## Architecture

Worker-driven lifecycle with REST API for CRUD and WebSocket for real-time frontend updates. The approval BullMQ worker schedules delayed expiry jobs. The REST API lets staff list and decide approvals. `notifyTaskCompletion` resumes the orchestrator after decisions.

**Resume behavior:** After approval, `notifyTaskCompletion` enqueues a `task_callback` on the orchestrator queue. The orchestrator loads the workflow's current state and resumes from the exact paused step.

## Data Flow

```
Orchestrator calls request_human_approval
  -> approval.service.requestApproval() creates PendingApproval
  -> pauses workflow (status: waiting_approval)
  -> emits WebSocket event approval:requested
  -> approval worker schedules delayed expiry job (48h default)

Staff sees approval on Dashboard Approvals tab -> clicks Approve/Deny
  -> POST /api/v1/agent/approvals/:id/decide
  -> approval.service.decideApproval() updates record (stores userId + timestamp)
  -> notifyTaskCompletion() re-enqueues orchestrator
  -> emits WebSocket event approval:decided

If no action before expiresAt:
  -> delayed BullMQ job fires
  -> auto-denies approval (decidedBy: null, notes: 'Auto-denied: expired')
  -> notifyTaskCompletion(task_failed)
  -> emits WebSocket event approval:expired
```

## Backend

### REST API (agent.routes.ts)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/agent/approvals` | List approvals (optional `?status=pending`) |
| GET | `/api/v1/agent/approvals/:id` | Get single approval with context |
| POST | `/api/v1/agent/approvals/:id/decide` | Approve or deny (`{ decision, notes? }`) |

All restricted to admin / credentialing_staff / practice_admin.

### Approval Worker (approval-agent.ts)

- Receives job when approval is created
- Schedules a delayed expiry-check job (`expiresAt - now` ms)
- Expiry check: if still pending, auto-deny + notify orchestrator + emit WebSocket

### Service Changes (approval.service.ts)

- `decideApproval`: Add `notifyTaskCompletion(workflowId, taskId, 'task_completed'|'task_failed')` after updating the record
- Emit `approval:decided` WebSocket event on decision
- Default expiry: 48 hours

### Audit

The existing `PendingApproval` model already stores `decidedBy` (userId) and `decidedAt`. The REST endpoint passes `req.user.id` as the decider. Agent event logging captures the decision in the workflow event trail.

## Frontend

### Approvals Tab (Agent Dashboard)

New tab on the existing Agent Dashboard page:
- Table columns: checkbox (batch-ready), type, provider/payer context, requested date, expires date, status
- Checkbox column with select-all header (no bulk actions yet - future use)
- Click row -> slide-out detail panel with full approval context + approve/deny buttons
- Badge on tab showing pending count
- Real-time updates via WebSocket (invalidate React Query on approval events)

### Hooks (useApprovals.ts)

- `useApprovals(status?)` - fetch list
- `useApprovalDetail(id)` - fetch single
- `useDecideApproval()` - mutation for approve/deny
- WebSocket listener to invalidate queries on approval events

## Files

| Action | File |
|--------|------|
| Create | `src/agents/approval/approval-agent.ts` |
| Create | `src/agents/approval/approval-agent.test.ts` |
| Create | `src/agents/approval/types.ts` |
| Modify | `src/agents/approval.service.ts` (add notifyTaskCompletion + WebSocket events) |
| Modify | `src/agents/approval.service.test.ts` (update tests) |
| Modify | `src/agents/workers.ts` (wire real approval processor) |
| Modify | `src/agents/workers.test.ts` (add approval mock) |
| Modify | `src/routes/agent.routes.ts` (add 3 approval endpoints) |
| Create | `frontend: src/features/agents/components/ApprovalsTab.tsx` |
| Create | `frontend: src/features/agents/hooks/useApprovals.ts` |
| Modify | `frontend: Agent Dashboard page` (add Approvals tab) |
