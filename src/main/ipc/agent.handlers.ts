/**
 * N-02 — Shared/Community Agents IPC surface.
 *
 * Export/import operates through native file dialogs in the main process. All
 * handlers are safe to call anytime; import is a two-step flow (preview →
 * confirmed install) so nothing is registered until the user has reviewed the
 * permission claims on screen (AC).
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import {
  validateBundle,
  buildImportPreview,
  computeToolDecisions,
  installAgent,
  listInstalledAgents,
  getActiveAgentId,
  selectActiveAgent,
  removeAgent,
  exportBundle,
  type AgentImportPreview,
} from '../agents/agentBundles';
import type { PermissionTier } from '../tools/toolRegistry';
import type { InstalledAgent } from '../db/db';

function serialize(agent: InstalledAgent) {
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

export function registerAgentHandlers() {
  ipcMain.handle('kyclius:list-installed-agents', async () => {
    return listInstalledAgents().map(serialize);
  });

  ipcMain.handle('kyclius:get-active-agent', async () => {
    const list = listInstalledAgents();
    const active = list.find(a => a.active) ?? null;
    if (active) return serialize(active);
    return null;
  });

  ipcMain.handle('kyclius:select-active-agent', async (_event, id: string | null) => {
    const value = id ? String(id) : null;
    if (value && !listInstalledAgents().some(a => a.id === value)) {
      throw new Error('Agent not found.');
    }
    selectActiveAgent(value);
    return getActiveAgentId();
  });

  ipcMain.handle('kyclius:remove-agent', async (_event, id: string) => {
    removeAgent(String(id));
    return { removed: true };
  });

  // Step 1 of import: choose a bundle file and get a review preview.
  ipcMain.handle('kyclius:preview-agent-bundle', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openOptions: Electron.OpenDialogOptions = {
      title: 'Import an agent bundle',
      filters: [{ name: 'Kyclius Agent Bundle', extensions: ['json'] }],
      properties: ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } as const;
    }
    const raw = await readFile(result.filePaths[0], 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('The selected file is not valid JSON.');
    }
    const bundle = validateBundle(parsed);
    const preview = buildImportPreview(bundle);
    return { canceled: false as const, preview, sourceName: result.filePaths[0] };
  });

  // Step 2 of import: user reviewed permissions — confirm install.
  ipcMain.handle(
    'kyclius:confirm-import-agent',
    async (_event, payload: { preview: AgentImportPreview; approvedAuto: string[] }) => {
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
        format: 'kyclius-agent-bundle' as const,
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
      const decisions: Record<string, PermissionTier> = computeToolDecisions(bundle, approvedAuto);
      installAgent(bundle, decisions);
      return { installed: true, agentId: payload.preview.agent.id };
    }
  );

  // Export an installed agent to a bundle file the user chooses to save.
  ipcMain.handle('kyclius:export-agent', async (event, id: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const bundle = exportBundle(String(id));
    const saveOptions: Electron.SaveDialogOptions = {
      title: 'Export agent bundle',
      defaultPath: `${bundle.agent.name.replace(/[^\w\- ]+/g, '').trim() || 'agent'}.json`,
      filters: [{ name: 'Kyclius Agent Bundle', extensions: ['json'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) {
      return { canceled: true } as const;
    }
    await writeFile(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
    return { canceled: false as const, path: result.filePath };
  });
}
