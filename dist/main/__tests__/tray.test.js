"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const electronMocks = vitest_1.vi.hoisted(() => {
    const setImage = vitest_1.vi.fn();
    const setToolTip = vitest_1.vi.fn();
    const setContextMenu = vitest_1.vi.fn();
    const destroy = vitest_1.vi.fn();
    const createFromBitmap = vitest_1.vi.fn((_buffer, _options) => ({ isEmpty: () => false }));
    const buildFromTemplate = vitest_1.vi.fn((template) => template);
    const Tray = vitest_1.vi.fn(() => ({
        setImage,
        setToolTip,
        setContextMenu,
        on: vitest_1.vi.fn(),
        destroy,
    }));
    return { setImage, setToolTip, setContextMenu, destroy, createFromBitmap, buildFromTemplate, Tray };
});
vitest_1.vi.mock('electron', () => ({
    Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
    nativeImage: { createFromBitmap: electronMocks.createFromBitmap },
    Tray: electronMocks.Tray,
}));
const tray_1 = require("../tray");
let callbacks;
let onOpen;
let onToggleListening;
let onQuit;
function lastMenu() {
    const calls = electronMocks.buildFromTemplate.mock.calls;
    return calls[calls.length - 1][0] ?? [];
}
function menuItem(label) {
    const item = lastMenu().find(entry => entry.label === label);
    (0, vitest_1.expect)(item, `menu item "${label}" exists`).toBeDefined();
    return item;
}
function lastIconBuffer() {
    const calls = electronMocks.createFromBitmap.mock.calls;
    const last = calls[calls.length - 1];
    return (Array.isArray(last) ? last[0] : undefined);
}
(0, vitest_1.beforeEach)(() => {
    onOpen = vitest_1.vi.fn();
    onToggleListening = vitest_1.vi.fn();
    onQuit = vitest_1.vi.fn();
    callbacks = { onOpen, onToggleListening, onQuit };
    electronMocks.setImage.mockClear();
    electronMocks.setToolTip.mockClear();
    electronMocks.setContextMenu.mockClear();
    electronMocks.buildFromTemplate.mockClear();
    electronMocks.createFromBitmap.mockClear();
    electronMocks.destroy.mockClear();
    electronMocks.Tray.mockClear();
    (0, tray_1.createTray)(callbacks);
    // Reset the singleton's inputs so tests don't leak state into each other.
    (0, tray_1.updateTrayWakeState)('off', '');
    (0, tray_1.updateTrayAssistantActivity)(false);
});
(0, vitest_1.afterEach)(() => {
    (0, tray_1.destroyTray)();
});
(0, vitest_1.describe)('resolveTrayVisualState', () => {
    const cases = [
        ['off', false, 'off'],
        ['listening', false, 'listening'],
        ['triggered', false, 'processing'],
        ['listening', true, 'processing'],
        ['off', true, 'processing'],
        ['unavailable', false, 'unavailable'],
        ['unavailable', true, 'unavailable'], // never masked
    ];
    vitest_1.it.each(cases)('maps wake=%s busy=%s to %s', (wakeState, assistantBusy, expected) => {
        (0, vitest_1.expect)((0, tray_1.resolveTrayVisualState)(wakeState, assistantBusy)).toBe(expected);
    });
});
(0, vitest_1.describe)('createTray', () => {
    (0, vitest_1.it)('renders a non-blank glyph and initializes the off state', () => {
        (0, vitest_1.expect)(electronMocks.Tray).toHaveBeenCalledTimes(1);
        // The generated 16x16 bitmap must contain drawn pixels, not a blank canvas.
        const buffer = lastIconBuffer();
        let drawnPixels = 0;
        for (let i = 3; i < buffer.length; i += 4) {
            if (buffer[i] > 0)
                drawnPixels += 1;
        }
        (0, vitest_1.expect)(drawnPixels).toBeGreaterThan(50);
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenCalledWith('Kyclius — Background listening off');
    });
    (0, vitest_1.it)('returns false (no tray) when the platform has no tray support', () => {
        electronMocks.Tray.mockImplementationOnce(() => {
            throw new Error('no tray');
        });
        (0, vitest_1.expect)((0, tray_1.createTray)(callbacks)).toBe(false);
    });
});
(0, vitest_1.describe)('tray context menu', () => {
    (0, vitest_1.it)('exposes Open, Toggle background listening, and Quit', () => {
        const labels = lastMenu().map(item => item.label).filter(Boolean);
        (0, vitest_1.expect)(labels).toEqual(vitest_1.expect.arrayContaining(['Open Kyclius', 'Toggle background listening', 'Quit Kyclius']));
    });
    (0, vitest_1.it)('toggles with wake listening disabled by default', () => {
        const toggle = menuItem('Toggle background listening');
        (0, vitest_1.expect)(toggle.type).toBe('checkbox');
        (0, vitest_1.expect)(toggle.checked).toBe(false);
    });
    (0, vitest_1.it)('checks the toggle when background listening is on', () => {
        (0, tray_1.updateTrayWakeState)('listening', 'Hey Kyclius');
        (0, vitest_1.expect)(menuItem('Toggle background listening').checked).toBe(true);
    });
    (0, vitest_1.it)('routes the checkbox to the shared onToggleListening callback', () => {
        (0, tray_1.updateTrayWakeState)('listening', 'Hey Kyclius');
        const toggle = menuItem('Toggle background listening');
        // Simulate Electron unchecking the item (click delivers the inverse state).
        toggle.click?.({ checked: false });
        (0, vitest_1.expect)(onToggleListening).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(onToggleListening).toHaveBeenCalledWith(false);
    });
    (0, vitest_1.it)('routes Open Kyclius and Quit to their callbacks', () => {
        menuItem('Open Kyclius').click?.({});
        (0, vitest_1.expect)(onOpen).toHaveBeenCalledTimes(1);
        menuItem('Quit Kyclius').click?.({});
        (0, vitest_1.expect)(onQuit).toHaveBeenCalledTimes(1);
    });
});
(0, vitest_1.describe)('T-18 visual states', () => {
    (0, vitest_1.it)('flips the icon and tooltip when the wake listener starts', () => {
        const previousBuffer = lastIconBuffer();
        (0, tray_1.updateTrayWakeState)('listening', 'Hey Kyclius');
        (0, vitest_1.expect)(lastIconBuffer().equals(previousBuffer)).toBe(false);
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Listening for the wake word ("Hey Kyclius")');
        (0, vitest_1.expect)(menuItem('Toggle background listening').checked).toBe(true);
    });
    (0, vitest_1.it)('shows "processing" while the assistant is busy and reverts when idle', () => {
        (0, tray_1.updateTrayWakeState)('listening', 'Hey Kyclius');
        const listeningBuffer = lastIconBuffer();
        (0, tray_1.updateTrayAssistantActivity)(true);
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Processing a command ("Hey Kyclius")');
        // Distinct icon from listening — never the same bitmap for two states.
        (0, vitest_1.expect)(lastIconBuffer().equals(listeningBuffer)).toBe(false);
        // The setting itself is unchanged, so the menu checkbox stays checked.
        (0, vitest_1.expect)(menuItem('Toggle background listening').checked).toBe(true);
        (0, tray_1.updateTrayAssistantActivity)(false);
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Listening for the wake word ("Hey Kyclius")');
    });
    (0, vitest_1.it)('shows processing on wake trigger and reverts to listening afterwards', () => {
        (0, tray_1.updateTrayWakeState)('triggered', 'Hey Kyclius');
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Processing a command ("Hey Kyclius")');
        (0, tray_1.updateTrayWakeState)('listening', 'Hey Kyclius');
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Listening for the wake word ("Hey Kyclius")');
    });
    (0, vitest_1.it)('shows the danger state when the microphone is unavailable', () => {
        (0, tray_1.updateTrayWakeState)('unavailable', 'Hey Kyclius');
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Microphone unavailable ("Hey Kyclius")');
        // Unavailable wins even over an active command.
        (0, tray_1.updateTrayAssistantActivity)(true);
        (0, vitest_1.expect)(electronMocks.setToolTip).toHaveBeenLastCalledWith('Kyclius — Microphone unavailable ("Hey Kyclius")');
        // ...and it stays present, not a disabled switch.
        (0, vitest_1.expect)(menuItem('Toggle background listening').checked).toBe(true);
    });
});
(0, vitest_1.describe)('destroyTray', () => {
    (0, vitest_1.it)('destroys the native tray', () => {
        (0, tray_1.destroyTray)();
        (0, vitest_1.expect)(electronMocks.destroy).toHaveBeenCalledTimes(1);
    });
});
