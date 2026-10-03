/**
 * Products page (#30). The human opens a request, the page shows the brief the agent must
 * complete, and a submitted brief comes back here for field-by-field review. Accepting a
 * product is only possible here: it is not a tool.
 */

import { Link, viewAttachment } from "./ProductSource";
import { ExactIdentity, IdentityEditor } from "./ProductIdentity";
import { MeasurementEditor, NewMeasurements } from "./ProductMeasurements";
import { evidenceText, measurementFields } from "../model/productMeasurements";
import { unknownIdentity, identityOf, identityText, exactProductLabel, type ProductComponent } from "../model/productIdentity";
import { ProductReviewSummary } from "./ProductReviewSummary";
import { currentReview } from "../model/productReview";
import { useEffect, useState } from "react";
import { logActivity } from "../model/store";
import { formatMm } from "../model/geometry";
import { PRODUCT_CATEGORIES, REFERENCES, applies, type AxisValue, categoryById, envelopeOf, productPlacementProblem, type FieldSpec, type FieldValue, type ProductCategory } from "../model/products";
import { MAX_ATTACHMENT_BYTES, requestEvidenceAttachments, products, productReviewWarnings, useProductStore, type LibraryProduct, type LibraryResult, type ProductAttachment, type ProductRequest } from "../model/productLibrary";

const human = (tool: string, r: LibraryResult) => {
  logActivity("human", tool, r.summary, r.ok);
  return r;
};

function shown(f: FieldSpec, v: FieldValue | undefined): string {
  if (!v || v.value === null || v.value === undefined) return "unknown";
  return f.type === "length" && typeof v.value === "number" ? `${formatMm(v.value)} mm` : String(v.value);
}

const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Spec sheets attached to a request (#34): upload while open, view and read their text at any time. */
function Attachments({ req }: { req: ProductRequest }) {
  const list = requestEvidenceAttachments(req);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const open = req.status === "open";
  const showImage = async (a: ProductAttachment) => {
    if (preview?.id === a.id) { setPreview(null); return; }
    const blob = await products.file(a.id);
    if (!blob) { setError("This browser no longer has the file (site data cleared?)."); return; }
    setPreview({ id: a.id, url: URL.createObjectURL(blob) });
  };
  if (!open && !list.length) return null;
  return (
    <section className="products-attachments" aria-label="Attachments">
      <strong>Spec sheets</strong>
      {open && (
        <span className="hint">
          Attach the spec sheet you already have (PDF or image, up to {MAX_ATTACHMENT_BYTES / 1048576} MB). It stays in this browser.
          A PDF's text is read page by page for the agent, which cites it by page. An image is for your review only: it has no text for the agent.
          Scanned PDFs are not OCR'd.
        </span>
      )}
      {list.map((a) => {
        const withText = a.pages?.filter((p) => p.text.trim()).length ?? 0;
        return (
          <div key={a.id} className="products-attachment" data-attachment={a.id}>
            <div>
              <b>{a.kind === "pdf" ? "PDF" : "Image"}</b> {a.name}{!req.attachments?.some(own => own.id === a.id) && <span className="hint"> · read-only original evidence</span>} <span className="hint">· {sizeText(a.size)} · <code>attachment:{a.id}</code></span>
            </div>
            <div className="hint" data-text-status>
              {a.kind === "image"
                ? "Image: no text for the agent. If it needs what this shows, it will ask you to paste it into the conversation."
                : withText === 0
                  ? `${a.pages?.length ?? 0} page(s), no text found (a scan?). Not OCR'd, so the agent cannot read it.`
                  : `${a.pages!.length} page(s), text on ${withText}; the agent reads this text.`}
            </div>
            <div className="products-actions">
              {a.kind === "image"
                ? <button type="button" onClick={() => void showImage(a)}>{preview?.id === a.id ? "Hide" : "View"}</button>
                : <button type="button" onClick={() => void viewAttachment(a).then((e) => setError(e ?? ""))}>View</button>}
              {open && req.attachments?.some(own => own.id === a.id) && (
                <button type="button" onClick={() => void products.detach(req.id, a.id).then((r) => { human("detach_product_attachment", r); setError(r.ok ? "" : r.summary); })}>Remove</button>
              )}
            </div>
            {preview?.id === a.id && <img className="products-attachment-image" src={preview.url} alt={a.name} />}
            {a.kind === "pdf" && (a.pages?.length ?? 0) > 0 && (
              <details>
                <summary>Text the agent reads</summary>
                {a.pages!.map((p) => (
                  <div key={p.page} data-page={p.page}>
                    <div className="hint">Page {p.page}</div>
                    <pre className="products-page-text">{p.text || "(no text on this page)"}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
      {open && (
        <label className="field">
          Attach spec sheet
          <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif" disabled={busy}
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              setBusy(true);
              setNote("Reading…");
              const r = human("attach_product_spec_sheet", await products.attach(req.id, file));
              setBusy(false);
              input.value = "";
              setError(r.ok ? "" : r.summary);
              setNote(r.ok ? r.summary : "");
            }} />
        </label>
      )}
      {note && <span className="hint" role="status">{note}</span>}
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </section>
  );
}

/** One rough-in axis: its value or range and the datum it is measured from. */
function axisText(a: AxisValue | undefined): string {
  if (!a) return "—";
  const v = a.value !== undefined ? `${formatMm(a.value)} mm`
    : a.min !== undefined || a.max !== undefined ? `${a.min !== undefined ? formatMm(a.min) : "?"}–${a.max !== undefined ? formatMm(a.max) : "?"} mm`
    : "unknown";
  return `${v} from ${a.from.replace("-", " ")}`;
}

const identity = (r: ProductRequest) =>
  (r.known.physicalItem?.label ?? ([r.known.brand, r.known.model].filter(Boolean).join(" ") || r.known.reference || r.known.link || r.id)) + Object.values(identityOf(r.known)).filter(v => v.state === "known").map(v => ` · ${identityText(v)}`).join("");

function unit(f: FieldSpec): string {
  if (f.type === "length") return `mm, ${formatMm(f.min)}–${formatMm(f.max)}`;
  if (f.type === "choice") return f.options.join(" / ");
  if (f.type === "count") return `${f.min}–${f.max}`;
  return "text";
}

function NewRequest() {
  const [category, setCategory] = useState(PRODUCT_CATEGORIES[0].id);
  const [known, setKnown] = useState({ brand: "", model: "", reference: "", link: "", notes: "" });
  const [variant, setVariant] = useState(unknownIdentity);
  const [components, setComponents] = useState<ProductComponent[]>([]);
  const [component, setComponent] = useState({ name: "", code: "", quantity: "", provision: "unresolved", url: "", locator: "" });
  const [error, setError] = useState("");
  const field = (k: keyof typeof known, label: string) => (
    <label className="field">
      {label}
      <input value={known[k]} onChange={(e) => setKnown({ ...known, [k]: e.target.value })} />
    </label>
  );
  return (
    <form className="products-card" aria-label="New product request" onSubmit={(e) => {
      e.preventDefault();
      const r = human("request_product", products.request(category, { ...known, identity: variant, ...(components.length ? { components, componentsStatus: "documented" as const } : {}) }));
      setError(r.ok ? "" : r.summary);
      if (r.ok) { setKnown({ brand: "", model: "", reference: "", link: "", notes: "" }); setVariant(unknownIdentity()); setComponents([]); }
    }}>
      <strong>New request</strong>
      <label className="field">
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {PRODUCT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      {field("brand", "Brand")}
      {field("model", "Model")}
      {field("reference", "Quote line or product code")}
      {field("link", "Link")}
      {field("notes", "Notes")}
      <IdentityEditor identity={variant} onChange={setVariant} />
      <details><summary>Record component evidence</summary>
        {Object.entries({ name: "Component name", code: "Component code", quantity: "Component quantity", url: "Component source URL", locator: "Component source locator" }).map(([key, label]) => <label className="field" key={key}>{label}<input value={component[key as keyof typeof component]} onChange={e => setComponent({ ...component, [key]: e.target.value })} /></label>)}
        <label className="field">Component provision<select value={component.provision} onChange={e => setComponent({ ...component, provision: e.target.value })}><option>unresolved</option><option>included</option><option>separately-required</option></select></label>
        <button type="button" onClick={() => { setComponents([...components, { name: component.name, code: { state: component.code ? "known" : "unknown", value: component.code || null, ...(component.code ? { sources: [{ url: component.url, locator: component.locator }] } : {}) }, quantity: component.quantity.trim() ? Number(component.quantity) : null, provision: component.provision as ProductComponent["provision"], sources: [{ url: component.url, locator: component.locator }] }]); setComponent({ name: "", code: "", quantity: "", provision: "unresolved", url: "", locator: "" }); }}>Add component evidence</button>
        {components.map((c, i) => <div key={i}>{c.name} · {c.code.value ?? "unknown"} · {c.provision}<button type="button" onClick={() => setComponents(components.filter((_, n) => n !== i))}>Remove component</button></div>)}
      </details>
      {error && <span className="inspector-error" role="alert">{error}</span>}
      <button className="primary" type="submit">Open request</button>
    </form>
  );
}

function Brief({ cat, req }: { cat: ProductCategory; req: ProductRequest }) {
  return (
    <>
      <p className="hint">
        Ask your agent: <em>“Research product request <code>{req.id}</code>: read its brief with get_product_brief and submit it with submit_product_spec.”</em>
      </p>
      <table className="products-table" aria-label="Brief">
        <thead><tr><th>Field</th><th>Unit</th><th>Measured from</th><th>Needed</th><th>Definition</th></tr></thead>
        <tbody>
          {cat.fields.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td>{unit(f)}</td>
              <td>{f.type === "length" && f.reference ? REFERENCES[f.reference] : "—"}</td>
              <td>{f.required ? "required" : "optional"}{f.when ? ` (when ${f.when.field} is ${f.when.in.join(" or ")})` : ""}</td>
              <td>{f.definition}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cat.placement && <p className="hint">Placement limits: {cat.placement.limitation} Installation geometry is pending issue #51. Product requirements here are separate from proposed project mounting heights.</p>}
    </>
  );
}

function ReviewRow({ req, f }: { req: ProductRequest; f: FieldSpec }) {
  const v = req.submission!.fields[f.key];
  const review = currentReview(req, f.key);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const flags = productReviewWarnings(req).filter((w) => w.field === f.key || w.field === null);
  if (!v) return null;
  const decide = (decision: "accepted" | "rejected") => {
    const r = human("review_product_field", products.review(req.id, f.key, decision, reason));
    setError(r.ok ? "" : r.summary);
  };
  return (
    <tr data-field={f.key} className={review ? `reviewed-${review.decision}` : ""}>
      <td>{f.label}{!applies(f, req.submission!.fields) && <span className="hint"> (not applicable)</span>}</td>
      <td className={v.value === null ? "unknown" : ""}>{shown(f, v)}</td>
      <td>{v.value === null ? "—" : v.status}</td>
      <td>
        {(v.sources ?? []).map((s, i) => (
          <div key={i}><Link url={s.url} locator={s.locator} />{s.locator ? `, ${s.locator}` : ""}</div>
        ))}
        {v.note && <div className="hint">{v.note}</div>}
        {v.measurement && <div className="hint">{evidenceText(v)} · datum {v.reference ?? "not spatial"}</div>}
        {v.observations && <div data-observations>{v.observations.map((observation, index) => <p key={index}>Observation {index + 1}: {shown(f, observation)} · {observation.status ?? "unknown"} · {observation.reference ?? "not spatial"} · {evidenceText(observation)} · {observation.note}</p>)}</div>}
        {req.previousRejections?.[f.key] && review?.decision !== "rejected" && <div className="hint">Previously rejected: {req.previousRejections[f.key]}</div>}
        {flags.map((w, i) => <div key={i} className="inspector-warn">⚠ {w.message}</div>)}
      </td>
      <td>
        {review && <span>{review.decision}{review.reason ? `: ${review.reason}` : ""}</span>}
        {(!review || review.decision === "rejected") && (
            <div className="review-actions">
              <button type="button" onClick={() => decide("accepted")}>{review ? "Accept individually after rejection" : "Accept"}</button>
              <input aria-label={`Reason to reject ${f.label}`} placeholder="reason to reject" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="button" onClick={() => decide("rejected")}>Reject</button>
            </div>
          )}
        {error && <span className="inspector-error" role="alert">{error}</span>}
      </td>
    </tr>
  );
}

function RequestDetail({ req }: { req: ProductRequest }) {
  const cat = categoryById(req.category)!;
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const act = (tool: string, r: LibraryResult) => { human(tool, r); setError(r.ok ? "" : r.summary); };
  return (
    <section className="products-card" aria-label="Selected request">
      <strong>{cat.label}: {identity(req)}</strong>
      <span className="hint">Request <code>{req.id}</code> · status <b data-status={req.status}>{req.status}</b></span>
      {Object.entries(req.known).filter(([k]) => !["identity", "components", "componentsStatus", "physicalItem"].includes(k)).map(([k, v]) => <span key={k} className="hint">{k}: {k === "link" ? <Link url={String(v)}>{String(v)}</Link> : String(v)}</span>)}
      {req.known.physicalItem && <p className="hint">Physical item: {req.known.physicalItem.label} · manufacturer/model unknown · {req.known.physicalItem.notes}</p>}
      {req.feedback && <div className="inspector-warn">Returned to the agent: {req.feedback}</div>}
      <span>Request evidence</span>
      <ExactIdentity product={{ manufacturer: req.known.brand ?? "", model: req.known.model ?? "", identity: req.known.identity, components: req.known.components, componentsStatus: req.known.componentsStatus }} />
      <Attachments req={req} />
      {req.status === "accepted" && req.submission && <><span>Accepted research</span><ExactIdentity product={req.submission} request={req} /></>}
      {req.status === "submitted" && req.submission ? (
        <>
          <span>Submitted: <b>{req.submission.manufacturer} {req.submission.model}</b>{req.submission.code ? ` (${req.submission.code})` : ""}</span>
          <ProductReviewSummary request={req} />
          <ExactIdentity product={req.submission} request={req} />
          <table className="products-table" aria-label="Submitted values">
            <thead><tr><th>Field</th><th>Value</th><th>Status</th><th>Source</th><th>Review</th></tr></thead>
            <tbody>{(req.mode ? measurementFields(cat) : cat.fields).map((f) => <ReviewRow key={f.key} req={req} f={f} />)}</tbody>
          </table>
          <div className="products-actions">
            <button className="primary" type="button" onClick={() => act("accept_product", products.accept(req.id))}>Accept product</button>
            <input aria-label="Feedback for the agent" placeholder="what needs another look" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <button type="button" onClick={() => act("return_product_request", products.returnToAgent(req.id, feedback))}>{req.mode ? "Reopen measurements" : "Return to agent"}</button>
          </div>
        </>
      ) : req.status === "open" ? req.mode ? <MeasurementEditor request={req} /> : <Brief cat={cat} req={req} /> : null}
      {req.status !== "accepted" && req.status !== "withdrawn" && (
        <button type="button" onClick={() => act("withdraw_product_request", products.withdraw(req.id))}>Withdraw request</button>
      )}
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </section>
  );
}

function ProductCard({ p }: { p: LibraryProduct }) {
  const cat = categoryById(p.category);
  const env = cat ? envelopeOf(cat, p.fields) : null;
  return (
    <details className="products-product" data-product={p.id}>
      <summary>
        <b>{exactProductLabel(p)}</b> · {cat?.label ?? p.category}
        {env ? ` · ${formatMm(env.w)} × ${formatMm(env.d)} × ${formatMm(env.h)} mm` : " · envelope unknown"}
      </summary>
      {cat?.placement && <p className="hint" data-placement-limit>{productPlacementProblem(cat, p.fields) ?? `Generic envelope only. ${cat.placement.limitation}`}</p>}
      <span className="hint">{Object.entries(identityOf(p)).map(([key, value]) => `${key}: ${identityText(value)}`).join(" · ")}</span>
      <ExactIdentity product={p} />
      {cat && (
        <table className="products-table">
          <tbody>
            {(p.recordingMode ? measurementFields(cat) : cat.fields).filter((f) => p.fields[f.key]).map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td className={p.fields[f.key].value === null ? "unknown" : ""}>{shown(f, p.fields[f.key])}</td>
                <td>{p.fields[f.key].value === null ? "—" : p.fields[f.key].status}</td>
                <td>{(p.fields[f.key].sources ?? []).map((s, i) => <span key={i}><Link url={s.url} locator={s.locator}>{s.locator ?? "source"}</Link> </span>)}{p.fields[f.key].measurement && evidenceText(p.fields[f.key])}{p.fields[f.key].reference ? ` · datum ${p.fields[f.key].reference}` : ""}{p.fields[f.key].observations && <span> · {p.fields[f.key].observations!.length} retained observations</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(p.roughIn ?? []).length > 0 && (
        <table className="products-table" aria-label="Rough-in points">
          <thead><tr><th>Service point</th><th>Across</th><th>Out</th><th>Up</th></tr></thead>
          <tbody>
            {p.roughIn.map((r) => (
              <tr key={r.id} data-point={r.id}>
                <td>{r.label}{!r.resolved && <div className="inspector-warn">missing {r.missing.join(", ")}</div>}</td>
                {([r.across, r.out, r.up] as const).map((a, i) => <td key={i}>{axisText(a)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => human("remove_product", products.removeProduct(p.id))}>Remove from library</button>
      {p.physicalItem && <button type="button" onClick={() => human("open_human_measurements", products.openMeasurements(p.category, p.physicalItem!, p.fields, p.requestId))}>Record more measurements</button>}
    </details>
  );
}

export function ProductsPage() {
  const requests = useProductStore((s) => s.requests);
  const library = useProductStore((s) => s.products);
  const selected = useProductStore((s) => s.requests.find((r) => r.id === s.selectedRequestId));
  const loadError = useProductStore((s) => s.loadError);
  return (
    <div className="products-page" role="dialog" aria-label="Product library">
      <header className="products-header">
        <strong>Product library</strong>
        <span className="hint">Shared by every project in this browser. Your agent researches; you accept.</span>
        <button type="button" onClick={() => products.show(false)}>Back to plan</button>
      </header>
      {loadError && <div className="save-banner" role="alert">{loadError}</div>}
      <div className="products-body">
        <div className="products-col">
          <NewRequest />
          <NewMeasurements />
          <section className="products-card" aria-label="Requests">
            <strong>Requests</strong>
            {requests.length === 0 && <span className="hint">None yet.</span>}
            {[...requests].reverse().map((r) => (
              <button key={r.id} type="button" className={`products-request ${r.id === selected?.id ? "active" : ""}`} onClick={() => products.select(r.id)}>
                <span>{categoryById(r.category)?.label}: {identity(r)}</span>
                <span className={`badge status-${r.status}`}>{r.status}</span>
              </button>
            ))}
          </section>
          <section className="products-card" aria-label="Library">
            <strong>Library</strong>
            {library.length === 0 && <span className="hint">No accepted products yet.</span>}
            {library.map((p) => <ProductCard key={p.id} p={p} />)}
          </section>
        </div>
        <div className="products-col wide">
          {selected ? <RequestDetail key={selected.id} req={selected} /> : <p className="hint">Open a request, or pick one from the list.</p>}
        </div>
      </div>
    </div>
  );
}
