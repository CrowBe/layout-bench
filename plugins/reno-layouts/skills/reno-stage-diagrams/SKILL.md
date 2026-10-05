---
name: reno-stage-diagrams
description: Compose construction-stage views of an open Reno Layouts project and export a dimensioned plan, wall elevations and a matching specification sheet for each stage.
---

Use the open Reno Layouts page's WebMCP tools. If unavailable, ask the user to open the site and a project in a supported browser surface.

Read `list_diagram_content` first. Choose each stage's content only from the layer and element ids it returns. Do not fake a layer listed under `notModelled` or `emptyLayers`, such as heating cable. Say what the stage cannot show, and record it with `leave_note` if the user wants it noted.

For each stage, call `set_diagram_view` with a clear label and the explicit visible list. Then read `get_diagram_view` and confirm the elements match the user's intent before exporting. Fix blocking findings at the source with the tools they name. Acknowledge a finding only when the user agrees the rule is wrong for this case, and give the printed reason. Then call `export_diagram_view`. Each export gives the plan, one elevation per room-facing wall side the view shows (`get_diagram_view` lists them under `surfaces`), and the specification sheet; pass `surfaces` only when the user wants a subset. Check each elevation: fixtures and service points appear on the wall they are set out from, at their recorded heights, and anything without a height is listed as "?" instead of drawn.

Never edit the model to make a stage look right. Views change visibility only. Report "?" values as unknown, keep every status tag, and name the face or datum each dimension is measured from. Outputs are proposed set-out for trade review, not compliance certification. Report each stage exported, what it shows, and what remains unknown.
