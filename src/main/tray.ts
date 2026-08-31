// T-18 — System tray / menu-bar icon.
//
// Keeps Kyclius alive when the main window is closed so background wake word
// listening keeps running, and gives the user an always-visible, explicit way
// to control it — including a Quit option that fully stops every listener.
//
// The glyph is a simple abstract mark (a leaf) rendered in different colors for
// the three T-18 visual states — listening-for-wake-word, actively-processing-
// a-command, and background-listening-off (plus a danger variant for a broken
// microphone), per the Frontend Spec's no-mascot rule. The tray combines two
// inputs into that one visible state: the wake-word listener state (F-09) and
// the assistant's high-level activity (assistantState.ts), so the icon flips
// the moment a command starts being processed.

import { Menu, nativeImage, Tray } from 'electron';
import type { NativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type { WakeListeningState } from './voice/wakeWordService';

/**
 * The single visible tray state. 'off' / 'listening' / 'processing' are the
 * three states T-18 requires; 'unavailable' is the mic-broken error variant.
 */
export type TrayVisualState = 'off' | 'listening' | 'processing' | 'unavailable';

export interface TrayCallbacks {
  onOpen(): void;
  onToggleListening(enabled: boolean): void;
  onQuit(): void;
}

// [r, g, b] per state — matches the Frontend Spec palette:
// neutral gray while background listening is off, leaf-primary while listening
// for the wake word, blossom-deep while processing a command, danger when the
// microphone is unavailable.
const STATE_COLORS: Record<TrayVisualState, [number, number, number]> = {
  off: [138, 138, 138],
  listening: [78, 139, 74],
  processing: [217, 112, 159],
  unavailable: [192, 83, 62],
};

const STATE_TOOLTIPS: Record<TrayVisualState, string> = {
  off: 'Background listening off',
  listening: 'Listening for the wake word',
  processing: 'Processing a command',
  unavailable: 'Microphone unavailable',
};

/**
 * Resolves the single visible tray state from its two inputs: the wake-word
 * listener state (F-09) and whether the assistant is currently busy processing
 * a command. "Actively processing" wins over the listening trait so the icon
 * flips the moment the command flow starts, and the mic-unavailable error is
 * never masked by either.
 */
export function resolveTrayVisualState(
  wakeState: WakeListeningState,
  assistantBusy: boolean
): TrayVisualState {
  if (wakeState === 'unavailable') return 'unavailable';
  if (assistantBusy || wakeState === 'triggered') return 'processing';
  if (wakeState === 'listening') return 'listening';
  return 'off';
}

/* ------------------------------------------------------------------ */
/*  Leaf glyph rasterizer (no binary assets)                           */
/* ------------------------------------------------------------------ */

interface Region {
  distance(x: number, y: number): number;
}

function circle(cx: number, cy: number, radius: number): Region {
  return { distance: (x, y) => Math.hypot(x - cx, y - cy) - radius };
}

function segment(x0: number, y0: number, x1: number, y1: number, thickness: number): Region {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;
  return {
    distance(x: number, y: number): number {
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSq));
      const px = x0 + t * dx;
      const py = y0 + t * dy;
      return Math.hypot(x - px, y - py) - thickness / 2;
    },
  };
}

// A diagonal leaf made from two overlapping circles with a short stem at the
// tip — pure flat geometry, no organic blob or mascot (spec §4 / §6).
const LEAF_REGIONS: Region[] = [
  circle(6.0, 6.8, 5.2),
  circle(10.0, 9.2, 5.2),
  segment(2.2, 2.9, 3.4, 4.0, 1.1),
];

const GLYPH_SIZE = 16;
const SUPERSAMPLE = 4;

function coverageAt(x: number, y: number): number {
  let coverage = 0;
  for (const region of LEAF_REGIONS) {
    coverage = Math.max(coverage, Math.min(1, Math.max(0, 0.5 - region.distance(x, y))));
  }
  return coverage;
}

/**
 * Renders the leaf glyph in the given color as a premultiplied BGRA bitmap
 * (the byte order nativeImage.createFromBitmap expects), supersampled so the
 * edges stay smooth at 16px. The three states are color variants of the same
 * mark; a future binary icon set can replace this without changing the wiring.
 */
function buildLeafIcon([r, g, b]: [number, number, number], size = GLYPH_SIZE): NativeImage {
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let total = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          total += coverageAt(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE);
        }
      }
      const alpha = Math.round((total / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
      const offset = (y * size + x) * 4;
      buffer[offset] = Math.round((b * alpha) / 255); // B
      buffer[offset + 1] = Math.round((g * alpha) / 255); // G
      buffer[offset + 2] = Math.round((r * alpha) / 255); // R
      buffer[offset + 3] = alpha; // A
    }
  }

  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

let tray: Tray | null = null;
let wakeState: WakeListeningState = 'off';
let wakePhrase = '';
let assistantBusy = false;
let callbacks: TrayCallbacks | null = null;

export function createTray(trayCallbacks: TrayCallbacks): boolean {
  callbacks = trayCallbacks;

  try {
    tray = new Tray(buildLeafIcon(STATE_COLORS.off));
    tray.on('click', () => trayCallbacks.onOpen());
  } catch {
    // Some Linux desktop environments expose no system tray at all.
    // The app still works; window-all-closed falls back to quitting.
    return false;
  }

  refresh();
  return true;
}

/** Called whenever the wake-word listener (F-09) changes state. */
export function updateTrayWakeState(state: WakeListeningState, phrase: string): void {
  wakeState = state;
  wakePhrase = phrase;
  refresh();
}

/**
 * Called whenever the assistant's high-level activity changes. While the
 * assistant is busy (listening/thinking/executing/speaking/...) the tray shows
 * the "actively processing a command" state.
 */
export function updateTrayAssistantActivity(busy: boolean): void {
  assistantBusy = busy;
  refresh();
}

function refresh(): void {
  if (!tray) return;

  const visual = resolveTrayVisualState(wakeState, assistantBusy);
  tray.setImage(buildLeafIcon(STATE_COLORS[visual]));

  const phraseSuffix = visual === 'off' || !wakePhrase ? '' : ` ("${wakePhrase}")`;
  tray.setToolTip(`Kyclius — ${STATE_TOOLTIPS[visual]}${phraseSuffix}`);

  rebuildMenu();
}

function rebuildMenu(): void {
  if (!tray || !callbacks) return;

  const listeningEnabled = wakeState !== 'off';

  const menu: MenuItemConstructorOptions[] = [
    { label: 'Open Kyclius', click: () => callbacks?.onOpen() },
    { type: 'separator' },
    {
      id: 'toggle-background-listening',
      label: 'Toggle background listening',
      type: 'checkbox',
      checked: listeningEnabled,
      click: item => callbacks?.onToggleListening(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Quit Kyclius',
      click: () => callbacks?.onQuit(),
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(menu));
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}