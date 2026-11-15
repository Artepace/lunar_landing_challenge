import { useEffect, useRef } from "react";

const grainSize = 192;
const grainFrames = 6;
const assets = import.meta.env.BASE_URL + "assets/";

// Generate the repeating screen-blended grain from the supplied NoiseBackground.
function makeGrainFrames() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = grainSize;
  const context = canvas.getContext("2d");
  if (!context) return [];
  const frame = context.createImageData(grainSize, grainSize);

  return Array.from({ length: grainFrames }, () => {
    for (let pixel = 0; pixel < frame.data.length; pixel += 4) {
      const tone = Math.floor(Math.random() * 256);
      frame.data[pixel] = frame.data[pixel + 1] = frame.data[pixel + 2] = tone;
      frame.data[pixel + 3] = 255;
    }
    context.putImageData(frame, 0, 0);
    return canvas.toDataURL("image/png");
  });
}

export function NoiseBackground({ motion }: { motion: boolean }) {
  const grain = useRef<HTMLDivElement>(null);
  const frames = useRef<string[]>([]);

  useEffect(() => {
    const layer = grain.current;
    if (!layer) return;
    if (!frames.current.length) frames.current = makeGrainFrames();
    if (!frames.current.length) return;

    let index = 0;
    const apply = () => {
      layer.style.backgroundImage = `url(${frames.current[index]})`;
    };
    apply();
    if (!motion) return;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      index = (index + 1) % frames.current.length;
      apply();
    }, 1_000 / 12);
    return () => window.clearInterval(timer);
  }, [motion]);

  return (
    <div className="site-background" aria-hidden="true">
      <div className="site-background-grain" ref={grain} />
    </div>
  );
}

export function OrbitBackdrop({ motion }: { motion: boolean }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const clip = video.current;
    if (!clip) return;
    const update = () => {
      if (motion && !document.hidden) void clip.play().catch(() => {});
      else clip.pause();
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      clip.pause();
    };
  }, [motion]);

  return (
    <div className="orbit-background" aria-hidden="true">
      <video
        ref={video}
        className="orbit-background-video"
        src={`${assets}selene-orbit-loop.mp4`}
        poster={`${assets}selene-orbit-poster.webp`}
        preload="none"
        loop
        muted
        playsInline
      />
    </div>
  );
}
