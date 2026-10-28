/*
  Liner Pro · Avatar upload
  Drop a photo on the avatar or press it to choose one. A glass panel opens to frame it:
  drag to move, scroll or slide to zoom, always filling the circle. Saving crops it on the
  device, and the upload's progress runs around the avatar's edge.
*/
import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss } from "../../lib/overlay";
import { clamp } from "../../lib/spring";
import { Button } from "../../components/button/button";
import "./avatar-upload.css";

export type AvatarUploadProps = {
  /** Current photo URL. */
  value?: string | null;
  name: string;
  /** Receives the cropped square as a data URL. Report 0..1 while it uploads. */
  upload?: (dataUrl: string, progress: (p: number) => void) => Promise<void>;
  onChange?: (dataUrl: string | null) => void;
  size?: number;
  className?: string;
};

const VIEW = 220;
const OUT = 360;

export function AvatarUpload({ value = null, name, upload, onChange, size = 96, className }: AvatarUploadProps) {
  const [photo, setPhoto] = useState(value);
  const [crop, setCrop] = useState<{ img: HTMLImageElement; url: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(!!crop, () => setCrop(null), [wrap], btn);

  const open = (file?: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setCrop({ img, url });
      feedback.play("pop", 2);
    };
    img.src = url;
  };
  useEffect(
    () => () => {
      if (crop) URL.revokeObjectURL(crop.url);
    },
    [crop],
  );

  const save = async (dataUrl: string) => {
    setCrop(null);
    setPhoto(dataUrl);
    onChange?.(dataUrl);
    btn.current?.focus();
    if (!upload) return;
    setProgress(0);
    try {
      await upload(dataUrl, (p) => setProgress(clamp(p, 0, 1)));
      setProgress(1);
      feedback.play("success");
    } finally {
      window.setTimeout(() => setProgress(null), 700);
    }
  };

  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const r = size / 2 + 4;
  const c = 2 * Math.PI * r;
  return (
    <div ref={wrap} className={cx("l-avup", className)} style={{ ["--av" as string]: `${size}px` }}>
      <button
        ref={btn}
        type="button"
        className="l-avup__face"
        data-over={over || undefined}
        aria-label={photo ? `Change ${name}'s photo` : `Add a photo for ${name}`}
        aria-expanded={!!crop}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          open(e.dataTransfer.files[0]);
        }}
      >
        {photo ? <img src={photo} alt="" key={photo} /> : <span className="l-avup__initials">{initials}</span>}
        <span className="l-avup__cover" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
            <circle cx="12" cy="13" r="3.25" />
          </svg>
        </span>
        {progress !== null && (
          <svg className="l-avup__ring" viewBox={`0 0 ${r * 2 + 4} ${r * 2 + 4}`} aria-hidden data-done={progress === 1 || undefined}>
            <circle cx={r + 2} cy={r + 2} r={r} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - progress) }} />
          </svg>
        )}
      </button>
      {photo && !crop && progress === null && (
        <button
          type="button"
          className="l-avup__remove"
          onClick={() => {
            setPhoto(null);
            onChange?.(null);
            feedback.play("tap");
          }}
        >
          Remove
        </button>
      )}
      {progress !== null && (
        <span className="l-avup__status" role="status">
          {progress === 1 ? "Saved" : `Uploading ${Math.round(progress * 100)}%`}
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {crop && <Cropper img={crop.img} onCancel={() => (setCrop(null), btn.current?.focus())} onSave={save} />}
    </div>
  );
}

function Cropper({ img, onCancel, onSave }: { img: HTMLImageElement; onCancel: () => void; onSave: (dataUrl: string) => void }) {
  const base = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
  const [zoom, setZoom] = useState(1);
  const zoomNow = useRef(1);
  zoomNow.current = zoom;
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const s = base * zoom;
  // Keep the photo covering the circle: the offset can't open a gap at any edge.
  const limit = (p: { x: number; y: number }, sc = s) => {
    const mx = Math.max(0, (img.naturalWidth * sc - VIEW) / 2);
    const my = Math.max(0, (img.naturalHeight * sc - VIEW) / 2);
    return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) };
  };
  const zoomTo = (z: number) => {
    const next = clamp(z, 1, 4);
    setZoom(next);
    setPos((p) => limit(p, base * next));
  };
  const view = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  useEffect(() => {
    panel.current?.focus();
    // Wheel zoom needs a listener that may cancel the page's scroll.
    const el = view.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(zoomNow.current - e.deltaY * 0.002);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const render = () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = OUT;
    const k = OUT / VIEW;
    const g = cv.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    const w = img.naturalWidth * s * k;
    const h = img.naturalHeight * s * k;
    g.drawImage(img, OUT / 2 - w / 2 + pos.x * k, OUT / 2 - h / 2 + pos.y * k, w, h);
    onSave(cv.toDataURL("image/jpeg", 0.9));
  };

  return (
    <div
      ref={panel}
      className="l-pop l-avup__panel"
      data-side="bottom"
      data-align="center"
      role="dialog"
      aria-label="Frame your photo"
      tabIndex={-1}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 20 : 6;
        const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (moves[e.key] && e.target === panel.current) {
          e.preventDefault();
          setPos((p) => limit({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] }));
        } else if (e.key === "+" || e.key === "=") zoomTo(zoom + 0.2);
        else if (e.key === "-") zoomTo(zoom - 0.2);
        else if (e.key === "Enter" && e.target === panel.current) render();
      }}
    >
      <div className="l-avup__title">Frame your photo</div>
      <div
        ref={view}
        className="l-avup__view"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPos(limit({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          src={img.src}
          alt=""
          draggable={false}
          style={{ width: img.naturalWidth * s, height: img.naturalHeight * s, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }}
        />
        <span className="l-avup__mask" aria-hidden />
      </div>
      <label className="l-avup__zoom">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
        </svg>
        <input type="range" min={1} max={4} step={0.01} value={zoom} aria-label="Zoom" onChange={(e) => zoomTo(Number(e.target.value))} style={{ ["--p" as string]: (zoom - 1) / 3 }} />
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" />
        </svg>
      </label>
      <div className="l-avup__actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={render}>
          Save photo
        </Button>
      </div>
    </div>
  );
}
