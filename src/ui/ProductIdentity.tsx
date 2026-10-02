import { useState } from "react";
import { IDENTITY_FIELDS, identityOf, identityText, type ExactProduct, type IdentityKey, type ProductIdentity } from "../model/productIdentity";
import { products, type ProductRequest } from "../model/productLibrary";
import { Link } from "./ProductSource";
import { type SourceRef } from "../model/products";

function Sources({ sources }: { sources?: SourceRef[] }) {
  return <>{(sources ?? []).map((s, i) => <div key={i}><Link url={s.url} locator={s.locator} />{s.locator ? ` (${s.locator})` : ""}</div>)}</>;
}
export function ExactIdentity({ product, request }: { product: ExactProduct; request?: ProductRequest }) {
  const identity = identityOf(product);
  const reviewComponents = product.components !== undefined || product.componentsStatus !== undefined || !!request?.submission?.warnings.some(w => w.field === "components");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const review = (key: string, required: boolean) => !request || !required ? null : request.reviews[key] ? <span>{request.reviews[key].decision}{request.reviews[key].reason ? `: ${request.reviews[key].reason}` : ""}</span> : <div className="review-actions">
    <button type="button" onClick={() => { const r = products.review(request.id, key, "accepted"); setError(r.ok ? "" : r.summary); }}>Accept</button>
    <input aria-label={`Reason to reject ${key}`} placeholder="reason to reject" value={reason[key] ?? ""} onChange={e => setReason({ ...reason, [key]: e.target.value })} />
    <button type="button" onClick={() => { const r = products.review(request.id, key, "rejected", reason[key]); setError(r.ok ? "" : r.summary); }}>Reject</button>
  </div>;
  const warnings = (key: string) => request?.submission?.warnings.filter(w => w.field === key).map((w, i) => <div key={i} className="inspector-warn">⚠ {w.message}</div>);
  return <section className="product-identity" aria-label="Exact product identity">
    <table className="products-table"><thead><tr><th>Exact identity</th><th>Value</th><th>Evidence</th>{request && <th>Review</th>}</tr></thead><tbody>
      {(Object.keys(IDENTITY_FIELDS) as IdentityKey[]).map(key => <tr key={key} data-identity={key} {...(request && product.identity ? { "data-field": `identity.${key}` } : {})}>
        <td>{IDENTITY_FIELDS[key]}</td><td>{identityText(identity[key])}</td>
        <td><Sources sources={identity[key].sources} />{identity[key].note}{identity[key].alternatives?.map((a, i) => <div key={i}>Alternative: {a.value}<Sources sources={[a.source]} /></div>)}{warnings(`identity.${key}`)}</td>
        {request && <td>{review(`identity.${key}`, !!product.identity)}</td>}
      </tr>)}
      <tr data-components {...(request && reviewComponents ? { "data-field": "components" } : {})}>
        <td>Components</td><td>{product.componentsStatus ?? "unknown"}</td><td>{(product.components ?? []).map((c, i) => <div key={i} data-component={i}>
          <b>{c.name}</b> · code {identityText(c.code)} · quantity {c.quantity ?? "unknown"} · {c.provision}<Sources sources={c.code.sources} />{c.code.alternatives?.map((a, j) => <div key={j}>Alternative code: {a.value}<Sources sources={[a.source]} /></div>)}<Sources sources={c.sources} />{c.note}
        </div>)}{warnings("components")}</td>{request && <td>{review("components", reviewComponents)}</td>}
      </tr>
    </tbody></table>{error && <span role="alert">{error}</span>}
  </section>;
}

/** Request evidence is a hint for research, never an accepted specification. */
export function IdentityEditor({ identity, onChange }: { identity: ProductIdentity; onChange: (identity: ProductIdentity) => void }) {
  const set = (key: IdentityKey, patch: Partial<ProductIdentity[IdentityKey]>) => onChange({ ...identity, [key]: { ...identity[key], ...patch } });
  return <fieldset><legend>Exact variant details</legend>{(Object.keys(IDENTITY_FIELDS) as IdentityKey[]).map(key => <div key={key}>
    <label className="field">{IDENTITY_FIELDS[key]} status<select value={identity[key].state} onChange={e => set(key, { state: e.target.value as ProductIdentity[IdentityKey]["state"], value: null, sources: undefined })}><option>unknown</option><option>known</option><option>not-applicable</option></select></label>
    {identity[key].state === "known" && <label className="field">{IDENTITY_FIELDS[key]} exact value{key === "handedness" ? <select value={identity[key].value ?? ""} onChange={e => set(key, { value: e.target.value })}><option value="">Choose documented handedness</option>{["left", "right", "reversible", "non-handed"].map(v => <option key={v}>{v}</option>)}</select> : <input value={identity[key].value ?? ""} onChange={e => set(key, { value: e.target.value })} />}</label>}
    {identity[key].state !== "unknown" && <><label className="field">{IDENTITY_FIELDS[key]} source URL<input value={identity[key].sources?.[0]?.url ?? ""} onChange={e => set(key, { sources: [{ url: e.target.value, locator: identity[key].sources?.[0]?.locator ?? "" }] })} /></label><label className="field">{IDENTITY_FIELDS[key]} source locator<input value={identity[key].sources?.[0]?.locator ?? ""} onChange={e => set(key, { sources: [{ url: identity[key].sources?.[0]?.url ?? "", locator: e.target.value }] })} /></label></>}
  </div>)}</fieldset>;
}
