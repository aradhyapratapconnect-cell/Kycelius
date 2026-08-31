"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const toolRegistry_1 = require("./toolRegistry");
(0, toolRegistry_1.registerTool)({
    name: 'test_auto_tool',
    description: 'A test tool that runs automatically without confirmation',
    parameters: {
        type: 'object',
        properties: {
            message: { type: 'string', description: 'Message to echo back' },
        },
        required: ['message'],
    },
    permissionTier: 'auto',
    handler: async (params) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, result: `Auto tool executed: ${params.message}` };
    },
});
(0, toolRegistry_1.registerTool)({
    name: 'test_confirm_tool',
    description: 'A test tool that requires confirmation',
    parameters: {
        type: 'object',
        properties: {
            action: { type: 'string', description: 'Action to perform' },
            value: { type: 'number', description: 'Numeric value' },
        },
        required: ['action', 'value'],
    },
    permissionTier: 'confirm_required',
    handler: async (params) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, result: `Confirm tool executed: ${params.action} with value ${params.value}` };
    },
});
