/** Human-only measurement capture. Each added observation keeps the original evidence. */
import { useState } from "react";
import { categoryById, REFERENCES, type FieldObservation, type FieldSpec } from "../model/products";
import { evidenceText, measurementFields, measurementUnit, withObservation, workingObservation } from "../model/productMeasurements";
import { products, HUMAN_MEASURABLE, type ProductRequest, type LibraryResult } from "../model/productLibrary";
import { VALUE_STATUSES } from "../model/faces";
import { formatMm } from "../model/geometry";
import { logActivity } from "../model/store";
import type { ValueStatus } from "../model/types";

const human = (tool: string, result: LibraryResult) => { logActivity("human", tool, result.summary, result.ok); return result; };
const show = (field: FieldSpec, value: number | string | null) => value === null ? "unknown" : field.type === "length" && typeof value === "number" ? `${formatMm(value)} mm` : field.type === "quantity" ? `${value} ${field.unit}` : String(value);

export function NewMeasurements() {
  const [category, setCategory] = useState("vanity"), [label, setLabel] = useState(""), [notes, setNotes] = useState(""), [error, setError] = useState("");
  return <form className="products-card" aria-label="New measured fitting" onSubmit={event => {
    event.preventDefault();
    const result = human("open_human_measurements", products.openMeasurements(category, { label, notes }));
    setError(result.ok ? "" : result.summary);
    if (result.ok) { setLabel(""); setNotes(""); }
  }}>
    <strong>Record a reused fitting</strong>
    <span className="hint">Identify the physical item with notes and attached photos. Brand/model may remain unknown. Photographs do not supply measurements automatically.</span>
    <label className="field">Measured category<select value={category} onChange={event => setCategory(event.target.value)}>{HUMAN_MEASURABLE.map(id => <option key={id} value={id}>{categoryById(id)!.label}</option>)}</select></label>
    <label className="field">Physical fitting label<input value={label} onChange={event => setLabel(event.target.value)} /></label>
    <label className="field">Physical identification notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
    {error && <span role="alert">{error}</span>}
    <button type="submit">Open human measurements</button>
  </form>;
}

function MeasurementField({ request, field }: { request: ProductRequest; field: FieldSpec }) {
  const current = request.measurementDraft?.[field.key];
  const [value, setValue] = useState(""), [status, setStatus] = useState("unknown"), [unit, setUnit] = useState(""), [datum, setDatum] = useState(""), [date, setDate] = useState(""), [dateNote, setDateNote] = useState(""), [evidence, setEvidence] = useState(""), [note, setNote] = useState(""), [url, setUrl] = useState(""), [locator, setLocator] = useState(""), [error, setError] = useState("");
  const add = () => {
    if (status !== "unknown" && !unit) { setError("Choose the unit explicitly."); return; }
    let observation: FieldObservation;
    if (status === "unknown") observation = { value: null, note };
    else {
      if (!value.trim()) { setError("Enter the value, or choose unknown and explain it."); return; }
      const numeric = field.type === "length" || field.type === "count" || field.type === "quantity";
      const number = Number(value) / (field.type === "length" && unit === "mm" ? 1000 : 1);
      if (numeric && !Number.isFinite(number)) { setError("The value must be a finite number."); return; }
      observation = { value: numeric ? number : value, status: status as ValueStatus, note,
        ...(field.type === "length" ? { reference: datum as keyof typeof REFERENCES } : {}),
        ...(status === "published" ? { sources: [{ url, locator }] } : { measurement: { unit: measurementUnit(field), date: date || null, ...(date ? {} : { dateNote }), evidence, recordedBy: "human" as const } }) };
    }
    const result = human("record_human_observation", products.recordMeasurement(request.id, field.key, withObservation(current, observation)));
    setError(result.ok ? "" : result.summary);
  };
  const observations = current?.observations ?? [];
  return <details className="products-card" data-measurement-field={field.key}>
    <summary>{field.label}: <b>{show(field, current?.value ?? null)}</b>{current?.status ? ` · ${current.status}` : ""}</summary>
    <span className="hint">{field.definition}</span>
    {current && <p data-working-evidence>{evidenceText(current)}{current.reference ? ` · datum ${current.reference}` : ""}{current.note ? ` · ${current.note}` : ""}</p>}
    <label className="field">Observation status<select value={status} onChange={event => setStatus(event.target.value)}><option value="unknown">unknown</option>{VALUE_STATUSES.map(item => <option key={item}>{item}</option>)}</select></label>
    {status !== "unknown" && <>
      <label className="field">Observation value{field.type === "choice" ? <select value={value} onChange={event => setValue(event.target.value)}><option value="">Choose value</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : <input value={value} onChange={event => setValue(event.target.value)} />}</label>
      <label className="field">Observation unit<select value={unit} onChange={event => setUnit(event.target.value)}><option value="">Choose unit</option>{(field.type === "length" ? ["mm", "metres"] : [measurementUnit(field)]).map(option => <option key={option}>{option}</option>)}</select></label>
      {field.type === "length" && <label className="field">Physical datum<select value={datum} onChange={event => setDatum(event.target.value)}><option value="">Choose datum</option>{Object.entries(REFERENCES).map(([key, description]) => <option key={key} value={key}>{key}: {description}</option>)}</select></label>}
      {status === "published" ? <>
        <label className="field">Published source URL<input value={url} onChange={event => setUrl(event.target.value)} /></label>
        <label className="field">Published source locator<input value={locator} onChange={event => setLocator(event.target.value)} /></label>
      </> : <>
        <label className="field">Measurement date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label className="field">Unknown date explanation<input value={dateNote} onChange={event => setDateNote(event.target.value)} placeholder="If original measurement date is not known" /></label>
        <label className="field">Measurement evidence / reference<textarea value={evidence} onChange={event => setEvidence(event.target.value)} /></label>
      </>}
    </>}
    <label className="field">Observation note<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Explain unknowns or the physical datum" /></label>
    <button type="button" onClick={add}>Record observation</button>
    {error && <span role="alert">{error}</span>}
    {observations.length > 0 && <>
      <label className="field">Working evidence<select aria-label={`Working evidence for ${field.label}`} value="" onChange={event => {
        const result = human("choose_human_working_evidence", products.recordMeasurement(request.id, field.key, workingObservation(current!, Number(event.target.value))));
        setError(result.ok ? "" : result.summary);
      }}><option value="" disabled>Choose an existing observation</option>{observations.map((observation, index) => <option key={index} value={index}>{index + 1}: {show(field, observation.value)} · {observation.status ?? "unknown"} · {observation.reference ?? "no spatial datum"}</option>)}</select></label>
      <table className="products-table" aria-label={`Evidence history for ${field.label}`}><tbody>{observations.map((observation, index) => <tr key={index}><td>{show(field, observation.value)}</td><td>{observation.status ?? "unknown"}</td><td>{observation.reference ?? "—"}</td><td>{evidenceText(observation)} {observation.note}</td></tr>)}</tbody></table>
    </>}
  </details>;
}

export function MeasurementEditor({ request }: { request: ProductRequest }) {
  const [error, setError] = useState("");
  return <section aria-label="Human measurement editor">
    <p>Record each working value explicitly. Unknowns and every observation are retained. Published evidence needs a located source; measured/estimated/proposed/site-confirmed evidence needs human provenance. Site-confirmed is your recorded status, not an automatic trade confirmation.</p>
    {measurementFields(categoryById(request.category)!).map(field => <MeasurementField key={`${request.id}:${field.key}`} request={request} field={field} />)}
    <button type="button" onClick={() => { const result = human("submit_human_measurements", products.submitMeasurements(request.id)); setError(result.ok ? "" : result.summary); }}>Submit measurements for review</button>
    {error && <span role="alert">{error}</span>}
  </section>;
}
