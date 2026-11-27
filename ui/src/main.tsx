import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import interLatin from "@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url";
import "@fontsource-variable/instrument-sans/wdth.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./liner/foundation.css";
import "./app/app.css";
import "./app/halftone.css";
import { App } from "./app/App";
import { Boundary } from "./app/Boundary";
import { enableWindowDrag, quietFields, quietMenus } from "./app/bridge";

// The first paint's text is Inter's latin face: fetched now, not when the stylesheet first asks for it.
// The same hashed file the @font-face points at, so it is fetched once.
const preload = Object.assign(document.createElement("link"), { rel: "preload", as: "font", type: "font/woff2", href: interLatin, crossOrigin: "anonymous" });
document.head.appendChild(preload);

document.body.classList.add("l-root", "l-scope");
// One solid ground: what floats is solid, and the session tray draws its own glass, so Liner's
// live blur and lens stay off.
enableWindowDrag();
quietFields();
quietMenus();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary label="Liner Code">
      <App />
    </Boundary>
  </StrictMode>,
);
