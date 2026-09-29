/** App shell — header (view/camera/tools status), editor or 3D scene, sidebar, activity feed. */

import { useAppStore, actions, logActivity, projects } from "../model/store";
import { Editor } from "../editor/Editor";
import { Scene3D } from "../three/Scene3D";
import { Sidebar } from "./Sidebar";
import { ActivityFeed } from "./ActivityFeed";
import { ApprovalBar } from "./ApprovalBar";
import { SupplierBridge } from "./SupplierBridge";
import { bus, EVENTS } from "../three/exportBus";
import { ProjectChooser } from "./ProjectChooser";
import { Inspector } from "./Inspector";

/** Pointer snap choices for the 2D editor, in metres. Typed values and tools are never snapped. */
const SNAP_STEPS: [number, string][] = [[0, "Off"], [0.001, "1 mm"], [0.01, "10 mm"], [0.05, "50 mm"], [0.1, "100 mm"]];

export function App() {
  const view = useAppStore((s) => s.editor.view);
  const camera = useAppStore((s) => s.editor.camera);
  const drawMode = useAppStore((s) => s.editor.drawMode);
  const snapStep = useAppStore((s) => s.editor.snapStep);
  const webmcpStatus = useAppStore((s) => s.webmcpStatus);
  const planName = useAppStore((s) => s.model.name);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const chooserOpen = useAppStore((s) => s.chooserOpen);
  const saveError = useAppStore((s) => s.saveError);
  const pendingApprovals = useAppStore((s) => s.approvals.length);

  if (chooserOpen || !activeProjectId) return <ProjectChooser />;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">▲</span>
          <span className="brand-name">Alza</span>
          <span className="brand-plan">{planName}</span>
          <button onClick={() => projects.showChooser()} disabled={pendingApprovals > 0} title={pendingApprovals ? "Resolve the pending agent request before switching projects" : undefined}>Projects</button>
        </div>

        <div className="header-group">
          {view === "2d" ? (
            <>
              <button className={drawMode === "select" ? "active" : ""} onClick={() => actions.setDrawMode("select")}>
                Select
              </button>
              <button className={drawMode === "wall" ? "active" : ""} onClick={() => actions.setDrawMode("wall")}>
                + Wall
              </button>
              <button className={drawMode === "room" ? "active" : ""} onClick={() => actions.setDrawMode("room")}>
                + Room
              </button>
              <label className="snap-select" title="Pointer snap while drawing and dragging. Typed values are never snapped.">
                Snap
                <select value={snapStep} onChange={(e) => actions.setSnapStep(Number(e.target.value))}>
                  {SNAP_STEPS.map(([step, label]) => <option key={step} value={step}>{label}</option>)}
                </select>
              </label>
              <button
                onClick={() => {
                  const r = actions.undo();
                  logActivity("human", "undo", r.summary, r.ok);
                }}
              >
                Undo
              </button>
            </>
          ) : (
            <>
              {(["orbit", "top", "walk"] as const).map((m) => (
                <button key={m} className={camera === m ? "active" : ""} onClick={() => actions.setCamera(m)}>
                  {m === "orbit" ? "Orbit" : m === "top" ? "Top" : "Walk"}
                </button>
              ))}
              <button onClick={() => bus.emit(EVENTS.EXPORT_OBJ)}>Export OBJ</button>
              <button onClick={() => bus.emit(EVENTS.EXPORT_PNG)}>Snapshot PNG</button>
            </>
          )}
        </div>

        <div className="header-group">
          <button className="primary" onClick={() => (view === "2d" ? actions.build3d() : actions.setView("2d"))}>
            {view === "2d" ? "Build 3D ▲" : "Back to 2D"}
          </button>
          <span className={`pill ${webmcpStatus}`} title={webmcpStatus === "live" ? "WebMCP runtime detected — tools are live for your agent" : "No WebMCP runtime — use the Tools tab to run tools manually"}>
            {webmcpStatus === "live" ? "● Site tools live" : "○ Site tools off"}
          </span>
        </div>
      </header>
      {saveError && <div className="save-banner" role="alert">{saveError} <button onClick={() => projects.showChooser()}>Export backup</button></div>}

      <main className="main">
        <div className="canvas-area">
          {view === "2d" ? <Editor key={activeProjectId} /> : <Scene3D key={activeProjectId} />}
          {view === "2d" && <Inspector />}
        </div>
        <Sidebar />
      </main>

      <SupplierBridge />
      <ApprovalBar />
      <ActivityFeed />
    </div>
  );
}
