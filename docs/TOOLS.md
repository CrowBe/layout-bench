# WebMCP tools

The studio page registers 70 tools, plus one dynamic tool, through WebMCP. This is the one list
of them. Each tool's live description, input schema and annotations, in
[`src/mcp/tools.ts`](../src/mcp/tools.ts), are the authority on units, datums, statuses and
validation; an agent reads them from the page.

- **read-only** tools carry `readOnlyHint` and never change the project.
- **destructive** tools carry `destructiveHint`. While **Model → Ask me before destructive agent
  actions** is on, the call waits on the page until a person approves or rejects it.
- Some steps are human-only and have no tool: accepting a researched product or a catalogue
  revision, applying a revision to placed fixtures, and recording measurements of reused fittings.

## Plan and editor

| Tool | What it does | |
|---|---|---|
| `get_model` | Read the whole plan | read-only |
| `get_issues` | Check the plan for problems | read-only |
| `get_item_catalog` | Furniture catalogue | read-only |
| `get_editor_state` | What the human is doing right now | read-only |
| `measure` | Measure a distance | read-only |
| `get_underlay` | Blueprint underlay + tracing protocol | read-only |
| `calibrate_underlay` | Set the drawing's true scale |  |

## Walls

| Tool | What it does | |
|---|---|---|
| `add_wall` | Add a wall |  |
| `edit_wall` | Edit a wall |  |
| `remove_wall` | Remove a wall | destructive: needs approval |

## Floor build-up

| Tool | What it does | |
|---|---|---|
| `set_room_floor` | Record a room's floor assembly and level datum |  |
| `get_floor_levels` | Read a room's floor levels | read-only |

## Underfloor heating

| Tool | What it does | |
|---|---|---|
| `set_room_heating` | Record proposed in-screed cable and entered product information |  |
| `get_room_heating` | Read cable route, length, clearances and screed section | read-only |

## Drainage

| Tool | What it does | |
|---|---|---|
| `set_room_drainage` | Record proposed wastes and sloped floor planes |  |
| `update_waste_product` | Move a floor waste to its drain product's latest accepted revision |  |
| `get_floor_heights` | Read derived floor heights, falls and drainage checks | read-only |

## Wall faces

| Tool | What it does | |
|---|---|---|
| `set_wall_side` | Record a wall side's faces and build-up |  |
| `get_wall_faces` | Read a wall's reference faces | read-only |

## Floor tiling

| Tool | What it does | |
|---|---|---|
| `set_floor_tiling` | Propose a floor tile set-out |  |
| `get_floor_tiling` | Read floor tile cuts and unresolved fields | read-only |
| `export_floor_tiling` | Export the printable proposed floor tile plan | read-only |

## Wall tiling

| Tool | What it does | |
|---|---|---|
| `set_wall_tiling` | Propose a wall tile set-out |  |
| `get_wall_tiling` | Read a wall's proposed tile set-out and cuts | read-only |
| `export_wall_tiling` | Export the printable wall tile set-out | read-only |
| `measure_to_face` | Measure from a wall face | read-only |

## Trade sheets

| Tool | What it does | |
|---|---|---|
| `set_sheet_info` | Fill in the sheet title block |  |
| `list_sheets` | List the trade sheets | read-only |
| `check_sheets` | Preflight a trade sheet | read-only |
| `export_sheet` | Issue a trade sheet |  |

## Construction-stage views

| Tool | What it does | |
|---|---|---|
| `list_diagram_content` | List layers and objects a stage diagram can show | read-only |
| `set_diagram_view` | Compose a construction-stage view |  |
| `get_diagram_view` | Inspect the current stage view | read-only |
| `export_diagram_view` | Generate the stage diagram and specification sheet |  |

## Fixtures and rough-in

| Tool | What it does | |
|---|---|---|
| `anchor_fixture` | Set a fixture out from a wall face |  |
| `fit_item` | Fit an accessory inside a fixture |  |
| `set_service_point` | Enter a fixture's service point |  |
| `remove_service_point` | Remove a fixture's service point |  |
| `place_product` | Place a library product against a wall face |  |
| `set_fixture_installation` | Set explicit fixture height and orientation |  |
| `get_rough_in` | Read the rough-in set-out | read-only |
| `set_fixture_selection` | Record a project fixture selection |  |

## Product research and library

| Tool | What it does | |
|---|---|---|
| `request_product` | Open a product research request |  |
| `list_product_requests` | List product research requests | read-only |
| `get_product_brief` | Read a product research brief | read-only |
| `submit_product_spec` | Submit a completed product brief |  |
| `get_product_library` | Read the product library | read-only |
| `preview_product_revision` | Preview selected fixture revision updates | read-only |

## Doors and windows

| Tool | What it does | |
|---|---|---|
| `add_door` | Add a door |  |
| `set_door_swing` | Change how a door opens |  |
| `add_window` | Add a window |  |
| `move_opening` | Move a door or window |  |
| `edit_opening` | Set a door or window exactly |  |
| `remove_opening` | Remove a door or window | destructive: needs approval |

## Rooms

| Tool | What it does | |
|---|---|---|
| `add_room` | Add a room |  |
| `update_room` | Update a room |  |
| `remove_room` | Remove a room | destructive: needs approval |

## Furniture and item kinds

| Tool | What it does | |
|---|---|---|
| `place_item` | Place furniture |  |
| `define_item_kind` | Model a new piece of furniture |  |
| `move_item` | Move or rotate furniture |  |
| `remove_item` | Remove furniture | destructive: needs approval |

## Plan and 3D view

| Tool | What it does | |
|---|---|---|
| `set_plan_name` | Rename the plan |  |
| `clear_model` | Erase the whole plan | destructive: needs approval |
| `build_3d` | Raise the plan into 3D |  |
| `set_camera` | Move the 3D camera |  |
| `set_doors` | Open or shut the doors in 3D |  |

## Partner shop (cross-origin)

| Tool | What it does | |
|---|---|---|
| `get_supplier_catalog` | Supplier catalogue (cross-origin) | read-only, untrusted content |
| `place_supplier_product` | Place a supplier product |  |

## Notes

| Tool | What it does | |
|---|---|---|
| `leave_note` | Leave a note on the plan |  |
| `get_notes` | Read the notes on the plan | read-only |

## Dynamic

| Tool | What it does | |
|---|---|---|
| `extend_selected_wall` | Extend the wall the human selected | registered only while a wall is selected |

The partner shop (`partner/`) registers its own tools on its own origin, `nordika_list_products`
and `nordika_get_product`, and shares them with the studio; `get_supplier_catalog` and
`place_supplier_product` call them.
