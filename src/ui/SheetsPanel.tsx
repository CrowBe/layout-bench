/**
 * Sheets tab (#29): the title block, the preflight findings, a live preview and issuing.
 * A blocking finding can be acknowledged here with a reason, the same way an agent can; the
 * reason is printed on the issued sheet. Issuing goes through the same action as export_sheet.
 */

import { useMemo, useState } from "react";
import { actions, logActivity, useAppStore } from "../model/store";
import { SHEETS, checkSheet, type SheetFinding } from "../sheets/check";
import { renderFloorPlan } from "../sheets/floorPlan";
import { recordIssued, useIssued } from "../sheets/issued";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function TitleBlock() {
  const tb = useAppStore((s) => s.model.sheetSet?.titleBlock ?? {});
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
  const issued = useIssued();
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
      recordIssued(sheet, r.rev as string, r.svg as string);
      setReasons({});
      setNote("");
    }
  };

  return (
    <div className="sheets-panel" aria-label="Sheets">
      <TitleBlock />
      <div className="sheets-card">
        <strong>{SHEETS[0].number} {SHEETS[0].title}</strong>
        <span className={blocking.length ? "inspector-warn" : "hint"}>
          {blocking.length ? `${blocking.length} blocking: fix, or acknowledge each with a reason.` : "Issuable."} {findings.length - blocking.length} unresolved item(s) will be listed on the sheet.
        </span>
        <ul className="sheets-findings">
          {findings.map((f) => <Finding key={key(f)} f={f} reason={reasons[key(f)] ?? ""} onReason={(v) => setReasons({ ...reasons, [key(f)]: v })} />)}
        </ul>
        <label className="field">Revision note<input aria-label="Revision note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for plumber's quote" /></label>
        <button type="button" className="primary" onClick={issue}>Issue rev {String.fromCharCode(65 + Math.min(25, revisions.length))}</button>
        {message && <span role="status" className="hint">{message}</span>}
      </div>
      <div className="sheets-card">
        <strong>Preview</strong>
        <div className="sheets-preview" aria-label="Sheet preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <button type="button" onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(`<!doctype html><title>Preview</title>${preview}`); w.document.close(); } }}>Open preview full size</button>
      </div>
      <div className="sheets-card">
        <strong>Issued</strong>
        {revisions.length === 0 && <span className="hint">Nothing issued yet.</span>}
        {revisions.map((r) => (
          <span key={r.rev} className="hint">Rev {r.rev} · {r.date}{r.note ? ` · ${r.note}` : ""}{r.acknowledged.length ? ` · ${r.acknowledged.length} acknowledged` : ""}</span>
        ))}
        {issued && (
          <div className="sheets-actions">
            <button type="button" onClick={() => download(`${model.name.replace(/[^\w-]+/g, "-")}-${issued.sheet}-rev-${issued.rev}.svg`, issued.svg)}>Download rev {issued.rev} (SVG)</button>
            <button type="button" onClick={() => printSheet(issued.svg)}>Print / save as PDF</button>
          </div>
        )}
      </div>
    </div>
  );
}
