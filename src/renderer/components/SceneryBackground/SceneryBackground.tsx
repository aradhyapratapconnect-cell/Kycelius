import sceneryVideo from '../../assets/background-scenery.mp4';

/**
 * Full-bleed, looped, muted, autoplaying scenery video that sits behind all
 * other UI on the home screen (T-02). Object-fit cover keeps it filling any
 * window size/aspect ratio with no blank space; text legibility is handled by
 * localized gradients in HomeScreen, never by dulling the whole scene here.
 */
export function SceneryBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-leaf-soft" aria-hidden>
      <video
        src={sceneryVideo}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        className="absolute inset-0 w-full h-full object-cover select-none"
      />
    </div>
  );
}

export default SceneryBackground;