/**
 * Sheet preflight (#29). Before a trade sheet is issued, every reason it could mislead is a
 * finding with a code, the entity it is about, and a suggested fix. Blocking findings stop the
 * export until they are fixed or acknowledged with a reason; the reason is printed on the sheet,
 * so a bypass is visible to whoever reads it. Advisory findings never block: they are what the
 * sheet will print as unknown or unreferenced.
 *
 * The rules are deliberately data-like and easy to disagree with. If one is wrong for a real
 * case, acknowledging it is the escape hatch, and the printed reason is the record of why.
 */

import type { Acknowledgement, PlanModel } from "../model/types";
import { checkModel } from "../model/issues";
import { catalogByKind } from "../model/catalog";

export const SHEETS = [
  { id: "floor-plan", number: "A-01", title: "Floor plan, faces and rough-in" },
] as const;
export type SheetId = (typeof SHEETS)[number]["id"];
export const sheetById = (id: string) => SHEETS.find((s) => s.id === id);

export interface SheetFinding {
  code: string;
  severity: "blocking" | "advisory";
  /** the entity this is about: an id, several joined by ",", or "titleBlock" */
  ref: string;
  message: string;
  /** a tool the agent can call to close it, with arguments to fill in */
  fix?: { tool: string; args: Record<string, unknown>; hint: string };
}

/** Geometry problems a plan sheet would draw wrongly: these block. */
const BLOCKING_GEOMETRY = new Set([
  "wall_too_short", "walls_overlap_collinear", "walls_cross", "opening_overflow", "openings_overlap", "opening_too_tall",
  "opening_orphan", "wall_ends_in_opening", "item_through_wall", "item_unknown", "items_overlap", "wall_layer_order",
  "wall_layer_negative", "fixture_anchor_wall_missing", "fixture_anchor_off_wall",
]);

/** Values the plan sheet prints as a dimension: a default here would be read as a measurement. */
const PRINTED_DEFAULTS: Record<string, { tool: string; field: string }> = {
  opening_width_default: { tool: "edit_opening", field: "width" },
};

export function checkSheet(model: PlanModel, sheet: string): SheetFinding[] {
  const out: SheetFinding[] = [];
  if (!sheetById(sheet)) return [{ code: "sheet_unknown", severity: "blocking", ref: sheet, message: `No sheet "${sheet}". Sheets: ${SHEETS.map((s) => s.id).join(", ")}.` }];
  const tb = model.sheetSet?.titleBlock ?? {};
  if (!tb.project?.trim() || !tb.site?.trim()) {
    out.push({
      code: "title_block_incomplete", severity: "blocking", ref: "titleBlock",
      message: `The title block needs ${[!tb.project?.trim() && "a project name", !tb.site?.trim() && "a site or room"].filter(Boolean).join(" and ")}, so the sheet says what it is for.`,
      fix: { tool: "set_sheet_info", args: { project: tb.project ?? "", site: tb.site ?? "" }, hint: "Ask the human for the project name and site/room." },
    });
  }
  if (model.walls.length === 0) out.push({ code: "nothing_to_draw", severity: "blocking", ref: "model", message: "The plan has no walls to draw." });

  for (const issue of checkModel(model)) {
    const ref = issue.refs.join(",");
    if (issue.severity === "error" && BLOCKING_GEOMETRY.has(issue.code)) {
      out.push({ code: `geometry:${issue.code}`, severity: "blocking", ref, message: `${issue.message} The sheet would draw this as it is.`, fix: { tool: "get_issues", args: {}, hint: "Fix the geometry, then check again." } });
      continue;
    }
    const printed = PRINTED_DEFAULTS[issue.code];
    if (printed) {
      out.push({
        code: `default:${issue.code}`, severity: "blocking", ref,
        message: `${issue.message} The sheet would print this placeholder as a dimension.`,
        fix: { tool: printed.tool, args: { id: issue.refs[0], [printed.field]: "<measured value in metres>" }, hint: "Ask the human for the measured value." },
      });
      continue;
    }
    // everything else the checker knows about is printed as unknown or flagged in the unresolved list
    out.push({ code: `unresolved:${issue.code}`, severity: "advisory", ref, message: issue.message });
  }

  for (const it of model.items) {
    const label = catalogByKind(it.kind)?.label ?? it.kind;
    if (!it.anchor && (catalogByKind(it.kind)?.category === "bath" || it.servicePoints?.length)) {
      out.push({
        code: "fixture_not_set_out", severity: "advisory", ref: it.id,
        message: `${label} is drawn where it sits, but not set out from a wall face, so the sheet gives no set-out dimension for it.`,
        fix: { tool: "anchor_fixture", args: { itemId: it.id, wallId: "<wall>", side: "<left|right>", face: "finished", distance: "<metres from end A>", status: "proposed" }, hint: "Set it out from the face a trade would measure from." },
      });
    }
  }
  const roomWalls = model.walls.filter((w) => !w.sides);
  if (roomWalls.length) {
    out.push({
      code: "no_faces_recorded", severity: "advisory", ref: roomWalls.map((w) => w.id).join(","),
      message: `${roomWalls.length} wall(s) have no faces recorded; their dimensions refer to the drawn wall line only.`,
      fix: { tool: "set_wall_side", args: { wallId: roomWalls[0].id, side: "<left|right>" }, hint: "Record the existing surface, frame and build-up where a trade will measure." },
    });
  }
  return out;
}

export interface AckInput {
  code: string;
  ref: string;
  reason: string;
}

/**
 * Match acknowledgements to blocking findings. Every blocking finding needs one; an
 * acknowledgement that matches nothing, or has no real reason, is refused.
 */
export function reconcile(findings: SheetFinding[], acks: AckInput[] = [], by: Acknowledgement["by"] = "agent"):
  { ok: true; acknowledged: Acknowledgement[] } | { ok: false; open: SheetFinding[]; problems: string[] } {
  const problems: string[] = [];
  const blocking = findings.filter((f) => f.severity === "blocking");
  const used: Acknowledgement[] = [];
  for (const a of acks) {
    const hit = blocking.find((f) => f.code === a?.code && f.ref === a?.ref);
    if (!hit) { problems.push(`No blocking finding ${a?.code} on ${a?.ref} to acknowledge.`); continue; }
    if (typeof a.reason !== "string" || a.reason.trim().length < 10) { problems.push(`${a.code} on ${a.ref}: give a reason of at least 10 characters; it is printed on the sheet.`); continue; }
    used.push({ code: a.code, ref: a.ref, reason: a.reason.trim(), by });
  }
  const open = blocking.filter((f) => !used.some((u) => u.code === f.code && u.ref === f.ref));
  if (open.length || problems.length) return { ok: false, open, problems };
  return { ok: true, acknowledged: used };
}
