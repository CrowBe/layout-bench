import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { store, actions, initializeProjects } from "./model/store";
import { bootstrapWebMCP } from "./mcp/bootstrap";
import "./styles.css";

initializeProjects();

bootstrapWebMCP();

// Debug/testing hook (also handy for judges poking at the console).
// runTool executes the same wrapped tool pipeline WebMCP uses (logged to the activity feed).
import { runToolManually } from "./mcp/tools";
(window as unknown as { __alza: unknown }).__alza = { store, actions, runTool: runToolManually };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
