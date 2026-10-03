/**
 * Sheets tab (#29): the title block, the preflight findings, a live preview and issuing.
 * A blocking finding can be acknowledged here with a reason, the same way an agent can; the
 * reason is printed on the issued sheet. Issuing goes through the same action as export_sheet.
 */

import { useMemo, useState } from "react";
import { actions, logActivity, useAppStore } from "../model/store";
import { SHEETS, checkSheet, revisionLetter, type SheetFinding } from "../sheets/check";
import { download } from "./download";
import { renderFloorPlan } from "../sheets/floorPlan";
import { recordIssued, useIssued } from "../sheets/issued";
import { composeView, useDiagramView, useLastExport } from "../sheets/viewState";
import { renderStageDiagram } from "../sheets/stageView";
import { useProductStore } from "../model/productLibrary";
import { planningEvidence } from "../model/productRevision";

/**
 * The stage view an agent composed (#41): what it shows, a preview, and the last exported
 * diagram and specification sheet. Read-only here: the view is composed with set_diagram_view.
 */
function StageViewCard({ projectId, fileBase }: { projectId: string | null; fileBase: string }) {
  const model = useAppStore((s) => s.model);
  const view = useDiagramView(projectId);
  const last = useLastExport();
  const exported = last && last.projectId === projectId ? last : null;
  const products = useProductStore((s) => s.products);
  const composed = useMemo(() => (view ? composeView(model, view, products) : null), [model, view, products]);
  const preview = useMemo(() => (view && composed ? renderStageDiagram(model, composed.resolution.elements, { label: view.label, findings: composed.findings, products }) : ""), [model, view, composed, products]);
  const slug = (s: string) => s.replace(/[^\w-]+/g, "-");
  return (
    <div className="sheets-card stage-view-card" aria-label="Stage view">
      <strong>Stage view</strong>
      {!view && <span className="hint">No stage view composed. An agent composes one with list_diagram_content and set_diagram_view; it only changes what is shown, never the model.</span>}
      {view && composed && (
        <>
          <span className="hint" data-stage-label>{view.label}: {composed.resolution.elements.length} element(s) visible. {composed.findings.filter((f) => f.severity === "blocking").length} blocking, {composed.findings.filter((f) => f.severity === "advisory").length} unresolved.</span>
          <div className="sheets-preview" aria-label="Stage preview" dangerouslySetInnerHTML={{ __html: preview }} />
        </>
      )}
      {exported && (
        <div className="sheets-actions">
          <span className="hint">{exported.modelEvidence === planningEvidence(model) ? "Export matches current planning evidence." : "Historical export: current planning evidence differs or its legacy reference was not captured."}</span>
          <button type="button" onClick={() => download(`${fileBase}-${slug(exported.label)}-diagram.svg`, exported.svg, "image/svg+xml")}>Download "{exported.label}" diagram (SVG)</button>
          <button type="button" onClick={() => download(`${fileBase}-${slug(exported.label)}-spec.html`, exported.specHtml, "text/html")}>Download "{exported.label}" spec (HTML)</button>
        </div>
      )}
    </div>
  );
}

/** Open the sheet alone, sized to A3 landscape, and hand it to the browser's print-to-PDF. */
function printSheet(svg: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><title>Sheet</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}svg{display:block;width:420mm;height:297mm}</style>${svg}`);
  w.document.close();
  w.focus();
  w.print();
}

function TitleBlock({ tb }: { tb: { project?: string; site?: string; preparedBy?: string } }) {
  const [draft, setDraft] = useState({ project: tb.project ?? "", site: tb.site ?? "", preparedBy: tb.preparedBy ?? "" });
  const field = (k: keyof typeof draft, label: string) => (
    <label className="field">{label}<input aria-label={label} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
  );
  return (
    <div className="sheets-card">
      <strong>Title block</strong>
      {field("project", "Project")}
      {field("site", "Site / room")}
      {field("preparedBy", "Prepared by")}
      <button type="button" onClick={() => { const r = actions.setSheetInfo(draft); logActivity("human", "set_sheet_info", r.summary, r.ok); }}>Save title block</button>
    </div>
  );
}

function Finding({ f, reason, onReason }: { f: SheetFinding; reason: string; onReason: (v: string) => void }) {
  return (
    <li className={`sheets-finding ${f.severity}`} data-code={f.code}>
      <span className="badge">{f.severity}</span> {f.message}
      {f.fix && <div className="hint">Fix: {f.fix.hint} ({f.fix.tool})</div>}
      {f.severity === "blocking" && (
        <input aria-label={`Acknowledge ${f.code} on ${f.ref}`} placeholder="or acknowledge: why this is fine to issue (printed)" value={reason} onChange={(e) => onReason(e.target.value)} />
      )}
    </li>
  );
}

export function SheetsPanel() {
  const model = useAppStore((s) => s.model);
  // select the stored object itself (stable between renders), never a fresh `?? {}`
  const titleBlock = useAppStore((s) => s.model.sheetSet?.titleBlock);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const lastIssued = useIssued();
  const issued = lastIssued && lastIssued.projectId === activeProjectId ? lastIssued : null;
  const [sheet] = useState<string>(SHEETS[0].id);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const findings = useMemo(() => checkSheet(model, sheet), [model, sheet]);
  const preview = useMemo(() => renderFloorPlan(model, { sheet, findings, revision: null }), [model, sheet, findings]);
  const blocking = findings.filter((f) => f.severity === "blocking");
  const key = (f: SheetFinding) => `${f.code}|${f.ref}`;
  const revisions = model.sheetSet?.revisions ?? [];

  const issue = () => {
    const acknowledge = blocking.filter((f) => reasons[key(f)]?.trim()).map((f) => ({ code: f.code, ref: f.ref, reason: reasons[key(f)] }));
    const r = actions.exportSheet(sheet, { acknowledge, note, by: "human" });
    logActivity("human", "export_sheet", r.summary, r.ok);
    setMessage(r.summary);
    if (r.ok) {
      recordIssued(activeProjectId, sheet, r.rev as string, r.svg as string);
      setReasons({});
      setNote("");
    }
  };

  return (
    <div className="sheets-panel" aria-label="Sheets">
      {/* keyed on the stored values, so an agent edit, undo or project switch refreshes the form */}
      <TitleBlock key={`${activeProjectId}:${JSON.stringify(titleBlock ?? null)}`} tb={titleBlock ?? {}} />
      <div className="sheets-card">
        <strong>{SHEETS[0].number} {SHEETS[0].title}</strong>
        <span className={blocking.length ? "inspector-warn" : "hint"}>
          {blocking.length ? `${blocking.length} blocking: fix, or acknowledge each with a reason.` : "Issuable."} {findings.length - blocking.length} unresolved item(s) will be listed on the sheet.
        </span>
        <ul className="sheets-findings">
          {findings.map((f) => <Finding key={key(f)} f={f} reason={reasons[key(f)] ?? ""} onReason={(v) => setReasons({ ...reasons, [key(f)]: v })} />)}
        </ul>
        <label className="field">Revision note<input aria-label="Revision note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for plumber's quote" /></label>
        <button type="button" className="primary" onClick={issue}>Issue rev {revisionLetter(revisions.length)}</button>
        {message && <span role="status" className="hint">{message}</span>}
      </div>
      <div className="sheets-card">
        <strong>Preview</strong>
        <div className="sheets-preview" aria-label="Sheet preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <button type="button" onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(`<!doctype html><title>Preview</title>${preview}`); w.document.close(); } }}>Open preview full size</button>
      </div>
      <StageViewCard projectId={activeProjectId} fileBase={model.name.replace(/[^\w-]+/g, "-")} />
      <div className="sheets-card">
        <strong>Issued</strong>
        {revisions.length === 0 && <span className="hint">Nothing issued yet.</span>}
        {revisions.map((r) => (
          <div key={r.rev} className="hint">Rev {r.rev} · {r.date}{r.note ? ` · ${r.note}` : ""}{r.acknowledged.length ? ` · ${r.acknowledged.length} acknowledged` : ""}
            {r.content ? <><span> · {r.content.modelEvidence === planningEvidence(model) ? "matches current planning evidence" : "historical: planning evidence has changed"}</span><button type="button" onClick={() => download(`${model.name.replace(/[^\w-]+/g, "-")}-${r.sheet}-rev-${r.rev}.svg`,r.content!.svg,"image/svg+xml")}>Download issued rev {r.rev}</button><button type="button" onClick={() => printSheet(r.content!.svg)}>Print issued rev {r.rev}</button></> : <span> · legacy issue metadata; original content was not stored</span>}
          </div>
        ))}
        {issued && (
          <div className="sheets-actions">
            <button type="button" onClick={() => download(`${model.name.replace(/[^\w-]+/g, "-")}-${issued.sheet}-rev-${issued.rev}.svg`, issued.svg, "image/svg+xml")}>Download rev {issued.rev} (SVG)</button>
            <button type="button" onClick={() => printSheet(issued.svg)}>Print / save as PDF</button>
          </div>
        )}
      </div>
    </div>
  );
}
