/*
  Liner · File dropzone
  Drop files anywhere on it, browse, or paste. While something is dragged over, the zone
  lifts and says what will happen. Each file gets a row with its own progress; files that
  don't fit (type, size, count) say why instead of disappearing.
*/
import { useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./file-dropzone.css";

export type DropFile = { id: number; file: File; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string; leaving?: boolean };
export type FileDropzoneProps = {
  /** Like the input attribute: ".png,.jpg", "image/*". */
  accept?: string;
  /** Bytes. */
  maxSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  /** Upload one file, reporting 0..1. Without it, files are just listed. */
  upload?: (file: File, progress: (p: number) => void) => Promise<void>;
  onFilesChange?: (files: File[]) => void;
  label?: string;
  className?: string;
};

let seq = 0;
export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

function accepts(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .some((a) => (a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? file.type.startsWith(a.slice(0, -1)) : file.type === a));
}

const kind = (f: File) => {
  const ext = f.name.split(".").pop()?.toUpperCase() ?? "";
  return ext.length <= 4 ? ext : "FILE";
};

export function FileDropzone({ accept, maxSize, maxFiles = 10, multiple = true, upload, onFilesChange, label = "Drop files here", className }: FileDropzoneProps) {
  const [files, setFiles] = useState<DropFile[]>([]);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  const patch = (id: number, p: Partial<DropFile>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const report = (fs: DropFile[]) => onFilesChange?.(fs.filter((f) => f.status !== "error").map((f) => f.file));

  const add = (list: FileList | File[]) => {
    const incoming = Array.from(list).slice(0, multiple ? undefined : 1);
    if (!incoming.length) return;
    let room = maxFiles - filesRef.current.filter((f) => f.status !== "error").length;
    const rows: DropFile[] = incoming.map((file) => {
      const id = ++seq;
      if (!accepts(file, accept)) return { id, file, progress: 0, status: "error", error: "This type isn't supported" };
      if (maxSize && file.size > maxSize) return { id, file, progress: 0, status: "error", error: `Larger than ${formatBytes(maxSize)}` };
      if (room-- <= 0) return { id, file, progress: 0, status: "error", error: `Only ${maxFiles} files at a time` };
      return { id, file, progress: 0, status: upload ? "queued" : "done" };
    });
    const next = multiple ? [...filesRef.current, ...rows] : rows;
    setFiles(next);
    report(next);
    feedback.play(rows.some((r) => r.status === "error") ? "error" : "pop", 2);
    if (upload)
      rows
        .filter((r) => r.status === "queued")
        .forEach(async (r) => {
          patch(r.id, { status: "uploading" });
          try {
            await upload(r.file, (p) => patch(r.id, { progress: Math.min(1, p) }));
            patch(r.id, { status: "done", progress: 1 });
          } catch (err) {
            patch(r.id, { status: "error", error: err instanceof Error ? err.message : "Upload failed" });
          }
        });
  };

  const remove = (id: number) => {
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, leaving: true } : f)));
    window.setTimeout(() => {
      setFiles((fs) => {
        const next = fs.filter((f) => f.id !== id);
        report(next);
        return next;
      });
    }, 220);
  };

  const hint = [accept?.split(",").map((a) => a.trim().replace(/^\./, "").toUpperCase()).join(", "), maxSize && `up to ${formatBytes(maxSize)}`].filter(Boolean).join(" · ");

  return (
    <div className={cx("l-drop l-frame", className)} data-over={over || undefined}>
      <div
        className="l-frame-card l-drop__card"
        onDragEnter={(e) => {
          e.preventDefault();
          if (depth.current++ === 0) setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          if (--depth.current === 0) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <button type="button" className="l-drop__zone" onClick={() => input.current?.click()} onPaste={(e) => e.clipboardData.files.length && add(e.clipboardData.files)}>
          <span className="l-drop__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V4.5m0 0L8 8.5m4-4 4 4" />
              <path d="M5 13.5v3.75A2.75 2.75 0 0 0 7.75 20h8.5A2.75 2.75 0 0 0 19 17.25V13.5" />
            </svg>
          </span>
          <span className="l-drop__title" key={over ? "o" : "i"}>
            {over ? "Release to add" : label}
          </span>
          <span className="l-drop__sub">
            or <u>browse</u>
            {hint && <> · {hint}</>}
          </span>
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
        {files.length > 0 && (
          <ul className="l-drop__list" aria-label="Files">
            {files.map((f) => (
              <li key={f.id} className="l-drop__row" data-status={f.status} data-leaving={f.leaving || undefined}>
                <span className="l-drop__kind" aria-hidden>
                  {kind(f.file)}
                </span>
                <span className="l-drop__meta">
                  <span className="l-drop__name">{f.file.name}</span>
                  <span className="l-drop__info" key={f.status}>
                    {f.status === "error" ? f.error : f.status === "uploading" ? `${Math.round(f.progress * 100)}% · ${formatBytes(f.file.size)}` : formatBytes(f.file.size)}
                  </span>
                  {f.status === "uploading" && (
                    <span className="l-drop__bar" role="progressbar" aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${f.file.name}`}>
                      <i style={{ transform: `scaleX(${f.progress})` }} />
                    </span>
                  )}
                </span>
                {f.status === "done" && (
                  <span className="l-drop__ok" aria-label="Uploaded">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3.6 8.4 6.6 11.3 12.4 5" />
                    </svg>
                  </span>
                )}
                <button type="button" className="l-drop__x" aria-label={`Remove ${f.file.name}`} onClick={() => remove(f.id)}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                    <path d="m4.5 4.5 7 7m0-7-7 7" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
