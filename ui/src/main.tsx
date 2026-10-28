import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/wdth.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./liner/foundation.css";
import "./app/app.css";
import { App } from "./app/App";
import { startLiquidGlass } from "./liner/lib/liquid-glass";
import { enableWindowDrag, quietFields, quietMenus, trackFrameGlass } from "./app/bridge";

document.body.classList.add("l-root", "l-scope");
// Liner's glass for real: what floats (menus, popovers, the rail, toasts) blurs and bends what's
// behind it at the Clear to Tinted you chose, instead of standing in for it with a flat tint.
document.documentElement.dataset.blur = "live";
startLiquidGlass();
enableWindowDrag();
quietFields();
quietMenus();
trackFrameGlass();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
