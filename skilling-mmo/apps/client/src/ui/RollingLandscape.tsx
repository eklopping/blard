import { useEffect, useRef } from "react";

type Biome = "forest" | "plains" | "mountains" | "shore";

const BIOME_CYCLE: Biome[] = ["forest", "plains", "mountains", "shore"];
const SEGMENT_W = 420;

interface Props {
  className?: string;
  /** Seconds for a full day→night→day cycle */
  dayLengthSec?: number;
  /** Horizontal scroll speed in px/sec */
  scrollSpeed?: number;
}

/**
 * Lightweight decorative backdrop: silhouettes scroll right→left through
 * biomes while the sky shifts day ↔ night. Canvas only — no Phaser.
 */
export function RollingLandscape({
  className,
  dayLengthSec = 48,
  scrollSpeed = 28,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let scroll = 0;
    let last = performance.now();
    const t0 = last;

    const stars = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.55,
      r: 0.6 + Math.random() * 1.4,
      a: 0.4 + Math.random() * 0.6,
    }));

    function resize() {
      const parent = canvas!.parentElement;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    function dayFactor(elapsedMs: number): number {
      // 0 = midnight, 0.5 = noon — smooth cosine
      const phase = (elapsedMs / 1000 / dayLengthSec) % 1;
      return 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
    }

    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * t;
    }

    function lerpColor(c1: number[], c2: number[], t: number): string {
      return `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
    }

    function drawSky(w: number, h: number, day: number) {
      const topDay = [110, 170, 210];
      const topNight = [12, 18, 42];
      const botDay = [210, 200, 140];
      const botNight = [28, 36, 58];
      const g = ctx!.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, lerpColor(topNight, topDay, day));
      g.addColorStop(0.55, lerpColor([40, 55, 90], [160, 195, 220], day));
      g.addColorStop(1, lerpColor(botNight, botDay, day));
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);

      // Stars (night)
      const starA = Math.max(0, 1 - day * 1.6);
      if (starA > 0.02) {
        for (const s of stars) {
          ctx!.globalAlpha = starA * s.a;
          ctx!.fillStyle = "#e8f0ff";
          ctx!.beginPath();
          ctx!.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.globalAlpha = 1;
      }

      // Sun / moon
      const orbitX = w * 0.5 + Math.cos((1 - day) * Math.PI) * w * 0.38;
      const orbitY = h * 0.42 - Math.sin(day * Math.PI) * h * 0.28;
      if (day > 0.25) {
        ctx!.fillStyle = `rgba(255, 220, 120, ${0.35 + day * 0.5})`;
        ctx!.beginPath();
        ctx!.arc(orbitX, orbitY, 22 + day * 8, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = "#ffe9a0";
        ctx!.beginPath();
        ctx!.arc(orbitX, orbitY, 14, 0, Math.PI * 2);
        ctx!.fill();
      } else {
        ctx!.fillStyle = `rgba(220, 230, 255, ${0.7 - day})`;
        ctx!.beginPath();
        ctx!.arc(orbitX, h * 0.22, 16, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = lerpColor(topNight, [30, 40, 70], 0.3);
        ctx!.beginPath();
        ctx!.arc(orbitX + 6, h * 0.2, 14, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function hillY(x: number, seed: number, amp: number, base: number): number {
      return (
        base +
        Math.sin(x * 0.008 + seed) * amp +
        Math.sin(x * 0.019 + seed * 1.7) * amp * 0.45
      );
    }

    function drawFarHills(w: number, h: number, offset: number, day: number) {
      const base = h * 0.58;
      ctx!.beginPath();
      ctx!.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const wx = x + offset * 0.35;
        ctx!.lineTo(x, hillY(wx, 1.2, h * 0.06, base));
      }
      ctx!.lineTo(w, h);
      ctx!.closePath();
      ctx!.fillStyle = day > 0.4 ? "#6a8a6a" : "#2a3a3a";
      ctx!.fill();
    }

    function drawTree(x: number, ground: number, scale: number, fill: string) {
      const trunkH = 10 * scale;
      const canopy = 16 * scale;
      ctx!.fillStyle = "#3a2a18";
      ctx!.fillRect(x - 2 * scale, ground - trunkH, 4 * scale, trunkH);
      ctx!.fillStyle = fill;
      ctx!.beginPath();
      ctx!.moveTo(x, ground - trunkH - canopy);
      ctx!.lineTo(x + canopy * 0.7, ground - trunkH + 2);
      ctx!.lineTo(x - canopy * 0.7, ground - trunkH + 2);
      ctx!.closePath();
      ctx!.fill();
    }

    function drawCrop(x: number, ground: number, fill: string) {
      ctx!.strokeStyle = fill;
      ctx!.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const ox = x + i * 5;
        ctx!.beginPath();
        ctx!.moveTo(ox, ground);
        ctx!.lineTo(ox + 1, ground - 10 - (i % 2) * 3);
        ctx!.stroke();
      }
    }

    function drawPeak(x: number, ground: number, hgt: number, fill: string, snow: string) {
      ctx!.fillStyle = fill;
      ctx!.beginPath();
      ctx!.moveTo(x - 28, ground);
      ctx!.lineTo(x, ground - hgt);
      ctx!.lineTo(x + 28, ground);
      ctx!.closePath();
      ctx!.fill();
      ctx!.fillStyle = snow;
      ctx!.beginPath();
      ctx!.moveTo(x - 8, ground - hgt * 0.55);
      ctx!.lineTo(x, ground - hgt);
      ctx!.lineTo(x + 8, ground - hgt * 0.55);
      ctx!.closePath();
      ctx!.fill();
    }

    function drawNearGround(w: number, h: number, offset: number, day: number) {
      const groundBase = h * 0.72;
      const groundFill = day > 0.35 ? "#4a6a3a" : "#1e2e22";
      const accent = day > 0.35 ? "#3d5a30" : "#152018";
      const treeFill = day > 0.35 ? "#2f5a28" : "#1a3020";
      const cropFill = day > 0.35 ? "#8a9a40" : "#3a4a28";
      const rockFill = day > 0.35 ? "#6a6a68" : "#3a3a3c";
      const snow = day > 0.35 ? "#e8e8e0" : "#9aa0b0";

      // Ground strip
      ctx!.beginPath();
      ctx!.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const wx = x + offset;
        ctx!.lineTo(x, hillY(wx, 0.4, h * 0.035, groundBase));
      }
      ctx!.lineTo(w, h);
      ctx!.closePath();
      ctx!.fillStyle = groundFill;
      ctx!.fill();

      // Decorations per biome segment (draw a couple screen-widths)
      const start = Math.floor(offset / SEGMENT_W) - 1;
      const end = start + Math.ceil(w / SEGMENT_W) + 3;
      for (let seg = start; seg <= end; seg++) {
        const biome = BIOME_CYCLE[((seg % BIOME_CYCLE.length) + BIOME_CYCLE.length) % BIOME_CYCLE.length];
        const segLeft = seg * SEGMENT_W - offset;

        if (biome === "forest") {
          for (let i = 0; i < 7; i++) {
            const lx = segLeft + 40 + i * 55 + (i % 3) * 8;
            const gy = hillY(seg * SEGMENT_W + 40 + i * 55, 0.4, h * 0.035, groundBase);
            drawTree(lx, gy, 0.85 + (i % 3) * 0.2, treeFill);
          }
        } else if (biome === "plains") {
          for (let i = 0; i < 10; i++) {
            const lx = segLeft + 30 + i * 38;
            const gy = hillY(seg * SEGMENT_W + 30 + i * 38, 0.4, h * 0.035, groundBase);
            drawCrop(lx, gy, cropFill);
          }
          // barn silhouette
          const bx = segLeft + 280;
          const by = hillY(seg * SEGMENT_W + 280, 0.4, h * 0.035, groundBase);
          ctx!.fillStyle = accent;
          ctx!.fillRect(bx, by - 28, 36, 28);
          ctx!.beginPath();
          ctx!.moveTo(bx - 4, by - 28);
          ctx!.lineTo(bx + 18, by - 42);
          ctx!.lineTo(bx + 40, by - 28);
          ctx!.closePath();
          ctx!.fill();
        } else if (biome === "mountains") {
          drawPeak(segLeft + 100, hillY(seg * SEGMENT_W + 100, 0.4, h * 0.035, groundBase), 70, rockFill, snow);
          drawPeak(segLeft + 220, hillY(seg * SEGMENT_W + 220, 0.4, h * 0.035, groundBase), 95, rockFill, snow);
          drawPeak(segLeft + 340, hillY(seg * SEGMENT_W + 340, 0.4, h * 0.035, groundBase), 55, rockFill, snow);
        } else {
          // shore — flatter + water band
          const waterY = groundBase + 18;
          ctx!.fillStyle = day > 0.35 ? "#4a7a8a" : "#1a2a38";
          ctx!.fillRect(segLeft, waterY, SEGMENT_W + 2, h - waterY);
          for (let i = 0; i < 4; i++) {
            const lx = segLeft + 50 + i * 90;
            const gy = hillY(seg * SEGMENT_W + 50 + i * 90, 0.4, h * 0.02, groundBase - 4);
            drawTree(lx, gy, 0.55, treeFill);
          }
        }
      }
    }

    function frame(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      scroll += scrollSpeed * dt;
      const day = dayFactor(now - t0);
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;

      drawSky(w, h, day);
      drawFarHills(w, h, scroll, day);
      drawNearGround(w, h, scroll, day);

      // Soft vignette so cards stay readable
      const vg = ctx!.createRadialGradient(w * 0.5, h * 0.45, h * 0.2, w * 0.5, h * 0.5, h * 0.85);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [dayLengthSec, scrollSpeed]);

  return <canvas ref={canvasRef} className={className ?? "rolling-landscape"} aria-hidden />;
}
