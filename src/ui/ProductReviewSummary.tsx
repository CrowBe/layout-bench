import { useState } from "react";
import { productReviewSummary } from "../model/productReview";
import {
  products,
  type LibraryResult,
  type ProductRequest,
} from "../model/productLibrary";
import { logActivity } from "../model/store";
import { formatMm } from "../model/geometry";
import { measurementFields, evidenceText } from "../model/productMeasurements";
import { categoryById, REFERENCES } from "../model/products";
import { Link } from "./ProductSource";

/** Evidence is visible before each named human group confirmation. */
export function ProductReviewSummary({ request }: { request: ProductRequest }) {
  const summary = productReviewSummary(request);
  const category = categoryById(request.category)!;
  const fields = request.mode ? measurementFields(category) : category.fields;
  const [error, setError] = useState("");
  const act = (name: string, result: LibraryResult) => {
    logActivity("human", name, result.summary, result.ok);
    setError(result.ok ? "" : result.summary);
  };
  return (
    <section
      aria-label={request.mode ? "Measurement completeness" : "Research completeness"}
      className="product-review-summary"
    >
      <strong>{request.mode ? "Measurement completeness" : "Research completeness"}</strong>
      <p>
        {summary.applicableRequired.length} applicable required fields ·{" "}
        {summary.unknownRequired.length} unknown · {summary.conflicts.length}{" "}
        conflicts · {summary.datumMismatches.length} datum mismatches ·{" "}
        {summary.flags.length} validation findings · {summary.pending.length}{" "}
        pending reviews · {summary.rejected.length} rejected reviews
      </p>
      {!!summary.unknownRequired.length && (
        <p>
          Unknown required fields: {summary.unknownRequired.join(", ")}.
          Individual acceptance acknowledges missing evidence; it does not
          supply a value.
        </p>
      )}
      {summary.rejected.map((key) => (
        <p className="inspector-warn" key={key}>
          {key}: rejected — {request.reviews[key]?.reason}
        </p>
      ))}
      {!!summary.flags.length && (
        <details>
          <summary>Validation findings</summary>
          {summary.flags.map((flag, index) => (
            <p className="inspector-warn" key={index}>
              {flag.code}: {flag.message}
            </p>
          ))}
        </details>
      )}
      {summary.groups.map(({ group, eligible }) => (
        <details key={group}>
          <summary>
            Review {group} ({eligible.length} clean pending fields)
          </summary>
          <p>
            Only applicable known fields without validation findings can be
            accepted together. Unknown, flagged and previously rejected fields
            require individual review.
          </p>
          <table
            className="products-table"
            aria-label={`${group} group evidence`}
          >
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Status and datum</th>
                <th>Source</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {summary.fields
                .filter((row) => row.group === group && row.submitted)
                .map((row) => {
                  const spec = fields.find(
                    (field) => field.key === row.key,
                  )!;
                  const value = request.submission!.fields[row.key];
                  const datum =
                    value.reference ??
                    (spec.type === "length" ? spec.reference : undefined);
                  return (
                    <tr key={row.key}>
                      <td>
                        {row.label}
                        {!row.applicable && " (not applicable)"}
                      </td>
                      <td>
                        {!row.known
                          ? "unknown"
                          : spec.type === "length" &&
                              typeof value.value === "number"
                            ? `${formatMm(value.value)} mm`
                            : spec.type === "quantity"
                              ? `${value.value} ${spec.unit}`
                              : String(value.value)}
                      </td>
                      <td>
                        {value.status ?? "unknown"}
                        {datum ? ` · ${REFERENCES[datum]}` : ""}
                      </td>
                      <td>
                        {value.measurement && <div>{evidenceText(value)}</div>}
                        {value.observations?.map((observation, index) => <div key={`observation-${index}`}>Observation {index + 1}: {observation.value === null ? "unknown" : spec.type === "length" && typeof observation.value === "number" ? `${formatMm(observation.value)} mm` : spec.type === "quantity" ? `${observation.value} ${spec.unit}` : String(observation.value)} · {observation.status ?? "unknown"} · {observation.reference ?? "not spatial"} · {evidenceText(observation)} · {observation.note}</div>)}
                        {(value.sources ?? []).map((source, index) => (
                          <div key={index}>
                            <Link url={source.url} locator={source.locator} />
                            {source.locator && `, ${source.locator}`}
                          </div>
                        ))}
                        {value.note && <div>{value.note}</div>}
                        {row.warnings.map((flag, index) => (
                          <div className="inspector-warn" key={index}>
                            {flag.message}
                          </div>
                        ))}
                      </td>
                      <td>
                        {row.review}
                        {row.reason && `: ${row.reason}`}
                        {row.previousRejection && (
                          <div>
                            Previously rejected: {row.previousRejection}
                          </div>
                        )}
                        {row.eligible
                          ? " · eligible for group acceptance"
                          : row.review === "pending"
                            ? " · individual review required"
                            : ""}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <button
            type="button"
            disabled={!eligible.length}
            onClick={() =>
              act(
                "review_product_group",
                products.reviewGroup(request.id, group),
              )
            }
          >
            Accept {eligible.length} clean {group} fields
          </button>
        </details>
      ))}
      {!!summary.reuse.length && (
        <details>
          <summary>
            {summary.reuse.length} unchanged accepted reviews available
          </summary>
          <p>
            These values, sources, datums, applicability and validation findings
            match the previously accepted evidence: {summary.reuse.join(", ")}.
            Review the evidence above and in the individual rows before
            confirming reuse.
          </p>
          <button
            type="button"
            onClick={() =>
              act("reuse_product_reviews", products.reuseReviews(request.id))
            }
          >
            Reuse {summary.reuse.length} unchanged accepted reviews
          </button>
        </details>
      )}
      <p>
        Group confirmation records a decision for each eligible field. Final
        product acceptance is a separate action after every required review is
        accepted.
      </p>
      {error && (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
