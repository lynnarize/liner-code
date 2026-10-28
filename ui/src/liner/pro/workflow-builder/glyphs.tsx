/* Glyphs for steps and the builder's controls: 16px, 1.4px strokes, round ends, in ink. AI
   steps wear the Liner AI mark instead, so they read as the assistant's work at a glance. */
import type { ReactNode } from "react";
import type { GlyphName, WorkflowStepKind } from "./model";

const I = ({ children, className }: { children: ReactNode; className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const paths: Record<GlyphName, ReactNode> = {
  form: (
    <>
      <rect x="3" y="2.25" width="10" height="11.5" rx="2" />
      <path d="M5.75 5.75h4.5M5.75 8h4.5M5.75 10.25h2.5" />
    </>
  ),
  bolt: <path d="M8.75 2.25 3.75 9h4l-.5 4.75L12.25 7h-4Z" />,
  mail: (
    <>
      <rect x="2.25" y="3.5" width="11.5" height="9" rx="1.5" />
      <path d="m2.75 4.5 5.25 4 5.25-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.9V8l2.1 1.35" />
    </>
  ),
  branch: (
    <>
      <path d="M8 2.25v3.5c0 2.2-3.75 2.3-3.75 4.9M8 5.75c0 2.2 3.75 2.3 3.75 4.9" />
      <circle cx="4.25" cy="12.4" r="1.35" />
      <circle cx="11.75" cy="12.4" r="1.35" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5.6" r="2.6" />
      <path d="M3.25 13.5c.6-2.55 2.45-3.9 4.75-3.9s4.15 1.35 4.75 3.9" />
    </>
  ),
  refund: (
    <>
      <path d="M5.4 4.1 2.9 6.6l2.5 2.5" />
      <path d="M3.1 6.6h6.15a3.6 3.6 0 0 1 0 7.2H6.9" />
    </>
  ),
  send: <path d="M13.75 2.25 2.25 7l4.9 1.85L9 13.75l4.75-11.5ZM7.15 8.85l2.7-2.7" />,
  chat: <path d="M3 3.25h10a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H7.2L4.4 13.6v-2.1H3a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1Z" />,
  record: (
    <>
      <ellipse cx="8" cy="4" rx="4.75" ry="1.75" />
      <path d="M3.25 4v8c0 .97 2.13 1.75 4.75 1.75s4.75-.78 4.75-1.75V4M3.25 8c0 .97 2.13 1.75 4.75 1.75s4.75-.78 4.75-1.75" />
    </>
  ),
  code: <path d="M5.5 4.75 2.25 8l3.25 3.25M10.5 4.75 13.75 8l-3.25 3.25" />,
  task: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.75" />
      <path d="m5.4 8.2 1.8 1.8 3.4-3.6" />
    </>
  ),
  doc: (
    <>
      <path d="M9 2.25H4.75a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1V5.5Z" />
      <path d="M9 2.25V5.5h3.25" />
    </>
  ),
};

const byKind: Record<WorkflowStepKind, GlyphName> = { trigger: "bolt", ai: "doc", branch: "branch", wait: "clock", action: "send", person: "person" };

export function Glyph({ name, kind, className }: { name?: GlyphName; kind?: WorkflowStepKind; className?: string }) {
  return <I className={className}>{paths[name ?? byKind[kind ?? "action"]]}</I>;
}

export const Icon = {
  /** The workflow: three steps, one line between them. */
  flow: () => (
    <I>
      <rect x="5.25" y="1.75" width="5.5" height="3.5" rx="1.25" />
      <rect x="1.75" y="10.75" width="5.5" height="3.5" rx="1.25" />
      <rect x="8.75" y="10.75" width="5.5" height="3.5" rx="1.25" />
      <path d="M8 5.25v1.9M4.5 10.75c0-2 1.3-3.6 3.5-3.6s3.5 1.6 3.5 3.6" />
    </I>
  ),
  play: () => (
    <I>
      <path d="M5 3.7v8.6a.6.6 0 0 0 .92.5l6.75-4.3a.6.6 0 0 0 0-1L5.92 3.2A.6.6 0 0 0 5 3.7Z" />
    </I>
  ),
  stop: () => (
    <I>
      <rect x="4" y="4" width="8" height="8" rx="1.75" />
    </I>
  ),
  publish: () => (
    <I>
      <path d="M8 10.25V2.75M5 5.6 8 2.6l3 3M3 10.5v1.75A1.75 1.75 0 0 0 4.75 14h6.5A1.75 1.75 0 0 0 13 12.25V10.5" />
    </I>
  ),
  plus: () => (
    <I>
      <path d="M8 3.5v9M3.5 8h9" />
    </I>
  ),
  minus: () => (
    <I>
      <path d="M3.5 8h9" />
    </I>
  ),
  fit: () => (
    <I>
      <path d="M2.75 6V3.75a1 1 0 0 1 1-1H6M10 2.75h2.25a1 1 0 0 1 1 1V6M13.25 10v2.25a1 1 0 0 1-1 1H10M6 13.25H3.75a1 1 0 0 1-1-1V10" />
    </I>
  ),
  close: () => (
    <I>
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </I>
  ),
  more: () => (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3.75" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12.25" cy="8" r="1.15" />
    </svg>
  ),
  check: () => (
    <I>
      <path d="M3.6 8.4 6.6 11.3 12.4 5" />
    </I>
  ),
  warn: () => (
    <I>
      <path d="M8 6.25v3.25M8 11.4v.1M7.1 2.8 1.9 11.9a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5L8.9 2.8a1 1 0 0 0-1.8 0Z" />
    </I>
  ),
  search: () => (
    <I>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="m13.5 13.5-2.9-2.9" />
    </I>
  ),
  copy: () => (
    <I>
      <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.75" />
      <path d="M10.75 5.25V4a1.75 1.75 0 0 0-1.75-1.75H4A1.75 1.75 0 0 0 2.25 4v5A1.75 1.75 0 0 0 4 10.75h1.25" />
    </I>
  ),
  trash: () => (
    <I>
      <path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4 4.25l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6" />
    </I>
  ),
  up: () => (
    <I>
      <path d="M8 12.75v-9.5M4 7.25l4-4 4 4" />
    </I>
  ),
};
