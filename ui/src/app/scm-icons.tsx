/*
  The marks of the places code lives and the trackers issues live in: Git, GitHub, GitLab, Bitbucket, Azure DevOps,
  Forgejo, Cursor Origin and Linear. The paths are T3 Code's (MIT): packages/source-control-<host>/src/shared/icon.ts
  and apps/web/src/components/Icons.tsx (GitIcon, LinearIcon); Azure's is selfhst/icons (CC BY 4.0), as T3 Code notes.
  GitHub's, Origin's and Linear's are drawn in the text colour, the rest in their own.
*/
import { useId } from "react";
import type { Host } from "@contracts";

export type ScmMark = Host | "git" | "linear";

type Grad = { id: string; x1: number; y1: number; x2: number; y2: number; transform: string; stops: [number, string, number?][] };

const AZURE_GRADS: Grad[] = [
  { id: "a", x1: 58.027, y1: 356.668, x2: 58.027, y2: 100.668, transform: "matrix(1 0 0 -1 0 514)", stops: [[0, "#163697"], [0.276, "#2052cb"], [0.518, "#2764e7"], [0.879, "#367af2"]] },
  { id: "b", x1: 58.027, y1: 351.334, x2: 58.027, y2: 292.668, transform: "matrix(1 0 0 -1 0 514)", stops: [[0, "#102784"], [1, "#2052cb", 0]] },
  { id: "c", x1: 389.98, y1: 57.935, x2: 107.314, y2: 193.935, transform: "matrix(1 0 0 -1 0 514)", stops: [[0, "#163697"], [0.301, "#2052cb"], [0.626, "#2764e7"], [0.926, "#367af2"]] },
  { id: "d", x1: 391.996, y1: 76.552, x2: 341.385, y2: 78.224, transform: "matrix(1 0 0 -1 0 514)", stops: [[0, "#102784"], [1, "#2052cb", 0]] },
  { id: "e", x1: 442.24, y1: 54.769, x2: 442.24, y2: 419.38, transform: "matrix(1 0 0 -1 0 514)", stops: [[0.043, "#2052cb"], [0.489, "#367af2"], [0.943, "#16bbda"]] },
  { id: "f", x1: 435.596, y1: 270.413, x2: 425.732, y2: 385.266, transform: "matrix(1 0 0 -1 0 514)", stops: [[0.134, "#16bbda", 0], [0.932, "#6be7a0", 0.8629]] },
  { id: "g", x1: 437.081, y1: 204.362, x2: 507.893, y2: 119.081, transform: "matrix(1 0 0 -1 0 514)", stops: [[0, "#2c68e0", 0], [0.898, "#66c0ff", 0.5]] },
  { id: "h", x1: 99.399, y1: 279.26, x2: 352.75, y2: 498.676, transform: "matrix(1 0 0 -1 0 514)", stops: [[0.005, "#367af2"], [0.507, "#0fafff"], [1, "#26cfe8"]] },
  { id: "i", x1: 184.342, y1: 356.795, x2: 338.581, y2: 480.642, transform: "matrix(1 0 0 -1 0 514)", stops: [[0.443, "#26cfe8", 0], [0.897, "#6be7a0", 0.8629]] },
];
const AZ_LEFT = "M116.1 73.4c-5.8 5.8-13.7 13.8-13.7 22.6v216.4c0 8.9-3.3 17.3-9 23.4s-13.3 9.2-21.1 8.5l-42.7-3.1c-7.9-.5-15-3.9-20.3-9.3-5.7-5.7-9.3-13.7-9.3-22.6V202.7c0-8.9 3.6-16.9 9.4-22.6l2-1.9z";
const AZ_FOOT = "m500.5 366-128 106.7c-5.5 4.6-12.7 7.4-20.5 7.4q-2.4 0-4.8-.3l-112.5-16.9v27.8c0 11.7-9.6 21.3-21.3 21.3-7.3 0-13.5-3.6-17.5-9.1l-36.2-51.4-5.4-7.6-36.6-51.9-7-10c-2.6-3.5-3.9-7.8-3.9-12.3 0-6 2.5-11.6 6.8-15.7 3.8-3.7 9.1-5.8 14.5-5.8.4 0 1 .1 1.5.1l105.2 7.5L384 366.5l93.7 6.7c.7.1 1.6.1 2.3.1 7.8 0 14.9-2.7 20.5-7.3";
const AZ_RIGHT = "M512 170.7v170.7c0 9.9-4.5 18.8-11.5 24.6l-128 106.7c7-5.9 11.5-14.7 11.5-24.6V175.3c0-16.7 13-30.7 29.8-31.9l63.9-4.6c.7-.1 1.6-.1 2.3-.1 7.8 0 14.9 2.8 20.5 7.4 7 5.8 11.5 14.6 11.5 24.6";
const AZ_TOP = "M384 125.5c0 11.2-8.6 20.5-19.8 21.3-.5 0-1.1.1-1.6.1l-127.9 9.2-132.3 9.1-72.7 5.5c-6.9.4-13.2 3.1-18.2 7.4L116.1 73.4c4.7-4.7 10.9-8 17.8-9.1l100.8-15.1V21.3C234.7 9.6 244.3 0 256 0c5.8 0 11.1 2.3 14.9 6.1l33.4 32.6 16.9 16.5 40.3 39.3 16.1 15.8c4.1 3.9 6.4 9.4 6.4 15.2";
/** Azure's layers in order: a shape, its gradient, and how much of it shows. */
const AZ_LAYERS: [string, string, number?][] = [[AZ_LEFT, "a"], [AZ_LEFT, "b"], [AZ_FOOT, "c"], [AZ_FOOT, "d"], [AZ_RIGHT, "e"], [AZ_RIGHT, "f", 0.7], [AZ_RIGHT, "g"], [AZ_TOP, "h"], [AZ_TOP, "i", 0.5]];

/** A gradient's ids are this mark's own, so two Azure marks on one page don't share theirs. */
function Defs({ grads, pre }: { grads: Grad[]; pre: string }) {
  return (
    <defs>
      {grads.map((g) => (
        <linearGradient key={g.id} id={`${pre}${g.id}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} gradientTransform={g.transform} gradientUnits="userSpaceOnUse">
          {g.stops.map(([o, c, a], i) => (
            <stop key={i} offset={o} stopColor={c} stopOpacity={a} />
          ))}
        </linearGradient>
      ))}
    </defs>
  );
}

/** A host's or tracker's mark, `size` pixels square. */
export function ScmIcon({ id, size = 18 }: { id: ScmMark; size?: number }) {
  const pre = `scm${useId().replace(/[^\w-]/g, "")}`;
  const box = { width: size, height: size, "aria-hidden": true as const, focusable: false as const };
  switch (id) {
    case "git":
      return (
        <svg {...box} viewBox="0 0 256 256">
          <path fill="#DE4C36" d="M251.17 116.6 139.4 4.82a16.49 16.49 0 0 0-23.31 0l-23.21 23.2 29.44 29.45a19.57 19.57 0 0 1 24.8 24.96l28.37 28.38a19.61 19.61 0 1 1-11.75 11.06L137.28 95.4v69.64a19.62 19.62 0 1 1-16.13-.57V94.2a19.61 19.61 0 0 1-10.65-25.73L81.46 39.44 4.83 116.08a16.49 16.49 0 0 0 0 23.32L116.6 251.17a16.49 16.49 0 0 0 23.32 0l111.25-111.25a16.5 16.5 0 0 0 0-23.33" />
        </svg>
      );
    case "github":
      return (
        <svg {...box} viewBox="0 0 16 16">
          <path fill="currentColor" fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" />
        </svg>
      );
    case "gitlab":
      return (
        <svg {...box} viewBox="0 0 32 32">
          <path fill="#E24329" d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z" />
          <path fill="#FC6D26" d="m31.46 12.78-.04-.12a14.75 14.75 0 0 0-5.86 2.64l-9.55 7.24 6.09 4.6 6.67-5h.02a8.09 8.09 0 0 0 2.67-9.36Z" />
          <path fill="#FCA326" d="m9.9 27.14 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48-6.1-4.6-6.07 4.6Z" />
          <path fill="#FC6D26" d="M6.44 15.3a14.71 14.71 0 0 0-5.86-2.63l-.05.12a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 6.1-4.6-9.56-7.24Z" />
        </svg>
      );
    case "bitbucket":
      return (
        <svg {...box} viewBox="8.4 14.39 2481.29 2231.21">
          <Defs pre={pre} grads={[{ id: "a", x1: 945.1094, y1: 1524.8389, x2: 944.4923, y2: 1524.1893, transform: "matrix(1996.6343 0 0 -1480.3047 -1884485.625 2258195)", stops: [[0.18, "#0052CC"], [1, "#2684FF"]] }]} />
          <path fill="#2684FF" d="M88.92,14.4C45.02,13.83,8.97,48.96,8.41,92.86c-0.06,4.61,0.28,9.22,1.02,13.77l337.48,2048.72 c8.68,51.75,53.26,89.8,105.74,90.24h1619.03c39.38,0.5,73.19-27.9,79.49-66.78l337.49-2071.78c7.03-43.34-22.41-84.17-65.75-91.2 c-4.55-0.74-9.15-1.08-13.76-1.02L88.92,14.4z M1509.99,1495.09H993.24l-139.92-731h781.89L1509.99,1495.09z" />
          <path fill={`url(#${pre}a)`} d="M2379.27,763.06h-745.5l-125.12,730.42H992.31l-609.67,723.67c19.32,16.71,43.96,26,69.5,26.21h1618.13 c39.35,0.51,73.14-27.88,79.44-66.72L2379.27,763.06z" />
        </svg>
      );
    case "azure":
      return (
        <svg {...box} viewBox="0 0 512 512">
          <Defs pre={pre} grads={AZURE_GRADS} />
          {AZ_LAYERS.map(([d, g, o], i) => (
            <path key={i} d={d} fill={`url(#${pre}${g})`} fillOpacity={o} />
          ))}
        </svg>
      );
    case "forgejo":
      return (
        <svg {...box} viewBox="-6 -6 212 212" fill="none">
          <path d="M58 168 v-98 a50 50 0 0 1 50-50 h20" stroke="#ff6600" strokeWidth={25} />
          <path d="M58 168 v-30 a50 50 0 0 1 50-50 h20" stroke="#d40000" strokeWidth={25} />
          <path d="M124 20 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0z" stroke="#ff6600" strokeWidth={15} />
          <path d="M124 88 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0z" stroke="#d40000" strokeWidth={15} />
          <path d="M40 180 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0z" stroke="#d40000" strokeWidth={15} />
        </svg>
      );
    case "origin":
      return (
        <svg {...box} viewBox="0 0 466.73 532.09">
          <path fill="currentColor" d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
        </svg>
      );
    case "linear":
      return (
        <svg {...box} viewBox="0 0 100 100" fill="none">
          <path fill="currentColor" d="M1.225 61.523c-.222-.949.908-1.546 1.597-.857l36.512 36.512c.69.69.092 1.82-.857 1.597C20.15 94.612 5.388 79.85 1.225 61.523ZM.002 46.889a.99.99 0 0 0 .29.76l52.062 52.061a.99.99 0 0 0 .76.29c2.765-.169 5.47-.559 8.1-1.152.75-.169 1.014-1.084.47-1.63L2.784 38.32c-.545-.545-1.46-.28-1.63.47A50.229 50.229 0 0 0 .002 46.89ZM4.472 29.34a.99.99 0 0 0 .208 1.104l64.878 64.877a.99.99 0 0 0 1.104.208 50.293 50.293 0 0 0 5.807-3.132.99.99 0 0 0 .154-1.53L9.135 23.38a.99.99 0 0 0-1.53.154 50.29 50.29 0 0 0-3.132 5.807ZM12.293 18.229c-.309-.309-.334-.803-.045-1.13C21.376 6.626 34.637 0 49.45 0 76.869 0 99.1 22.231 99.1 49.65c0 14.813-6.626 28.074-17.099 37.202-.327.29-.821.264-1.13-.045L12.293 18.23Z" />
        </svg>
      );
  }
}

/** A host's or tracker's name, as the app writes it. */
export const SCM_NAME: Record<ScmMark, string> = { git: "Git", github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", azure: "Azure DevOps", forgejo: "Forgejo / Gitea", origin: "Cursor Origin", linear: "Linear" };
