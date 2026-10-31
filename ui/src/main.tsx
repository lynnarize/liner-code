import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/wdth.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./liner/foundation.css";
import "./app/app.css";
import { App } from "./app/App";
import { Boundary } from "./app/Boundary";
import { enableWindowDrag, quietFields, quietMenus } from "./app/bridge";

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
