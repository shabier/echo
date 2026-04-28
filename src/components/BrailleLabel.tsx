import { useEffect, useRef, useState } from "react";
import styles from "./BrailleLabel.module.scss";

// Braille Unicode block: U+2800 – U+28FF. Each char is a 2x4 dot grid; the bottom
// 8 bits of the codepoint pick which dots are on.
const BRAILLE_BASE = 0x2800;
function braille(bits: number): string {
  return String.fromCharCode(BRAILLE_BASE + (bits & 0xff));
}

interface Props {
  label: string;
  fps?: number;
  className?: string;
}

export function BrailleLabel({ label, fps = 12, className }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);
  const [sideCount, setSideCount] = useState(0);

  // Convert "row width minus label width minus gaps" into a per-side glyph count.
  useEffect(() => {
    const row = rowRef.current;
    const labelEl = labelRef.current;
    const leftEl = leftRef.current;
    if (!row || !labelEl || !leftEl) return;

    const measure = () => {
      // Probe a single glyph inside the actual braille span so we inherit its
      // font-size and letter-spacing. The row's own font cell is bigger.
      const probe = document.createElement("span");
      probe.style.visibility = "hidden";
      probe.style.position = "absolute";
      probe.style.whiteSpace = "nowrap";
      probe.textContent = braille(0xff);
      leftEl.appendChild(probe);
      const charW = probe.getBoundingClientRect().width;
      leftEl.removeChild(probe);
      if (charW <= 0) return;

      const rowW = row.clientWidth;
      const labelW = labelEl.getBoundingClientRect().width;
      const cs = getComputedStyle(row);
      const gap = parseFloat(cs.columnGap || cs.gap || "0");
      const sideW = (rowW - labelW - gap * 2) / 2;
      // Ceil + extra 1 so the string slightly overshoots; overflow:hidden trims it
      // flush to the edge regardless of subpixel rounding.
      setSideCount(Math.max(0, Math.ceil(sideW / charW) + 1));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    ro.observe(labelEl);
    return () => ro.disconnect();
  }, [label]);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right || sideCount === 0) return;

    const init = (n: number) => {
      const a = new Array<number>(n);
      for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
      return a;
    };
    const leftChars = init(sideCount);
    const rightChars = init(sideCount);

    const flicker = (chars: number[]) => {
      for (let i = 0; i < chars.length; i++) {
        if (Math.random() < 0.04) {
          chars[i] ^= 1 << Math.floor(Math.random() * 8);
        }
      }
    };
    const toStr = (chars: number[]) => {
      let s = "";
      for (let i = 0; i < chars.length; i++) s += braille(chars[i]);
      return s;
    };

    const interval = 1000 / fps;
    let timer = 0;
    const tick = () => {
      flicker(leftChars);
      flicker(rightChars);
      left.textContent = toStr(leftChars);
      right.textContent = toStr(rightChars);
      timer = window.setTimeout(tick, interval);
    };
    tick();
    return () => clearTimeout(timer);
  }, [sideCount, fps]);

  return (
    <div ref={rowRef} className={`${styles.row} ${className ?? ""}`}>
      <span ref={leftRef} className={styles.braille} aria-hidden />
      <span ref={labelRef} className={styles.label}>{label}</span>
      <span ref={rightRef} className={styles.braille} aria-hidden />
    </div>
  );
}
