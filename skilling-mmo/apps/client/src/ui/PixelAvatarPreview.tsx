import { useEffect, useRef } from "react";
import {
  PIXEL_H,
  PIXEL_W,
  pixelAvatarRgba,
  type Appearance,
} from "@skilling-mmo/shared";

export function PixelAvatarPreview({
  appearance,
  scale = 6,
}: {
  appearance: Appearance;
  scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const rgba = pixelAvatarRgba(appearance, scale);
    const img = ctx.createImageData(PIXEL_W * scale, PIXEL_H * scale);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }, [appearance, scale]);

  return (
    <canvas
      ref={ref}
      className="pixel-avatar-preview"
      width={PIXEL_W * scale}
      height={PIXEL_H * scale}
      aria-hidden
    />
  );
}
