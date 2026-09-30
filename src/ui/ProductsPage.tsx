/**
 * Products page (#30). The human opens a request, the page shows the brief the agent must
 * complete, and a submitted brief comes back here for field-by-field review. Accepting a
 * product is only possible here: it is not a tool.
 */

import { useState, type ReactNode } from "react";
import { logActivity } from "../model/store";
import { formatMm } from "../model/geometry";
import { PRODUCT_CATEGORIES, REFERENCES, applies, safeUrl, categoryById, envelopeOf, type FieldSpec, type FieldValue, type ProductCategory } from "../model/products";
import { products, useProductStore, type LibraryProduct, type LibraryResult, type ProductRequest } from "../model/productLibrary";

const human = (tool: string, r: LibraryResult) => {
  logActivity("human", tool, r.summary, r.ok);
  return r;
};

function shown(f: FieldSpec, v: FieldValue | undefined): string {
  if (!v || v.value === null || v.value === undefined) return "unknown";
  return f.type === "length" && typeof v.value === "number" ? `${formatMm(v.value)} mm` : String(v.value);
}

/** An external link, only when it is http(s); otherwise plain text. */
function Link({ url, children }: { url: string; children?: ReactNode }) {
  const href = safeUrl(url);
  const text = children ?? (href ? new URL(href).hostname : url);
  return href ? <a href={href} target="_blank" rel="noreferrer noopener">{text}</a> : <span>{text}</span>;
}

const identity = (r: ProductRequest) =>
  [r.known.brand, r.known.model].filter(Boolean).join(" ") || r.known.reference || r.known.link || r.id;

function unit(f: FieldSpec): string {
  if (f.type === "length") return `mm, ${formatMm(f.min)}–${formatMm(f.max)}`;
  if (f.type === "choice") return f.options.join(" / ");
  if (f.type === "count") return `${f.min}–${f.max}`;
  return "text";
}

function NewRequest() {
  const [category, setCategory] = useState(PRODUCT_CATEGORIES[0].id);
  const [known, setKnown] = useState({ brand: "", model: "", reference: "", link: "", notes: "" });
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
      const r = human("request_product", products.request(category, known));
      setError(r.ok ? "" : r.summary);
      if (r.ok) setKnown({ brand: "", model: "", reference: "", link: "", notes: "" });
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
    </>
  );
}

function ReviewRow({ req, f }: { req: ProductRequest; f: FieldSpec }) {
  const v = req.submission!.fields[f.key];
  const review = req.reviews[f.key];
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const flags = req.submission!.warnings.filter((w) => w.field === f.key);
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
          <div key={i}><Link url={s.url} />{s.locator ? `, ${s.locator}` : ""}</div>
        ))}
        {v.note && <div className="hint">{v.note}</div>}
        {flags.map((w, i) => <div key={i} className="inspector-warn">⚠ {w.message}</div>)}
      </td>
      <td>
        {review
          ? <span>{review.decision}{review.reason ? `: ${review.reason}` : ""}</span>
          : (
            <div className="review-actions">
              <button type="button" onClick={() => decide("accepted")}>Accept</button>
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
      {Object.entries(req.known).map(([k, v]) => <span key={k} className="hint">{k}: {k === "link" ? <Link url={v}>{v}</Link> : v}</span>)}
      {req.feedback && <div className="inspector-warn">Returned to the agent: {req.feedback}</div>}
      {req.status === "submitted" && req.submission ? (
        <>
          <span>Submitted: <b>{req.submission.manufacturer} {req.submission.model}</b>{req.submission.code ? ` (${req.submission.code})` : ""}</span>
          <table className="products-table" aria-label="Submitted values">
            <thead><tr><th>Field</th><th>Value</th><th>Status</th><th>Source</th><th>Review</th></tr></thead>
            <tbody>{cat.fields.map((f) => <ReviewRow key={f.key} req={req} f={f} />)}</tbody>
          </table>
          <div className="products-actions">
            <button className="primary" type="button" onClick={() => act("accept_product", products.accept(req.id))}>Accept product</button>
            <input aria-label="Feedback for the agent" placeholder="what needs another look" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <button type="button" onClick={() => act("return_product_request", products.returnToAgent(req.id, feedback))}>Return to agent</button>
          </div>
        </>
      ) : req.status === "open" ? <Brief cat={cat} req={req} /> : null}
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
        <b>{p.manufacturer} {p.model}</b> · {cat?.label ?? p.category}
        {env ? ` · ${formatMm(env.w)} × ${formatMm(env.d)} × ${formatMm(env.h)} mm` : " · envelope unknown"}
      </summary>
      {cat && (
        <table className="products-table">
          <tbody>
            {cat.fields.filter((f) => p.fields[f.key]).map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td className={p.fields[f.key].value === null ? "unknown" : ""}>{shown(f, p.fields[f.key])}</td>
                <td>{p.fields[f.key].value === null ? "—" : p.fields[f.key].status}</td>
                <td>{(p.fields[f.key].sources ?? []).map((s, i) => <span key={i}><Link url={s.url}>{s.locator ?? "source"}</Link> </span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => human("remove_product", products.removeProduct(p.id))}>Remove from library</button>
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
