import { describe, it, expect } from 'vitest';
import { ORCHESTRATOR_TOOLS } from './tool-schemas.js';

describe('ORCHESTRATOR_TOOLS', () => {
  it('exports exactly 10 tools', () => {
    expect(ORCHESTRATOR_TOOLS).toHaveLength(10);
  });

  it('each tool has name, description, and input_schema', () => {
    for (const tool of ORCHESTRATOR_TOOLS) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('has the expected tool names', () => {
    const names = ORCHESTRATOR_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'get_provider_profile',
      'get_payer_requirements',
      'check_credential_completeness',
      'dispatch_task',
      'request_human_approval',
      'get_workflow_state',
      'escalate_to_exception',
      'narrate',
      'populate_enrollment_forms',
      'search_knowledge_base',
    ]);
  });

  it('dispatch_task type enum is constrained to known types', () => {
    const dispatchTool = ORCHESTRATOR_TOOLS.find((t) => t.name === 'dispatch_task')!;
    const typeProperty = (dispatchTool.input_schema as any).properties.type;
    expect(typeProperty.enum).toEqual([
      'parse_document',
      'submit_to_portal',
      'check_readiness',
      'monitor_status',
    ]);
  });

  it('get_workflow_state has no required inputs', () => {
    const tool = ORCHESTRATOR_TOOLS.find((t) => t.name === 'get_workflow_state')!;
    const schema = tool.input_schema as any;
    expect(schema.required).toEqual([]);
    expect(Object.keys(schema.properties)).toHaveLength(0);
  });

  it('each tool with required fields lists them correctly', () => {
    const providerProfile = ORCHESTRATOR_TOOLS.find((t) => t.name === 'get_provider_profile')!;
    expect((providerProfile.input_schema as any).required).toEqual(['providerId']);

    const payerReqs = ORCHESTRATOR_TOOLS.find((t) => t.name === 'get_payer_requirements')!;
    expect((payerReqs.input_schema as any).required).toEqual(['payerId']);

    const completeness = ORCHESTRATOR_TOOLS.find((t) => t.name === 'check_credential_completeness')!;
    expect((completeness.input_schema as any).required).toEqual(['providerId', 'payerId']);

    const dispatch = ORCHESTRATOR_TOOLS.find((t) => t.name === 'dispatch_task')!;
    expect((dispatch.input_schema as any).required).toEqual(['type', 'input']);

    const approval = ORCHESTRATOR_TOOLS.find((t) => t.name === 'request_human_approval')!;
    expect((approval.input_schema as any).required).toEqual(['type', 'context']);

    const escalate = ORCHESTRATOR_TOOLS.find((t) => t.name === 'escalate_to_exception')!;
    expect((escalate.input_schema as any).required).toEqual(['issue']);

    const narrateTool = ORCHESTRATOR_TOOLS.find((t) => t.name === 'narrate')!;
    expect((narrateTool.input_schema as any).required).toEqual(['message']);

    const populate = ORCHESTRATOR_TOOLS.find((t) => t.name === 'populate_enrollment_forms')!;
    expect((populate.input_schema as any).required).toEqual(['enrollmentId']);
  });
});
