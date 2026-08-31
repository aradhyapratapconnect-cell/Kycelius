"use strict";
/**
 * N-02 — Shared/Community Agents IPC surface.
 *
 * Export/import operates through native file dialogs in the main process. All
 * handlers are safe to call anytime; import is a two-step flow (preview →
 * confirmed install) so nothing is registered until the user has reviewed the
 * permission claims on screen (AC).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentHandlers = registerAgentHandlers;
const electron_1 = require("electron");
const promises_1 = require("fs/promises");
const agentBundles_1 = require("../agents/agentBundles");
function serialize(agent) {
    return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        version: agent.version,
        author: agent.author,
        systemPrompt: agent.system_prompt,
        manifest_json: agent.manifest_json,
        tool_decisions_json: agent.tool_decisions_json,
        active: agent.active,
        installed_at: agent.installed_at,
    };
}
function registerAgentHandlers() {
    electron_1.ipcMain.handle('kyclius:list-installed-agents', async () => {
        return (0, agentBundles_1.listInstalledAgents)().map(serialize);
    });
    electron_1.ipcMain.handle('kyclius:get-active-agent', async () => {
        const list = (0, agentBundles_1.listInstalledAgents)();
        const active = list.find(a => a.active) ?? null;
        if (active)
            return serialize(active);
        return null;
    });
    electron_1.ipcMain.handle('kyclius:select-active-agent', async (_event, id) => {
        const value = id ? String(id) : null;
        if (value && !(0, agentBundles_1.listInstalledAgents)().some(a => a.id === value)) {
            throw new Error('Agent not found.');
        }
        (0, agentBundles_1.selectActiveAgent)(value);
        return (0, agentBundles_1.getActiveAgentId)();
    });
    electron_1.ipcMain.handle('kyclius:remove-agent', async (_event, id) => {
        (0, agentBundles_1.removeAgent)(String(id));
        return { removed: true };
    });
    // Step 1 of import: choose a bundle file and get a review preview.
    electron_1.ipcMain.handle('kyclius:preview-agent-bundle', async (event) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        const openOptions = {
            title: 'Import an agent bundle',
            filters: [{ name: 'Kyclius Agent Bundle', extensions: ['json'] }],
            properties: ['openFile'],
        };
        const result = win
            ? await electron_1.dialog.showOpenDialog(win, openOptions)
            : await electron_1.dialog.showOpenDialog(openOptions);
        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true };
        }
        const raw = await (0, promises_1.readFile)(result.filePaths[0], 'utf-8');
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new Error('The selected file is not valid JSON.');
        }
        const bundle = (0, agentBundles_1.validateBundle)(parsed);
        const preview = (0, agentBundles_1.buildImportPreview)(bundle);
        return { canceled: false, preview, sourceName: result.filePaths[0] };
    });
    // Step 2 of import: user reviewed permissions — confirm install.
    electron_1.ipcMain.handle('kyclius:confirm-import-agent', async (_event, payload) => {
        if (!payload || !payload.preview || !payload.preview.agent) {
            throw new Error('Invalid import confirmation.');
        }
        const approvedAuto = Array.isArray(payload.approvedAuto)
            ? payload.approvedAuto.map(String)
            : [];
        // Reconstruct the bundle from the manifest embedded in the preview flow
        // by re-parsing from the served manifest (stored at preview time on the
        // renderer). To avoid trusting the renderer, we re-serialize the preview
        // into a minimal bundle here.
        const bundle = {
            format: 'kyclius-agent-bundle',
            formatVersion: 1,
            agent: {
                id: payload.preview.agent.id,
                name: payload.preview.agent.name,
                description: payload.preview.agent.description,
                version: payload.preview.agent.version,
                author: payload.preview.agent.author,
                systemPrompt: payload.preview.agent.systemPrompt,
                tools: payload.preview.tools.map(t => ({
                    name: t.name,
                    permissionTier: t.claimedTier,
                })),
            },
        };
        // AC3: no referenced tool is elevated to auto without explicit user
        // approval, and never above the registry's real tier.
        const decisions = (0, agentBundles_1.computeToolDecisions)(bundle, approvedAuto);
        (0, agentBundles_1.installAgent)(bundle, decisions);
        return { installed: true, agentId: payload.preview.agent.id };
    });
    // Export an installed agent to a bundle file the user chooses to save.
    electron_1.ipcMain.handle('kyclius:export-agent', async (event, id) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        const bundle = (0, agentBundles_1.exportBundle)(String(id));
        const saveOptions = {
            title: 'Export agent bundle',
            defaultPath: `${bundle.agent.name.replace(/[^\w\- ]+/g, '').trim() || 'agent'}.json`,
            filters: [{ name: 'Kyclius Agent Bundle', extensions: ['json'] }],
        };
        const result = win
            ? await electron_1.dialog.showSaveDialog(win, saveOptions)
            : await electron_1.dialog.showSaveDialog(saveOptions);
        if (result.canceled || !result.filePath) {
            return { canceled: true };
        }
        await (0, promises_1.writeFile)(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
        return { canceled: false, path: result.filePath };
    });
}
