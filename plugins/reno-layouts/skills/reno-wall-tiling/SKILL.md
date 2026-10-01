---
name: reno-wall-tiling
description: Propose a tile set-out for one wall of an open Reno Layouts project and export its printable elevation for review with a tiler.
---

Use the open Reno Layouts page's WebMCP tools. If unavailable, ask the user to open the site and a project in a supported browser surface.

Read `get_model` and `get_wall_faces` for the wall and its return walls. The ends are cut to the return walls' board or finished face and the courses start from the room's floor build-up, so those must be recorded first with `set_wall_side` and `set_room_floor`. Do not invent them.

Tile length, width, orientation, grout joint, origin and tiled height are the user's choices. Ask for any that are missing; never pick a common size for them. Record them with `set_wall_tiling` as proposed, or published for a manufacturer's nominal size.

Read `get_wall_tiling`. Report each cut with the face or level it is measured from. List everything under `missing` as unknown, not as a number. To compare origins, change only `originAlong` or `originUp` and read the cuts again. Fix `get_issues` findings at their source.

Export with `export_wall_tiling`, or point the user to the wall's Inspector to download or print it. Call the result a proposed set-out for tiler review. It is not as-built, not a procurement quantity and not a waterproofing compliance statement.
