import { useState, type ChangeEvent } from "react";
import { projects, useAppStore } from "../model/store";
import { DEMO_ID, sampleStatus } from "../model/projects";
import { download } from "./download";


export function ProjectChooser() {
  const list = useAppStore((s) => s.projects);
  const activeId = useAppStore((s) => s.activeProjectId);
  const saveError = useAppStore((s) => s.saveError);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [importText, setImportText] = useState<string | null>(null);
  const [importName, setImportName] = useState("");

  const create = (fromDemo: boolean) => {
    const result = projects.create(name || (fromDemo ? "Bathroom Concept copy" : "Untitled project"), fromDemo);
    setMessage(result.ok ? "" : result.summary);
  };
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportText(await file.text());
    setImportName(file.name.replace(/\.json$/i, ""));
    event.target.value = "";
  };

  return <div className="project-page">
    <div className="project-shell">
      <div className="project-heading"><span className="brand-mark">▲</span><strong>Reno Layouts</strong><span>Projects on this browser</span></div>
      <h1>Choose a plan</h1>
      <p className="hint">Your projects and underlays stay in this browser. Export JSON backups before clearing browser data or changing devices.</p>
      {saveError && <div className="project-error" role="alert">
        <strong>Saved data needs attention</strong><p>{saveError}</p>
        <button onClick={() => { const raw = projects.exportOriginalStorage(); if (raw) download("reno-layouts-original-storage.json", raw); }}>Download original saved data</button>
        <button className="danger" onClick={() => { if (window.confirm("Replace unreadable browser data? Download the original first; this cannot be undone.")) projects.resetUnreadableStorage(); }}>Reset saved library</button>
      </div>}
      <div className="project-list">
        {list.map((project) => <div className="project-card" key={project.id}>
          <div><strong>{project.model.name}</strong><small>{project.id === DEMO_ID ? "Shipped sample" : "Saved locally"} · {project.model.walls.length} walls · {project.notes.length} notes</small>
            {project.id === DEMO_ID && sampleStatus(project) !== "current" && <small className="sample-outdated" role="status">
              A newer version of this sample is available. Reset sample loads it and replaces this copy, including any edits; Export JSON first to keep them.
            </small>}</div>
          <div className="project-actions">
            <button className="primary" onClick={() => setMessage(projects.open(project.id).summary)}>Open</button>
            <button onClick={() => download(`${project.model.name.replace(/[^a-z0-9-_]+/gi, "-")}.json`, projects.export(project.id))}>Export JSON</button>
            {project.id === DEMO_ID && <button onClick={() => {
              if (window.confirm("Reset Bathroom Concept to the shipped sample? Its current edits will be lost.")) setMessage(projects.resetDemo().summary);
            }}>Reset sample</button>}
            {project.id !== DEMO_ID && <button className="danger" onClick={() => {
              if (window.confirm(`Delete “${project.model.name}” from this browser? This cannot be undone.`)) setMessage(projects.remove(project.id).summary);
            }}>Delete</button>}
          </div>
        </div>)}
      </div>
      <div className="project-create">
        <label className="field">New project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bathroom Survey" /></label>
        <div className="project-actions"><button onClick={() => create(false)}>Create blank</button><button onClick={() => create(true)}>Duplicate Bathroom Concept</button></div>
      </div>
      <div className="project-create">
        <label className="field">Import project JSON<input type="file" accept=".json,application/json" onChange={onFile} /></label>
        {importText !== null && <><label className="field">Name for imported copy<input value={importName} onChange={(event) => setImportName(event.target.value)} /></label>
          <button onClick={() => setMessage(projects.import(importText, importName).summary)}>Import as new project</button></>}
      </div>
      {activeId && <button onClick={() => projects.open(activeId)}>Return to current plan</button>}
      {message && <p role="status" className="hint">{message}</p>}
    </div>
  </div>;
}
