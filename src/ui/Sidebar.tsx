/**
 * Sidebar — Model / Check / Sheets / Catalog / Supplier / Notes / Tools tabs.
 *
 * A drawer: the tab rail is always there, the panel opens only when a tab is picked and
 * closes from its own close button. Notes and Tools talk to an agent, so they appear only
 * while WebMCP tools are registered on the page.
 */

import { useState } from "react";
import { useAppStore, actions, logActivity } from "../model/store";
import { checkModel } from "../model/issues";
import { CATALOG } from "../model/catalog";
import { TOOLS } from "../mcp/tools";
import { ToolRunner } from "./ToolRunner";
import { SupplierPanel } from "./SupplierPanel";
import { SheetsPanel } from "./SheetsPanel";
import { thumbnailFor } from "../three/thumbnails";

type Tab = "model" | "check" | "sheets" | "catalog" | "supplier" | "notes" | "tools";

export function Sidebar() {
  const [tab, setTab] = useState<Tab | null>(null);
  const model = useAppStore((s) => s.model);
  const notes = useAppStore((s) => s.notes);
  const selectedWallId = useAppStore((s) => s.editor.selectedWallId);
  const requireApproval = useAppStore((s) => s.requireApproval);
  const supplierTools = useAppStore((s) => s.supplierTools);
  const catalogRev = useAppStore((s) => s.catalogRev);
  const toolsLive = useAppStore((s) => s.webmcpStatus === "live");
  const [noteText, setNoteText] = useState("");
  const issues = checkModel(model);

  const tabs: { id: Tab; label: string; badge?: number; agent?: boolean }[] = [
    { id: "model", label: "Model" },
    { id: "check", label: "Check", badge: issues.length },
    { id: "sheets", label: "Sheets" },
    { id: "catalog", label: "Catalog" },
    { id: "supplier", label: "Supplier", badge: supplierTools.length || undefined },
    { id: "notes", label: "Notes", badge: notes.length, agent: true },
    { id: "tools", label: "Tools", agent: true },
  ].filter((t) => toolsLive || !t.agent) as { id: Tab; label: string; badge?: number }[];
  // tools withdrawn while an agent tab was open: close the drawer rather than show a dead panel
  const open = tabs.some((t) => t.id === tab) ? tab : null;

  const onUploadBlueprint = (file: File) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        // reencode to JPEG ≤1600 px (localStorage-friendly)
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        const aspect = img.height / img.width;
        actions.setUnderlay({
          dataUrl, opacity: 0.55, x: 0, y: 0, w: 8, h: 8 * aspect,
          pw: canvas.width, ph: canvas.height,
        });
        logActivity("human", "set_underlay", `Blueprint loaded (${canvas.width}×${canvas.height}), opacity 55%. Drag walls over it to trace.`);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-tabs" aria-label="Plan panels">
        {tabs.map((t) => (
          <button key={t.id} aria-pressed={open === t.id} className={open === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge ? <span className={`badge ${t.id === "check" ? "warn" : ""}`}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {open && <div className="sidebar-body" role="region" aria-label={tabs.find((t) => t.id === open)?.label}>
        <div className="sidebar-head">
          <strong>{tabs.find((t) => t.id === open)?.label}</strong>
          <button className="sidebar-close" aria-label="Close panel" onClick={() => setTab(null)}>✕</button>
        </div>
        {open === "model" && (
          <div className="panel">
            <label className="field">
              Plan name
              <input
                value={model.name}
                onChange={(e) => actions.setPlanName(e.target.value)}
              />
            </label>
            <div className="stat-grid">
              <div><strong>{model.walls.length}</strong> walls</div>
              <div><strong>{model.openings.filter((o) => o.kind === "door").length}</strong> doors</div>
              <div><strong>{model.openings.filter((o) => o.kind === "window").length}</strong> windows</div>
              <div><strong>{model.rooms.length}</strong> rooms</div>
              <div><strong>{model.items.length}</strong> items</div>
              <div><strong>{model.rooms.reduce((a, r) => a + r.w * r.h, 0).toFixed(1)}</strong> m²</div>
            </div>
            <button
              className="danger"
              onClick={() => {
                const r = actions.clearModel();
                logActivity("human", "clear_model", r.summary, r.ok);
              }}
            >
              Clear plan
            </button>
            <label className="toggle-row" title="When on, any destructive tool an agent calls is parked on the page until you approve it">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => actions.setRequireApproval(e.target.checked)}
              />
              <span>
                Ask me before destructive agent actions
                <small>clear_model, remove_wall, remove_room, remove_item, remove_opening</small>
              </span>
            </label>
            <div className="field">
              Blueprint underlay
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onUploadBlueprint(e.target.files[0])}
              />
              {model.underlay && (
                <>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={model.underlay.opacity}
                    onChange={(e) =>
                      actions.setUnderlay({ ...model.underlay!, opacity: Number(e.target.value) })
                    }
                  />
                  <button onClick={() => actions.setUnderlay(null)}>Remove underlay</button>
                </>
              )}
            </div>
            {selectedWallId && (
              <p className="hint">
                Wall <code>{selectedWallId}</code> selected — the dynamic tool{" "}
                <code>extend_selected_wall</code> is published for your agent right now.
              </p>
            )}
          </div>
        )}

        {open === "check" && (
          <div className="panel">
            {issues.length === 0 ? (
              <p className="ok-msg">✓ 0 issues — the plan is clean. Every wall connects, every vano fits, nothing blocks a door.</p>
            ) : (
              issues.map((i, idx) => (
                <div key={idx} className={`issue ${i.severity}`}>
                  <strong>{i.severity === "error" ? "Error" : "Warning"}</strong> · {i.message}
                  <div className="issue-refs">{i.refs.join(", ")}</div>
                </div>
              ))
            )}
          </div>
        )}

        {open === "catalog" && (
          <div className="panel catalog-grid" key={catalogRev}>
            {CATALOG.map((c) => {
              const thumb = thumbnailFor(c.kind);
              return (
                <button
                  key={c.kind}
                  className="catalog-card"
                  onClick={() => {
                    actions.setDrawMode("place", c.kind);
                    // on a phone the drawer covers the plan: get it out of the way so the next tap places
                    if (window.matchMedia("(max-width: 767px)").matches) setTab(null);
                  }}
                  title={`${c.w} × ${c.d} × ${c.h} m — click, then click on the plan`}
                >
                  {thumb ? (
                    <img className="catalog-thumb" src={thumb} alt="" draggable={false} />
                  ) : (
                    <span className="catalog-swatch" style={{ background: c.color }} />
                  )}
                  <span className="catalog-label">{c.label}</span>
                  <span className="catalog-dims">{c.w} × {c.d} m</span>
                </button>
              );
            })}
          </div>
        )}

        {open === "supplier" && <SupplierPanel />}

        {open === "sheets" && <SheetsPanel />}

        {open === "notes" && (
          <div className="panel">
            <div className="note-compose">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Leave a note for your agent (e.g. “make the bedroom bigger”)"
                rows={2}
              />
              <button
                onClick={() => {
                  if (!noteText.trim()) return;
                  actions.leaveNote("human", noteText.trim());
                  setNoteText("");
                }}
              >
                Add note
              </button>
            </div>
            {notes.length === 0 && <p className="hint">No notes yet. Agents read and write here too — it's the shared margin of the plan.</p>}
            {[...notes].reverse().map((n) => (
              <div key={n.id} className={`note ${n.author}`}>
                <span className="note-author">{n.author === "agent" ? "AGENT" : "YOU"}</span>
                {n.text}
              </div>
            ))}
          </div>
        )}

        {open === "tools" && (
          <div className="panel">
            <p className="hint">
              These are the exact {TOOLS.length} tools your AI agent discovers via WebMCP, plus the dynamic
              one. Run them manually to test flows — every call is logged below in the activity feed.
            </p>
            <ToolRunner />
          </div>
        )}
      </div>}
    </aside>
  );
}
