import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlanGenerationError,
  parsePlanResponse,
  planner,
  type GeneratedPlan,
  type PlannerDeps,
} from '../planner';
import { enqueueConfirmation, resetQueue } from '../../permissions/confirmationQueue';

const KNOWN_TOOLS = new Set(['read_file', 'send_email', 'create_file']);

describe('parsePlanResponse', () => {
  it('parses a plain JSON array of steps', () => {
    const { steps, warnings } = parsePlanResponse(
      JSON.stringify([
        { tool: 'read_file', arguments: { path: 'a.txt' }, reason: 'inspect it' },
        { tool: 'send_email', arguments: { to: 'b@c' }, reason: 'report' },
      ]),
      KNOWN_TOOLS
    );
    expect(warnings).toHaveLength(0);
    expect(steps).toEqual([
      { toolName: 'read_file', arguments: { path: 'a.txt' }, reason: 'inspect it' },
      { toolName: 'send_email', arguments: { to: 'b@c' }, reason: 'report' },
    ]);
  });

  it('tolerates code fences and surrounding prose', () => {
    const content = [
      'Sure! Here is the plan:',
      '```json',
      JSON.stringify([{ tool: 'read_file', arguments: {}, reason: 'r' }]),
      '```',
      'Let me know if this works.',
    ].join('\n');
    expect(parsePlanResponse(content, KNOWN_TOOLS).steps).toHaveLength(1);
  });

  it('drops unknown tools into warnings instead of executing them blind', () => {
    const { steps, warnings } = parsePlanResponse(
      JSON.stringify([
        { tool: 'format_disk', arguments: {}, reason: 'oops' },
        { tool: 'read_file', arguments: {}, reason: 'fine' },
      ]),
      KNOWN_TOOLS
    );
    expect(steps.map(s => s.toolName)).toEqual(['read_file']);
    expect(warnings[0]).toMatch(/format_disk.*not an available tool/);
  });

  it('throws a friendly error when nothing usable comes back', () => {
    expect(() => parsePlanResponse('', KNOWN_TOOLS)).toThrow(PlanGenerationError);
    expect(() => parsePlanResponse('I cannot do that.', KNOWN_TOOLS)).toThrow(PlanGenerationError);
    expect(() => parsePlanResponse('[{oops', KNOWN_TOOLS)).toThrow(PlanGenerationError);
    expect(() =>
      parsePlanResponse(JSON.stringify([{ tool: 'nope', arguments: {} }]), KNOWN_TOOLS)
    ).toThrow(/No usable steps/);
  });
});

function makeDeps(overrides?: Partial<PlannerDeps> & { planContent?: unknown }) {
  const storeRows: Array<{ id: string; status: string; completedAt?: string }> = [];
  const executedTools: string[] = [];

  let releaseSlowStep!: () => void;
  const slowStepGate = new Promise<void>(resolve => {
    releaseSlowStep = resolve;
  });
  let slowStepStarted = false;

  const deps: PlannerDeps & {
    releaseSlowStep: () => void;
    slowStepGate: Promise<void>;
    slowStepStarted: () => boolean;
  } = {
    chatCompletion: async () => ({
      content:
        typeof overrides?.planContent === 'string'
          ? (overrides.planContent as string)
          : JSON.stringify(overrides?.planContent ?? []),
      tool_calls: null,
      finish_reason: 'stop',
    }),
    listTools: () => [
      { name: 'read_file', description: 'Reads a file', parameters: { type: 'object' } },
      { name: 'send_email', description: 'Sends email', parameters: { type: 'object' } },
    ],
    execute: async toolName => {
      if (toolName === 'read_file') {
        slowStepStarted = true;
        await slowStepGate; // controllable pause mid-execution
      }
      executedTools.push(toolName);
      return { success: true, result: `${toolName} done` };
    },
    plans: {
      create: plan => {
        storeRows.push({ id: plan.id, status: plan.status });
        return { id: plan.id };
      },
      updateStatus: (id, status, completedAt) => {
        const row = storeRows.find(r => r.id === id);
        if (row) {
          row.status = status;
          if (completedAt) row.completedAt = completedAt;
        }
      },
    },
    limits: () => ({ maxPlanSteps: 10, maxPlanDurationMs: 60_000 }),
    now: () => 0,
    releaseSlowStep,
    slowStepGate,
    slowStepStarted: () => slowStepStarted,
    ...overrides,
  };
  return { deps, storeRows, executedTools };
}

async function makePlan(deps: PlannerDeps, goal = 'multi step goal'): Promise<GeneratedPlan> {
  return planner.generatePlan(
    goal,
    'conv-1',
    // chatCompletion returns whatever planContent the deps carry.
  );
}

function fourStepContent(): string {
  return JSON.stringify(
    [1, 2, 3, 4].map(n => ({ tool: 'send_email', arguments: { n }, reason: `step ${n}` }))
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  resetQueue();
});

describe('planner.generatePlan', () => {
  it('persists the plan as status "planning" before anything executes', async () => {
    const { deps, storeRows } = makeDeps({ planContent: [{ tool: 'read_file', arguments: {}, reason: 'x' }] });
    planner.configure(deps);

    const plan = await makePlan(deps);

    expect(plan.steps.map(s => s.index)).toEqual([0]);
    expect(storeRows).toHaveLength(1);
    expect(storeRows[0].status).toBe('planning');
  });

  it('rejects an empty goal or an empty tool catalog', async () => {
    const { deps } = makeDeps();
    planner.configure(deps);

    await expect(planner.generatePlan('   ', 'c')).rejects.toThrow(PlanGenerationError);
    await expect(
      planner.generatePlan('goal', 'c')
    ).rejects.toThrow(); // planContent [] -> parse failure
  });
});

describe('planner.runPlan', () => {
  it('executes every step through the injected pipeline and completes', async () => {
    const { deps, executedTools, storeRows } = makeDeps({
      planContent: [
        { tool: 'read_file', arguments: {}, reason: 'a' },
        { tool: 'send_email', arguments: {}, reason: 'b' },
      ],
    });
    planner.configure(deps);
    const plan = await makePlan(deps);
    deps.releaseSlowStep();

    const result = await planner.runPlan(plan);

    expect(result.status).toBe('completed');
    expect(executedTools).toEqual(['read_file', 'send_email']);
    expect(storeRows.find(r => r.id === plan.planId)?.status).toBe('completed');
  });

  it('stops at max_plan_steps marking stopped_by_limit and reporting completed steps', async () => {
    const { deps, executedTools } = makeDeps({
      planContent: JSON.parse(fourStepContent()),
      limits: () => ({ maxPlanSteps: 2, maxPlanDurationMs: 60_000 }),
    });
    planner.configure(deps);
    const plan = await makePlan(deps);
    deps.releaseSlowStep();

    const result = await planner.runPlan(plan);

    expect(result.status).toBe('stopped_by_limit');
    expect(result.reason).toMatch(/limit/i);
    expect(result.completedSteps.map(s => s.stepIndex)).toEqual([0, 1]);
    expect(result.remainingSteps).toBe(2);
    expect(executedTools).toHaveLength(2); // steps 3-4 never started
  });

  it('stops at the time limit marking stopped_by_limit', async () => {
    let clock = 0;
    const { deps } = makeDeps({
      planContent: JSON.parse(fourStepContent()),
      limits: () => ({ maxPlanSteps: 10, maxPlanDurationMs: 50_000 }),
      execute: async _toolName => {
        clock += 40_000; // each step burns 40s
        return { success: true };
      },
      now: () => clock,
    });
    planner.configure(deps);
    const plan = await makePlan(deps);

    const result = await planner.runPlan(plan);

    // Step boundaries at t=40s (ok), t=80s (>= 50s limit -> stop): 2 completed.
    expect(result.status).toBe('stopped_by_limit');
    expect(result.reason).toMatch(/time limit/i);
    expect(result.completedSteps).toHaveLength(2);
  });

  it('supports cancelling mid-run; already-finished steps are kept', async () => {
    const { deps, executedTools } = makeDeps({
      // Step 0 parks on the controllable gate so we can cancel mid-flight.
      planContent: [
        { tool: 'read_file', arguments: {}, reason: 'parks on the gate' },
        ...JSON.parse(fourStepContent()),
      ],
    });
    planner.configure(deps);
    const plan = await makePlan(deps);

    const runPromise = planner.runPlan(plan);
    // Wait until step 0 is parked mid-execution (started, gate unreleased).
    await vi.waitFor(() => expect(deps.slowStepStarted()).toBe(true));

    expect(planner.isPlanRunning()).toBe(true);
    expect(planner.cancelActivePlan()).toBe(true);
    deps.releaseSlowStep();

    const result = await runPromise;

    expect(result.status).toBe('stopped_by_user');
    expect(result.completedSteps.map(s => s.stepIndex)).toEqual([0]);
    expect(result.remainingSteps).toBe(4);
    expect(executedTools).toEqual(['read_file']); // cancelled before step 1
  });

  it('unwinds a confirmation-paused step when cancelled (voice "stop")', async () => {
    const { deps } = makeDeps({
      planContent: [{ tool: 'delete_file', arguments: {}, reason: 'needs approval' }],
      listTools: () => [{ name: 'delete_file', description: '', parameters: { type: 'object' } }],
      execute: async () => {
        // Simulate the real gate pausing on a pending confirmation.
        const { confirmation, response } = enqueueConfirmation({
          id: 'paused-step',
          toolName: 'delete_file',
          parameters: {},
        });
        void confirmation;
        const resolved = await response;
        return resolved.action === 'approve'
          ? { success: true }
          : { success: false, error: `Tool "delete_file" was not approved: ${resolved.reason ?? ''}` };
      },
    });
    planner.configure(deps);
    const plan = await makePlan(deps);

    const runPromise = planner.runPlan(plan);
    // Give the event loop a beat so the fake execute has enqueued its
    // confirmation and is parked awaiting a response.
    await new Promise(resolve => setImmediate(resolve));

    planner.cancelActivePlan('Stopped by voice command.');

    const result = await runPromise;
    expect(result.status).toBe('stopped_by_user');
    expect(result.completedSteps[0]?.status).toBe('denied');
  });

  it('marks the plan failed when a step fails, without running later steps', async () => {
    const { deps, executedTools } = makeDeps({
      planContent: [
        { tool: 'send_email', arguments: {}, reason: 'will fail' },
        { tool: 'read_file', arguments: {}, reason: 'never runs' },
      ],
      execute: async toolName => {
        executedTools.push(toolName);
        return toolName === 'send_email' ? { success: false, error: 'smtp exploded' } : { success: true };
      },
    });
    planner.configure(deps);
    const plan = await makePlan(deps);

    const result = await planner.runPlan(plan);

    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/Failed at step 1/);
    expect(executedTools).toEqual(['send_email']);
  });

  it('refuses to start while another plan is running', async () => {
    const { deps } = makeDeps({
      planContent: JSON.parse(fourStepContent()),
    });
    planner.configure(deps);
    const first = await makePlan(deps);
    const second = await makePlan(deps);

    const runPromise = planner.runPlan(first);
    await expect(planner.runPlan(second)).rejects.toThrow(/already running/);

    deps.releaseSlowStep();
    await runPromise;
  });

  it('treats a crashing tool as a failed step instead of wedging the runner', async () => {
    const { deps, storeRows } = makeDeps({
      planContent: [{ tool: 'send_email', arguments: {}, reason: 'crashes' }],
      execute: async () => {
        throw new Error('handler detonated');
      },
    });
    planner.configure(deps);
    const plan = await makePlan(deps);

    const result = await planner.runPlan(plan);

    expect(result.status).toBe('failed');
    expect(planner.isPlanRunning()).toBe(false);
    expect(storeRows.find(r => r.id === plan.planId)?.status).toBe('failed');
  });
});
