/** Human catalogue acceptance and instance updates remain two separate decisions. */
import { useState } from "react";
import { actions, logActivity, useAppStore } from "../model/store";
import {
  products,
  useProductStore,
  type LibraryProduct,
  type ProductRequest,
} from "../model/productLibrary";
import { revisionDifferences, revisionOf } from "../model/productRevision";
import type { ProductUpdatePreview } from "../model/productUpdates";
import { formatMm } from "../model/geometry";

const display = (value: unknown) =>
  value === undefined ? "omitted" : JSON.stringify(value, null, 2);

export function RevisionDraftEvidence({
  request,
}: {
  request: ProductRequest;
}) {
  const prior = useProductStore((s) =>
    s.products.find((p) => p.id === request.revisionOf),
  );
  if (!prior) return null;
  const differences = request.submission
    ? revisionDifferences(prior, request.submission)
    : [];
  return (
    <section
      aria-label="Catalogue revision comparison"
      className="products-card"
    >
      <strong>
        Revision of accepted catalogue record {revisionOf(prior).number}
      </strong>
      <p>
        Prior evidence and reviews remain in history. Changed fields need fresh
        human review; unchanged approvals may be reused explicitly. A different
        exact variant must be a separate product. Accepting this record does not
        update placed fixtures.
      </p>
      {request.submission && (
        <table className="products-table">
          <thead>
            <tr>
              <th>Evidence changed</th>
              <th>Prior accepted evidence</th>
              <th>Revision evidence</th>
            </tr>
          </thead>
          <tbody>
            {differences.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>
                  <pre>{display(row.before)}</pre>
                </td>
                <td>
                  <pre>{display(row.after)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!differences.length && (
        <p>No evidence differences currently recorded.</p>
      )}
    </section>
  );
}

export function ProductRevisionActions({
  product,
}: {
  product: LibraryProduct;
}) {
  const [error, setError] = useState("");
  return (
    <section aria-label="Catalogue revision history">
      <p>
        Catalogue revision {revisionOf(product).number} · series{" "}
        {revisionOf(product).seriesId}
        {product.revision?.parentProductId
          ? ` · previous ${product.revision.parentProductId}`
          : ""}
        . This is application history.
      </p>
      <button
        type="button"
        onClick={() => {
          const result = products.reviseProduct(product.id);
          logActivity(
            "human",
            "draft_product_revision",
            result.summary,
            result.ok,
          );
          setError(result.ok ? "" : result.summary);
        }}
      >
        Draft catalogue revision
      </button>
      {error && <p role="alert">{error}</p>}
      <InstanceRevisionUpdate product={product} />
    </section>
  );
}

function InstanceRevisionUpdate({ product }: { product: LibraryProduct }) {
  const items = useAppStore((s) => s.model.items);
  const library = useProductStore((s) => s.products);
  const [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<ProductUpdatePreview | null>(null),
    [acknowledged, setAcknowledged] = useState(false),
    [error, setError] = useState("");
  const eligible = items.filter((item) => {
    const before =
      item.productSnapshot ?? library.find((p) => p.id === item.productId);
    return (
      before &&
      revisionOf(before).seriesId === revisionOf(product).seriesId &&
      revisionOf(before).number < revisionOf(product).number
    );
  });
  if (!eligible.length) return null;
  const geometry = (
    entry: ProductUpdatePreview["rows"][number]["geometryAfter"],
  ) =>
    entry
      ? `${formatMm(entry.w)} × ${formatMm(entry.d)} × ${formatMm(entry.h)} mm; ${entry.outline ? "source outline" : "envelope"}`
      : "unresolved";
  return (
    <section
      aria-label="Update selected fixture revisions"
      className="products-card"
    >
      <strong>Review updates to placed fixtures</strong>
      <p>
        Existing instances keep their pinned revision. Select each instance
        explicitly, preview geometry, services and clashes, then apply. Anchors
        and measured/site-confirmed connections are retained; disagreements
        require individual reconciliation.
      </p>
      {eligible.map((item) => (
        <label className="field" key={item.id}>
          <input
            type="checkbox"
            aria-label={`Update instance ${item.id}`}
            checked={selected.includes(item.id)}
            onChange={(event) => {
              setSelected(
                event.target.checked
                  ? [...selected, item.id]
                  : selected.filter((id) => id !== item.id),
              );
              setPreview(null);
              setAcknowledged(false);
            }}
          />
          {item.id} · current catalogue revision{" "}
          {
            revisionOf(
              item.productSnapshot ??
                library.find((p) => p.id === item.productId)!,
            ).number
          }
        </label>
      ))}
      <button
        type="button"
        disabled={!selected.length}
        onClick={() => {
          setPreview(actions.previewProductRevision(product.id, selected));
          setAcknowledged(false);
          setError("");
        }}
      >
        Preview selected instance updates
      </button>
      {preview && (
        <section aria-label="Selected instance update preview">
          {preview.rows.map((row) => (
            <div key={row.id} className="products-card">
              <strong>{row.id}</strong>
              <p>
                {geometry(row.geometryBefore)} → {geometry(row.geometryAfter)}
              </p>
              <details>
                <summary>Outline, services, dimensions and evidence</summary>
                <pre>{display({ before: row.before, after: row.after })}</pre>
              </details>
              {row.blocked && <p role="alert">{row.blocked}</p>}
              {row.preserved.map((note) => (
                <p key={note}>Preserved: {note}</p>
              ))}
              {row.unresolved.map((note) => (
                <p key={note} className="inspector-warn">
                  Reconciliation / unresolved: {note}
                </p>
              ))}
            </div>
          ))}
          <strong>Projected clashes and unresolved checks</strong>
          {preview.issues.length ? (
            preview.issues.map((issue, index) => (
              <p key={index}>
                {issue.severity}: {issue.message}
              </p>
            ))
          ) : (
            <p>No projected checks reported for these instances.</p>
          )}
          <label>
            <input
              aria-label="Acknowledge selected revision preview"
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />{" "}
            I reviewed these selected updates, preserved confirmations and
            unresolved reconciliation notes.
          </label>
          <button
            type="button"
            disabled={!preview.applicable || !acknowledged}
            onClick={() => {
              const result = actions.applyProductRevision(preview);
              logActivity(
                "human",
                "apply_selected_product_revision",
                result.summary,
                result.ok,
              );
              setError(result.ok ? "" : result.summary);
              if (result.ok) {
                setPreview(null);
                setSelected([]);
                setAcknowledged(false);
              }
            }}
          >
            Apply revision to selected instances
          </button>
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setAcknowledged(false);
              setError("");
            }}
          >
            Cancel update preview
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
