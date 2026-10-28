/*
  npm run dev: the engine (watching its files) on 7317 and the Vite dev server on 5179, together.
  Open http://localhost:5179 in a browser, or the Electron window against it: npm run app:dev
  Sessions go to ~/.liner-code unless LINER_HOME says otherwise.
*/
import { spawn } from "node:child_process";

const kids = [
  spawn("node", ["--watch", "engine/src/main.ts", "--port", "7317", "--dev"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "ui"], { stdio: "inherit" }),
];
const stop = () => {
  for (const k of kids) k.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const k of kids) k.on("exit", (code) => code && stop());
