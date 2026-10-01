---
name: reno-edit-layout
description: Apply supplied dimensions or change openings and fixture positions in a Reno Layouts plan using its live WebMCP tools.
---

Use the open Reno Layouts page's WebMCP tools. If unavailable, ask the user to open the site and a project in a supported browser surface.

Read `get_model`, `get_notes` and `get_issues`; use `get_editor_state` for selection-relative requests. Resolve the target and measurement datum before editing. Ask only for missing information that affects this change.

Use live tool descriptions for units, geometry and status meanings. Read `get_wall_faces` for face-based set-out. Preserve uncertainty: entered dimensions are not site measurements. Apply the requested edits to the shared model.

Read back affected geometry with the relevant measurement or rough-in tool. Re-run `get_issues`; repair introduced problems and report unrelated findings separately. Stop for missing evidence instead of guessing or looping. Refresh `build_3d` when viewing or requesting 3D. Report the change and remaining uncertainty.
