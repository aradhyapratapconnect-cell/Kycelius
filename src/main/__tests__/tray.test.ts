import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const setImage = vi.fn();
  const setToolTip = vi.fn();
  const setContextMenu = vi.fn();
  const destroy = vi.fn();
  const createFromBitmap = vi.fn(
    (_buffer: Buffer, _options: { width: number; height: number }) => ({ isEmpty: () => false })
  );
  const buildFromTemplate = vi.fn((template: unknown) => template);
  const Tray = vi.fn(() => ({
    setImage,
    setToolTip,
    setContextMenu,
    on: vi.fn(),
    destroy,
  }));
  return { setImage, setToolTip, setContextMenu, destroy, createFromBitmap, buildFromTemplate, Tray };
});

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
  nativeImage: { createFromBitmap: electronMocks.createFromBitmap },
  Tray: electronMocks.Tray,
}));

import {
  createTray,
  destroyTray,
  resolveTrayVisualState,
  updateTrayAssistantActivity,
  updateTrayWakeState,
  type TrayCallbacks,
} from '../tray';
import type { WakeListeningState } from '../voice/wakeWordService';

let callbacks: TrayCallbacks;
let onOpen: Mock;
let onToggleListening: Mock;
let onQuit: Mock;

interface MenuItemTestShape {
  label?: string;
  type?: string;
  checked?: boolean;
  click?: (menuItem: { checked?: boolean }) => void;
}

function lastMenu(): MenuItemTestShape[] {
  const calls = electronMocks.buildFromTemplate.mock.calls;
  return (calls[calls.length - 1][0] as MenuItemTestShape[]) ?? [];
}

function menuItem(label: string): MenuItemTestShape {
  const item = lastMenu().find(entry => entry.label === label);
  expect(item, `menu item "${label}" exists`).toBeDefined();
  return item!;
}

function lastIconBuffer(): Buffer {
  const calls = electronMocks.createFromBitmap.mock.calls;
  const last = calls[calls.length - 1];
  return (Array.isArray(last) ? last[0] : undefined) as unknown as Buffer;
}

beforeEach(() => {
  onOpen = vi.fn();
  onToggleListening = vi.fn();
  onQuit = vi.fn();
  callbacks = { onOpen, onToggleListening, onQuit };

  electronMocks.setImage.mockClear();
  electronMocks.setToolTip.mockClear();
  electronMocks.setContextMenu.mockClear();
  electronMocks.buildFromTemplate.mockClear();
  electronMocks.createFromBitmap.mockClear();
  electronMocks.destroy.mockClear();
  electronMocks.Tray.mockClear();

  createTray(callbacks);
  // Reset the singleton's inputs so tests don't leak state into each other.
  updateTrayWakeState('off', '');
  updateTrayAssistantActivity(false);
});

afterEach(() => {
  destroyTray();
});

describe('resolveTrayVisualState', () => {
  const cases: Array<[WakeListeningState, boolean, string]> = [
    ['off', false, 'off'],
    ['listening', false, 'listening'],
    ['triggered', false, 'processing'],
    ['listening', true, 'processing'],
    ['off', true, 'processing'],
    ['unavailable', false, 'unavailable'],
    ['unavailable', true, 'unavailable'], // never masked
  ];

  it.each(cases)('maps wake=%s busy=%s to %s', (wakeState, assistantBusy, expected) => {
    expect(resolveTrayVisualState(wakeState, assistantBusy)).toBe(expected);
  });
});

describe('createTray', () => {
  it('renders a non-blank glyph and initializes the off state', () => {
    expect(electronMocks.Tray).toHaveBeenCalledTimes(1);
    // The generated 16x16 bitmap must contain drawn pixels, not a blank canvas.
    const buffer = lastIconBuffer();
    let drawnPixels = 0;
    for (let i = 3; i < buffer.length; i += 4) {
      if (buffer[i] > 0) drawnPixels += 1;
    }
    expect(drawnPixels).toBeGreaterThan(50);
    expect(electronMocks.setToolTip).toHaveBeenCalledWith('Kyclius — Background listening off');
  });

  it('returns false (no tray) when the platform has no tray support', () => {
    electronMocks.Tray.mockImplementationOnce(() => {
      throw new Error('no tray');
    });
    expect(createTray(callbacks)).toBe(false);
  });
});

describe('tray context menu', () => {
  it('exposes Open, Toggle background listening, and Quit', () => {
    const labels = lastMenu().map(item => item.label).filter(Boolean);
    expect(labels).toEqual(
      expect.arrayContaining(['Open Kyclius', 'Toggle background listening', 'Quit Kyclius'])
    );
  });

  it('toggles with wake listening disabled by default', () => {
    const toggle = menuItem('Toggle background listening');
    expect(toggle.type).toBe('checkbox');
    expect(toggle.checked).toBe(false);
  });

  it('checks the toggle when background listening is on', () => {
    updateTrayWakeState('listening', 'Hey Kyclius');
    expect(menuItem('Toggle background listening').checked).toBe(true);
  });

  it('routes the checkbox to the shared onToggleListening callback', () => {
    updateTrayWakeState('listening', 'Hey Kyclius');
    const toggle = menuItem('Toggle background listening');
    // Simulate Electron unchecking the item (click delivers the inverse state).
    toggle.click?.({ checked: false });
    expect(onToggleListening).toHaveBeenCalledTimes(1);
    expect(onToggleListening).toHaveBeenCalledWith(false);
  });

  it('routes Open Kyclius and Quit to their callbacks', () => {
    menuItem('Open Kyclius').click?.({});
    expect(onOpen).toHaveBeenCalledTimes(1);

    menuItem('Quit Kyclius').click?.({});
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

describe('T-18 visual states', () => {
  it('flips the icon and tooltip when the wake listener starts', () => {
    const previousBuffer = lastIconBuffer();
    updateTrayWakeState('listening', 'Hey Kyclius');

    expect(lastIconBuffer().equals(previousBuffer)).toBe(false);
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Listening for the wake word ("Hey Kyclius")'
    );
    expect(menuItem('Toggle background listening').checked).toBe(true);
  });

  it('shows "processing" while the assistant is busy and reverts when idle', () => {
    updateTrayWakeState('listening', 'Hey Kyclius');
    const listeningBuffer = lastIconBuffer();

    updateTrayAssistantActivity(true);
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Processing a command ("Hey Kyclius")'
    );
    // Distinct icon from listening — never the same bitmap for two states.
    expect(lastIconBuffer().equals(listeningBuffer)).toBe(false);
    // The setting itself is unchanged, so the menu checkbox stays checked.
    expect(menuItem('Toggle background listening').checked).toBe(true);

    updateTrayAssistantActivity(false);
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Listening for the wake word ("Hey Kyclius")'
    );
  });

  it('shows processing on wake trigger and reverts to listening afterwards', () => {
    updateTrayWakeState('triggered', 'Hey Kyclius');
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Processing a command ("Hey Kyclius")'
    );

    updateTrayWakeState('listening', 'Hey Kyclius');
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Listening for the wake word ("Hey Kyclius")'
    );
  });

  it('shows the danger state when the microphone is unavailable', () => {
    updateTrayWakeState('unavailable', 'Hey Kyclius');
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Microphone unavailable ("Hey Kyclius")'
    );
    // Unavailable wins even over an active command.
    updateTrayAssistantActivity(true);
    expect(electronMocks.setToolTip).toHaveBeenLastCalledWith(
      'Kyclius — Microphone unavailable ("Hey Kyclius")'
    );
    // ...and it stays present, not a disabled switch.
    expect(menuItem('Toggle background listening').checked).toBe(true);
  });
});

describe('destroyTray', () => {
  it('destroys the native tray', () => {
    destroyTray();
    expect(electronMocks.destroy).toHaveBeenCalledTimes(1);
  });
});