import { SceneryBackground } from '../SceneryBackground';

/**
 * Ambient home screen per the reference mockup (test/kycelius-home.html):
 * - full-bleed looped scenery video (SceneryBackground)
 * - full-scene darkening overlay (multiply) for text legibility over the video
 * - the centered greeting + glass composer live in App, docked near the bottom
 * - no character, blob, or mascot — assistant state lives on the composer
 */
export function HomeScreen() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-label="Home screen">
      <SceneryBackground />

      {/* Full-scene darkening for legibility (T-02 AC — never a flat solid
          scrim, just a multiply tint so the scenery stays visible) */}
      <div className="absolute inset-0 bg-background/20 mix-blend-multiply" aria-hidden />
    </div>
  );
}

export default HomeScreen;