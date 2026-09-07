"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const planner_1 = require("../planner");
const confirmationQueue_1 = require("../../permissions/confirmationQueue");
const KNOWN_TOOLS = new Set(['read_file', 'send_email', 'create_file']);
(0, vitest_1.describe)('parsePlanResponse', () => {
    (0, vitest_1.it)('parses a plain JSON array of steps', () => {
        const { steps, warnings } = (0, planner_1.parsePlanResponse)(JSON.stringify([
            { tool: 'read_file', arguments: { path: 'a.txt' }, reason: 'inspect it' },
            { tool: 'send_email', arguments: { to: 'b@c' }, reason: 'report' },
        ]), KNOWN_TOOLS);
        (0, vitest_1.expect)(warnings).toHaveLength(0);
        (0, vitest_1.expect)(steps).toEqual([
            { toolName: 'read_file', arguments: { path: 'a.txt' }, reason: 'inspect it' },
            { toolName: 'send_email', arguments: { to: 'b@c' }, reason: 'report' },
        ]);
    });
    (0, vitest_1.it)('tolerates code fences and surrounding prose', () => {
        const content = [
            'Sure! Here is the plan:',
            '```json',
            JSON.stringify([{ tool: 'read_file', arguments: {}, reason: 'r' }]),
            '```',
            'Let me know if this works.',
        ].join('\n');
        (0, vitest_1.expect)((0, planner_1.parsePlanResponse)(content, KNOWN_TOOLS).steps).toHaveLength(1);
    });
    (0, vitest_1.it)('drops unknown tools into warnings instead of executing them blind', () => {
        const { steps, warnings } = (0, planner_1.parsePlanResponse)(JSON.stringify([
            { tool: 'format_disk', arguments: {}, reason: 'oops' },
            { tool: 'read_file', arguments: {}, reason: 'fine' },
        ]), KNOWN_TOOLS);
        (0, vitest_1.expect)(steps.map(s => s.toolName)).toEqual(['read_file']);
        (0, vitest_1.expect)(warnings[0]).toMatch(/format_disk.*not an available tool/);
    });
    (0, vitest_1.it)('throws a friendly error when nothing usable comes back', () => {
        (0, vitest_1.expect)(() => (0, planner_1.parsePlanResponse)('', KNOWN_TOOLS)).toThrow(planner_1.PlanGenerationError);
        (0, vitest_1.expect)(() => (0, planner_1.parsePlanResponse)('I cannot do that.', KNOWN_TOOLS)).toThrow(planner_1.PlanGenerationError);
        (0, vitest_1.expect)(() => (0, planner_1.parsePlanResponse)('[{oops', KNOWN_TOOLS)).toThrow(planner_1.PlanGenerationError);
        (0, vitest_1.expect)(() => (0, planner_1.parsePlanResponse)(JSON.stringify([{ tool: 'nope', arguments: {} }]), KNOWN_TOOLS)).toThrow(/No usable steps/);
    });
});
function makeDeps(overrides) {
    const storeRows = [];
    const executedTools = [];
    let releaseSlowStep;
    const slowStepGate = new Promise(resolve => {
        releaseSlowStep = resolve;
    });
    let slowStepStarted = false;
    const deps = {
        chatCompletion: async () => ({
            content: typeof overrides?.planContent === 'string'
                ? overrides.planContent
                : JSON.stringify(overrides?.planContent ?? []),
            tool_calls: null,
            finish_reason: 'stop',
        }),
        listTools: () => [
            { name: 'read_file', description: 'Reads a file', parameters: { type: 'object' } },
            { name: 'send_email', description: 'Sends email', parameters: { type: 'object' } },
        ],
        execute: async (toolName) => {
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
                    if (completedAt)
                        row.completedAt = completedAt;
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
async function makePlan(deps, goal = 'multi step goal') {
    return planner_1.planner.generatePlan(goal, 'conv-1');
}
function fourStepContent() {
    return JSON.stringify([1, 2, 3, 4].map(n => ({ tool: 'send_email', arguments: { n }, reason: `step ${n}` })));
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.restoreAllMocks();
});
(0, vitest_1.afterEach)(() => {
    (0, confirmationQueue_1.resetQueue)();
});
(0, vitest_1.describe)('planner.generatePlan', () => {
    (0, vitest_1.it)('persists the plan as status "planning" before anything executes', async () => {
        const { deps, storeRows } = makeDeps({ planContent: [{ tool: 'read_file', arguments: {}, reason: 'x' }] });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        (0, vitest_1.expect)(plan.steps.map(s => s.index)).toEqual([0]);
        (0, vitest_1.expect)(storeRows).toHaveLength(1);
        (0, vitest_1.expect)(storeRows[0].status).toBe('planning');
    });
    (0, vitest_1.it)('rejects an empty goal or an empty tool catalog', async () => {
        const { deps } = makeDeps();
        planner_1.planner.configure(deps);
        await (0, vitest_1.expect)(planner_1.planner.generatePlan('   ', 'c')).rejects.toThrow(planner_1.PlanGenerationError);
        await (0, vitest_1.expect)(planner_1.planner.generatePlan('goal', 'c')).rejects.toThrow(); // planContent [] -> parse failure
    });
});
(0, vitest_1.describe)('planner.runPlan', () => {
    (0, vitest_1.it)('executes every step through the injected pipeline and completes', async () => {
        const { deps, executedTools, storeRows } = makeDeps({
            planContent: [
                { tool: 'read_file', arguments: {}, reason: 'a' },
                { tool: 'send_email', arguments: {}, reason: 'b' },
            ],
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        deps.releaseSlowStep();
        const result = await planner_1.planner.runPlan(plan);
        (0, vitest_1.expect)(result.status).toBe('completed');
        (0, vitest_1.expect)(executedTools).toEqual(['read_file', 'send_email']);
        (0, vitest_1.expect)(storeRows.find(r => r.id === plan.planId)?.status).toBe('completed');
    });
    (0, vitest_1.it)('stops at max_plan_steps marking stopped_by_limit and reporting completed steps', async () => {
        const { deps, executedTools } = makeDeps({
            planContent: JSON.parse(fourStepContent()),
            limits: () => ({ maxPlanSteps: 2, maxPlanDurationMs: 60_000 }),
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        deps.releaseSlowStep();
        const result = await planner_1.planner.runPlan(plan);
        (0, vitest_1.expect)(result.status).toBe('stopped_by_limit');
        (0, vitest_1.expect)(result.reason).toMatch(/limit/i);
        (0, vitest_1.expect)(result.completedSteps.map(s => s.stepIndex)).toEqual([0, 1]);
        (0, vitest_1.expect)(result.remainingSteps).toBe(2);
        (0, vitest_1.expect)(executedTools).toHaveLength(2); // steps 3-4 never started
    });
    (0, vitest_1.it)('stops at the time limit marking stopped_by_limit', async () => {
        let clock = 0;
        const { deps } = makeDeps({
            planContent: JSON.parse(fourStepContent()),
            limits: () => ({ maxPlanSteps: 10, maxPlanDurationMs: 50_000 }),
            execute: async (_toolName) => {
                clock += 40_000; // each step burns 40s
                return { success: true };
            },
            now: () => clock,
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        const result = await planner_1.planner.runPlan(plan);
        // Step boundaries at t=40s (ok), t=80s (>= 50s limit -> stop): 2 completed.
        (0, vitest_1.expect)(result.status).toBe('stopped_by_limit');
        (0, vitest_1.expect)(result.reason).toMatch(/time limit/i);
        (0, vitest_1.expect)(result.completedSteps).toHaveLength(2);
    });
    (0, vitest_1.it)('supports cancelling mid-run; already-finished steps are kept', async () => {
        const { deps, executedTools } = makeDeps({
            // Step 0 parks on the controllable gate so we can cancel mid-flight.
            planContent: [
                { tool: 'read_file', arguments: {}, reason: 'parks on the gate' },
                ...JSON.parse(fourStepContent()),
            ],
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        const runPromise = planner_1.planner.runPlan(plan);
        // Wait until step 0 is parked mid-execution (started, gate unreleased).
        await vitest_1.vi.waitFor(() => (0, vitest_1.expect)(deps.slowStepStarted()).toBe(true));
        (0, vitest_1.expect)(planner_1.planner.isPlanRunning()).toBe(true);
        (0, vitest_1.expect)(planner_1.planner.cancelActivePlan()).toBe(true);
        deps.releaseSlowStep();
        const result = await runPromise;
        (0, vitest_1.expect)(result.status).toBe('stopped_by_user');
        (0, vitest_1.expect)(result.completedSteps.map(s => s.stepIndex)).toEqual([0]);
        (0, vitest_1.expect)(result.remainingSteps).toBe(4);
        (0, vitest_1.expect)(executedTools).toEqual(['read_file']); // cancelled before step 1
    });
    (0, vitest_1.it)('unwinds a confirmation-paused step when cancelled (voice "stop")', async () => {
        const { deps } = makeDeps({
            planContent: [{ tool: 'delete_file', arguments: {}, reason: 'needs approval' }],
            listTools: () => [{ name: 'delete_file', description: '', parameters: { type: 'object' } }],
            execute: async () => {
                // Simulate the real gate pausing on a pending confirmation.
                const { confirmation, response } = (0, confirmationQueue_1.enqueueConfirmation)({
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
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        const runPromise = planner_1.planner.runPlan(plan);
        // Give the event loop a beat so the fake execute has enqueued its
        // confirmation and is parked awaiting a response.
        await new Promise(resolve => setImmediate(resolve));
        planner_1.planner.cancelActivePlan('Stopped by voice command.');
        const result = await runPromise;
        (0, vitest_1.expect)(result.status).toBe('stopped_by_user');
        (0, vitest_1.expect)(result.completedSteps[0]?.status).toBe('denied');
    });
    (0, vitest_1.it)('marks the plan failed when a step fails, without running later steps', async () => {
        const { deps, executedTools } = makeDeps({
            planContent: [
                { tool: 'send_email', arguments: {}, reason: 'will fail' },
                { tool: 'read_file', arguments: {}, reason: 'never runs' },
            ],
            execute: async (toolName) => {
                executedTools.push(toolName);
                return toolName === 'send_email' ? { success: false, error: 'smtp exploded' } : { success: true };
            },
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        const result = await planner_1.planner.runPlan(plan);
        (0, vitest_1.expect)(result.status).toBe('failed');
        (0, vitest_1.expect)(result.reason).toMatch(/Failed at step 1/);
        (0, vitest_1.expect)(executedTools).toEqual(['send_email']);
    });
    (0, vitest_1.it)('refuses to start while another plan is running', async () => {
        const { deps } = makeDeps({
            planContent: JSON.parse(fourStepContent()),
        });
        planner_1.planner.configure(deps);
        const first = await makePlan(deps);
        const second = await makePlan(deps);
        const runPromise = planner_1.planner.runPlan(first);
        await (0, vitest_1.expect)(planner_1.planner.runPlan(second)).rejects.toThrow(/already running/);
        deps.releaseSlowStep();
        await runPromise;
    });
    (0, vitest_1.it)('treats a crashing tool as a failed step instead of wedging the runner', async () => {
        const { deps, storeRows } = makeDeps({
            planContent: [{ tool: 'send_email', arguments: {}, reason: 'crashes' }],
            execute: async () => {
                throw new Error('handler detonated');
            },
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        const result = await planner_1.planner.runPlan(plan);
        (0, vitest_1.expect)(result.status).toBe('failed');
        (0, vitest_1.expect)(planner_1.planner.isPlanRunning()).toBe(false);
        (0, vitest_1.expect)(storeRows.find(r => r.id === plan.planId)?.status).toBe('failed');
    });
    (0, vitest_1.it)('EF-10: aborts an in-flight hung step at the plan time ceiling (stopped_by_limit)', async () => {
        const { deps } = makeDeps({
            planContent: [{ tool: 'send_email', arguments: {}, reason: 'hangs' }],
            // Never resolves on its own — the ceiling must interrupt it.
            execute: async () => new Promise(() => { }),
            limits: () => ({ maxPlanSteps: 10, maxPlanDurationMs: 40 }),
            now: () => Date.now(),
        });
        planner_1.planner.configure(deps);
        const plan = await makePlan(deps);
        const start = Date.now();
        const result = await planner_1.planner.runPlan(plan);
        (0, vitest_1.expect)(result.status).toBe('stopped_by_limit');
        (0, vitest_1.expect)(result.reason).toMatch(/time limit/i);
        (0, vitest_1.expect)(planner_1.planner.isPlanRunning()).toBe(false);
        // Bounded well below any "frozen app" duration.
        (0, vitest_1.expect)(Date.now() - start).toBeLessThan(5000);
    });
});
