# Reno Layouts — Plans that rise to 3D

Reno Layouts is a fork of [Alza](https://github.com/Elioz404/Alza), created by
[Elioz404](https://github.com/Elioz404) for the
[WebMCP Challenge](https://webmcp.devpost.com/). Credit for the original floor-plan
studio, WebMCP integration and hackathon demo belongs to Alza and its contributors.
This fork builds on that foundation with renovation planning, surveyed geometry,
wall build-ups, fixture rough-in, product research and trade sheets. The original
MIT copyright notice is retained in [LICENSE](./LICENSE).

A floor plan is coordinates, not buttons — which is why an agent cannot use one by
pretending to be a mouse. So Reno Layouts does not make it try. It hands over the model itself: the
full metric geometry, published as typed tools through **WebMCP**, on the same live page a
person is drawing on.

You draw walls, rooms, doors, windows and furniture in a precise 2D editor, or load a photo
of a plan and trace over it. Your agent works that same model with the same tools — it
checks its own work against a constraint engine, buys furniture from a second origin, and
raises the result into a 3D model you can walk through.

Everything runs client side. No backend, no accounts, plans stay on your machine.

## Browser-local projects

The app opens with a project chooser. **Bathroom Concept** is the shipped sample;
create a blank project for a separate plan or duplicate the sample as a starting point.
Older browser libraries keep their existing projects, including any Sunset Loft copy.
Project changes save in this browser's local storage, including geometry, notes,
custom item kinds, and an uploaded underlay. Use **Projects** to switch, export a
project as JSON, import a backup under a new name, or delete a user-created project
after confirmation. Browser storage does not sync between devices and may be cleared
with site data. If storage is full or saved data uses an unreadable version, the app
shows an error and offers a backup download without overwriting that data.

## Reno Layouts skills plugin

The skills-only plugin in [`plugins/reno-layouts`](./plugins/reno-layouts) provides
four workflows for ChatGPT:

- **reno-edit-layout** applies supplied measurements and verifies scoped layout changes.
- **reno-research-product** resumes a product request and submits sourced specifications
  for human review.
- **reno-stage-diagrams** composes construction-stage views of the one project model and
  exports a dimensioned plan, wall elevations and matching specification sheet for each.
- **reno-wall-tiling** proposes a tile set-out for one wall from user-chosen tile sizes and
  exports its printable elevation for review with a tiler.

Open Reno Layouts and select a project in a browser surface that exposes its WebMCP
tools. The plugin supplies workflow guidance; the page supplies the tools and their
descriptions, units, datums and validation rules. Product research also needs browsing
or document-reading tools. The plugin adds no MCP server, app connection or runtime code.

Build the upload archive with Python 3 available:

```bash
npm run plugin:pack
```

This writes `dist/reno-layouts-plugin.zip`, containing the supported
`.codex-plugin/plugin.json` compatibility manifest and the skills at the archive root.
The format follows OpenAI's [plugin packaging guidance](https://developers.openai.com/plugins/build/plugins).
Where ChatGPT offers plugin ZIP upload, upload this archive and try a scoped layout edit
or a named product request. Installation does not grant browser access. ChatGPT upload
and behavioral comparison against tools alone remain release checks; local package
validation does not prove either. Run `plugin:pack` after `npm run build`, which clears `dist`.

---

## The two-minute film

<p align="center">
  <a href="https://www.youtube.com/watch?v=RihMFcMstvI">
    <img src="shots/showcase/00-video-poster.png" width="820" alt="Watch the original WebMCP demo" />
  </a>
</p>

<p align="center"><em>2 min 15 s. The agent gets a photo of a plan, asks for one real
dimension, and draws the whole thing. After that it checks itself, buys a chair from another
origin, gets a destructive call refused by a human, and walks the result.</em></p>

The original Alza demo film was put together with [HyperFrames](https://hyperframes.heygen.com/) from a
storyboard, a script and HTML compositions. That authoring tree is not carried here; the
finished film is on YouTube and its stills are in [`shots/showcase/`](shots/showcase/).

What *is* here is the part you need to reproduce what the film shows:
[`trace.mjs`](trace.mjs) holds the demo plan as data, and [`record6.mjs`](record6.mjs)
drives the real app through the eight beats while ffmpeg captures the screen at 60 fps.

## What it looks like

The plan below was traced by the agent from a photo of a drawing it had never seen. Every
coordinate came out of tool calls. Nothing was placed by hand.

<p align="center">
  <img src="shots/showcase/preview.gif" width="720" alt="The traced plan turning in 3D" />
</p>

<p align="center">
  <img src="shots/showcase/01-3d-orbit-hero.png" width="820" alt="The traced plan raised into 3D" />
</p>

The proof in one image. The drawing underneath is the source photo; the dark geometry on top
is what Reno Layouts built from it. The agent asked for a single real dimension, set the scale from
that, and traced the rest.

<p align="center">
  <img src="shots/showcase/02-traced-over-the-drawing.png" width="820" alt="the app's geometry laid over the original drawing" />
</p>

| | |
|:--:|:--:|
| <img src="shots/showcase/03-plan-2d.png" width="400" alt="The finished metric plan" /> | <img src="shots/showcase/04-tool-runner.png" width="400" alt="The 31 tools the page publishes" /> |
| The finished plan: 12 walls, 14 openings, 10 rooms, 34 pieces, with live areas per room. | The tools, published by the page itself. No server and no key, just `document.modelContext.registerTool`. |
| <img src="shots/showcase/05-cross-origin-supplier.png" width="400" alt="A second origin publishing its own tools" /> | <img src="shots/showcase/06-supplier-product-placed.png" width="400" alt="A partner product placed in the plan" /> |
| A furniture shop on its own origin publishes its own tools and shares them with this page. | One instruction crosses that boundary, and a real product lands in the plan at its real size. |
| <img src="shots/showcase/07-constraint-engine.png" width="400" alt="The constraint engine reporting errors in metres" /> | <img src="shots/showcase/08-agent-notes-on-ambiguity.png" width="400" alt="Notes the agent left about what it could not be sure of" /> |
| It checks its own work: overlaps, wall crossings and blocked door swings, reported in metres. | When it cannot know something, it says so. Here it flags an ambiguous symbol and its scale assumption. |
| <img src="shots/showcase/09-approval-gate.png" width="400" alt="A destructive call waiting for a human" /> | <img src="shots/showcase/10-approval-rejected-feed.png" width="400" alt="The refusal returned to the agent in words" /> |
| The human keeps the veto: a destructive call parks on the page until a person decides. | The refusal comes back as words the agent can act on, not a silent failure. |
| <img src="shots/showcase/11-agent-authored-pieces.png" width="400" alt="Furniture the agent modelled itself" /> | <img src="shots/showcase/15-3d-walk-eye-level.png" width="400" alt="Walking the plan at eye level" /> |
| When the catalogue has no honest match, the agent models the piece itself: an L-shaped sofa, a corner shower, a compact bath, a fitted L wardrobe, a washing machine. | Then you walk it, at 1.6 m eye height, doors open, collision on. |

More stills in [`shots/showcase/`](shots/showcase/).

## Try it in 2 minutes

1. Open the live app (link at the top of this repo).
2. **In ChatGPT desktop:** open the URL in the in-app browser. WebMCP works out of the box.
   **In Google Chrome 149+:** enable `chrome://flags/#enable-webmcp-testing` and restart.
   The pill in the header turns green: **● Site tools live** (60 tools registered).
3. Ask your agent, for example:
   - *"Add a 3 × 2.5 m study next to the bedroom, with a door and a window."*
   - *"The sofa placement feels off. Check the plan and fix any issues."*
   - *"Build the 3D and give me a walkthrough."*
4. No WebMCP runtime? The app is still complete. Open the **Tools** tab and run the exact
   same 60 tools manually; every call is logged in the activity feed at the bottom.

## Trace your own plan with the agent

Have a floor-plan image (scan, photo, PDF export)? Let the agent rebuild it in 3D:

1. Upload the image in **sidebar → Model → Blueprint underlay** (it appears on the 2D
   canvas), and attach the same image in the chat so the agent can see it.
2. Give the agent **one real dimension** from the plan, e.g. *"this wall is 4.6 m"*.
   It calls `calibrate_underlay` with two points on the image and that distance, and the
   blueprint is scaled to true meters.
3. Ask: *"Trace this plan: walls, doors, windows, rooms, then furnish it and check for
   issues."* The agent draws over the underlay with `add_wall` / `add_door` / `add_window`,
   verifies with `measure` + `get_issues`, fixes what it got wrong, and finishes with
   `build_3d`.
4. Correct anything by hand. You and the agent share the same model.

## Why WebMCP is the point

Canvas geometry is exactly where agent actuation falls over. You cannot click-and-drag a
wall reliably, and there is no DOM to scrape. So Reno Layouts publishes the plan as **structured
tools** via `document.modelContext.registerTool`, and those tools call the same store
actions the UI buttons call. Human and agent end up co-editing one model on one live page.

```js
document.modelContext.registerTool({
  name: "add_wall",
  description: "Add a wall segment from (ax,ay) to (bx,by) in meters…",
  inputSchema: { /* … */ },
  execute: async (input) => { /* the same action the + Wall button uses */ },
});
```

## The 60 tools (+ 1 dynamic)

| Group | Tools |
|---|---|
| **Read** (readOnly) | `get_model` · `get_issues` · `get_item_catalog` · `get_editor_state` · `measure` · `get_underlay` |
| **Blueprint** | `calibrate_underlay`, scales the uploaded plan image to real meters from one known dimension |
| **Structure** | `add_wall` · `edit_wall` · `remove_wall` |
| **Openings** | `add_door` · `add_window` · `edit_opening` (exact position from a named wall end, width, sill, height) · `move_opening` · `remove_opening` · `set_door_swing` (hinge side + swing direction) |
| **Wall faces** | `set_wall_side` (existing surface, frame face and proposed build-up per wall side, each value with a status) · `get_wall_faces` (readOnly) · `measure_to_face` (readOnly: distance from the existing, frame, board or finished face, or unresolved) |
| **Wall tiling** | `set_wall_tiling` (a proposed tile set-out on one wall side: tile size, orientation, joint, the face each end is cut to, floor reference, origin and tiled height, each length with a status) · `get_wall_tiling` (readOnly: run limits, floor level, origin, edge cuts at both ends, bottom and top, cuts around openings, pieces, and every unresolved input) · `export_wall_tiling` (readOnly: the printable A3 SVG elevation, stamped proposed, not as-built) |
| **Floor tiling** | `set_floor_tiling` (proposed rectangular room or drainage-plane pattern, tile format, joint, plan X/Y axis, origin from finished west/north faces, notes and per-value provenance) · `get_floor_tiling` (readOnly: pieces, perimeter cuts, waste-grid relationships, door transitions, floor-plane boundaries and unresolved fields) · `export_floor_tiling` (readOnly: proposed SVG plan with dimensions and field notes; print to A3 PDF from the room Inspector) |
| **Floor and drainage** | `set_room_floor` · `get_floor_levels` (readOnly) · `set_room_drainage` (point or linear wastes and sloped floor planes, each level and fall with a status) · `get_floor_heights` (readOnly: derived heights at points and along a section, checks for contradictory levels, gaps and unresolved falls, build-up and door-threshold references) |
| **Trade sheets** | `set_sheet_info` · `list_sheets` (readOnly) · `check_sheets` (readOnly: blocking and advisory findings, each with a ref and a suggested fix) · `export_sheet` (issues an A3 SVG revision; blocking findings must be fixed or acknowledged with a reason that is printed on the sheet) |
| **Stage diagrams** | `list_diagram_content` (readOnly: the layer and object ids the model really has, empty layer kinds, and what is not modelled) · `set_diagram_view` (an explicit visible set for a labelled stage; any unknown id is refused) · `get_diagram_view` (readOnly: the visible elements, the spec rows with status and datum, and scoped findings) · `export_diagram_view` (the dimensioned A3 plan SVG, an A3 elevation SVG per room-facing wall side shown, and the matching specification sheet HTML) |
| **Fixtures** | `anchor_fixture` (set a fixture out from a wall face) · `set_service_point` · `remove_service_point` · `place_product` (a library product against a face, with its published rough-in) · `get_rough_in` (readOnly: every service point as distances from the existing, frame, board and finished faces, along from both wall ends and up from the floor, plus clearances) |
| **Products** | `request_product` · `list_product_requests` (readOnly) · `get_product_brief` (readOnly: the fields to find, their definitions and datums, the research protocol, and the text of attached spec sheets page by page) · `submit_product_spec` · `get_product_library` (readOnly). Accepting a product is human-only, on the Products page. |
| **Rooms** | `add_room` · `update_room` · `remove_room` |
| **Furniture** | `place_item` · `move_item` · `remove_item` · `define_item_kind`, model a piece the catalogue lacks, from primitives |
| **Model & view** | `set_plan_name` · `clear_model` · `build_3d` · `set_camera` (orbit/top/walk) · `set_doors` (swing the leaves open/shut) |
| **Cross-origin** | `get_supplier_catalog` · `place_supplier_product`, read a **partner origin's** own WebMCP tools and drop its real products into the plan |
| **Collaboration** | `leave_note` · `get_notes` |
| **Dynamic** | `extend_selected_wall`, published **only while the human has a wall selected** (registered/unregistered live, per the spec's `toolchange` cycle). The human points, the agent acts on exactly that wall. |

A few design notes:

- Millimetre precision. Every length is stored in metres rounded to 0.1 mm, one step finer
  than a surveyor reads, so derived set-out values (a centred 1755 mm window's 177.5 mm jamb
  offset) survive. Tools and typed values are never snapped; input finer than 0.1 mm is
  rounded and the result says so. The 2D editor shows millimetres, and its pointer snap is a
  drawing aid you can set or turn off. Select any wall, opening, room or item to type exact
  values; openings are positioned from a named wall end.
- A height nobody supplied is a default, not a fact. `add_door` / `add_window` without a
  height store one that fits under the wall, mark it `heightDefaulted`, and tell the agent
  to ask for the measured value; `get_issues` warns until it is entered with `edit_opening`.

- Unknown stays unknown on wall faces. Each side of a wall can record its existing surveyed
  surface, its frame face and a proposed build-up (board, waterproofing, adhesive, tile), every
  value tagged site-confirmed, measured, proposed or estimated. A face with an unknown input is
  *unresolved* and names what is missing; no default thickness is substituted, and a surveyed
  surface is never converted into a frame position. Select a wall to edit its sides, see a
  section, and read every face's offset from a chosen reference face.

- A wall tile set-out is a proposal, not a record. Select a wall to set out one side's tiles
  (`set_wall_tiling` does the same): tile size and orientation, grout joint, whether each end is
  cut to the return wall's board (Villaboard) face or its finished face, the floor level the
  courses start from (finished, screed, substrate or the datum, read from the room's floor
  build-up), the origin tile and the tiled height. Nothing is defaulted: an unknown input, an
  unresolved board thickness on a return wall, or a window whose size is a placeholder leaves
  the cuts unresolved and listed. The elevation shows full and cut pieces around openings; drag
  the origin tile or nudge it 10 mm and the end, opening, bottom and top cuts update with the 3D
  preview and the printable A3 sheet, which names the face every dimension is taken to and is
  stamped proposed, not as-built. No procurement quantities and no waterproofing compliance.

- Trade sheets are checked before they are issued. `check_sheets` returns findings an agent
  can work through: blocking ones (a placeholder that would print as a dimension, broken
  geometry, an empty title block) and advisory ones (what the sheet will list as unresolved),
  each with the entity it is about and a suggested fix. `export_sheet` refuses until every
  blocking finding is fixed or acknowledged with a reason. The reason is printed on the sheet,
  so a rule that is wrong for a real case can be passed, but never silently. Sheet A-01 is the
  dimensioned floor plan at a standard scale on A3, with the walls as built, faces, fixtures,
  rough-in schedule, status tag on every value, unresolved list and title block; the Sheets
  tab previews it, issues revisions, downloads the SVG and prints to PDF.

- Select a room to propose floor tile set-out at its finished wall faces. Choose the whole
  room or one existing drainage plane, enter tile format, grout, X/Y axis and origin, then
  nudge the origin 10 mm to compare visible cuts and the exported plan. Blank or ambiguous
  wall faces stay unresolved. The diagram shows doorway transitions, wastes and fall-plane
  boundaries and flags narrow pieces or tiles crossing slope breaks. Waste aperture sizes
  are not yet recorded: centre lines and grid relationships remain proposals for tiler
  review, with aperture cuts explicitly unresolved. No purchase quantity or trade approval.
- One renovation, many stage drawings. Post-demolition, rough-in, waterproofing, screed, tiles
  and fit-out are views of the same project, not copies of it. An agent lists what the model
  holds (`list_diagram_content`: wall faces and each build-up layer, floor layers, wastes and
  planes, openings, fixtures, and waste, water and power points, each with a stable id),
  chooses exactly which layers and objects a stage shows (`set_diagram_view`), checks it
  (`get_diagram_view`), and exports a dimensioned diagram and a specification sheet from that
  same set (`export_diagram_view`). The view is kept per project for the page session, outside
  the project document and its undo history, so composing or switching stages never edits,
  copies or versions the geometry, services or their provenance. An id the model does not have
  is refused. The `floor-heating-cable` layer appears when a room has a heating record;
  projects without one explicitly list heating as absent instead of inventing a route.
  Values keep their status tags and the face or datum they are measured from; unknowns print
  as "?" with what is missing. Each export also draws one A3 elevation per room-facing wall side
  the view shows, from the same visible set: the outermost visible face or layer, openings with
  jambs measured from the return wall's face, the proposed tile set-out once the tile layer is
  shown, visible floor levels and the finished-floor falls along the wall, fixtures standing against
  that face at their heights (a kind's placeholder mounting height is dashed and says so), and
  service points dimensioned from the return wall's face and above the finished floor. A point or
  fixture without a known height is listed, never drawn. `get_diagram_view` names the surfaces;
  `export_diagram_view` takes `surfaces` to generate a subset; the Sheets tab previews any of them. The A-01 blocking rules apply to visible content (a defaulted
  door width blocks only when the door is shown), with the same printed acknowledgement escape
  hatch. Exports are not sheet revisions; the Sheets tab previews the current stage and
  downloads both files.

- Fixtures can have their real plan shape. A kind may carry an outline of straight edges and
  arcs through a point (define_item_kind `outline`), and that one polygon is drawn in the plan
  and on the trade sheet, extruded in 3D, and used for clash checks, clearances and face
  measurements. A corner bath from the product library gets its outline from the width across
  its curved front and its projection from the corner, mirrored to the corner it is placed in;
  if that outline disagrees with the printed lengths along the walls, the brief flags it.

- Fixtures are set out from wall faces. Anchor a vanity or toilet a gap in front of a named face
  (frame, board, finished) at a distance from a wall end, and its position follows that face:
  change the board and a tile-face fixture moves, a frame-set one does not. Service points
  (waste, water, power) are entered against a face or copied from a library product, and the
  rough-in reads each one from every face so the plumber gets frame and Villaboard figures.
  Clash checks use the wall as built: its body and recorded build-up, not a centred thickness.

- The page sets the brief; the agent does the research. **Products** opens a library shared by
  every project in this browser. A request names a fixture (toilet, vanity, bath, tapware,
  shower fittings, screen, drain, towel rail or mirror/cabinet) and the page
  turns it into a brief: each field, its unit, what it is measured from, and whether a trade
  drawing needs it. The agent searches, then submits values marked `published` (manufacturer or
  retailer figures only; site measurements are a person's to record), each with a source link
  and the page, figure or table it is on. A value with no located source, a value in the wrong
  unit or a required field left blank without saying where it looked is refused, and
  alternative sources are held to the same rules. Accepted products carry their rough-in
  points (wastes, water inlet), each axis naming the datum it is measured from. Disagreeing sources and
  figures measured from a different datum are flagged. A person reviews each field and accepts
  the product; no tool can. The completeness summary exposes applicable required values,
  unknowns, conflicts, datum mismatches and pending or rejected reviews. A human can confirm
  clean pending fields in named envelope, rough-in and installation groups after reading
  their values, statuses and source locators. Unknown, flagged and previously rejected fields
  stay individual; accepting an unknown acknowledges missing evidence. Final product
  acceptance remains separate. Returned revisions invalidate changed values, sources, datums
  and applicability; unchanged approvals require explicit human reuse. Existing saved
  decisions and rejection reasons remain readable. `tests/product-review.e2e.mjs` checks
  these boundaries through real human controls and browser reloads with synthetic evidence.

- Reused toilets, vanities/basins and baths have a separate human measurement form.
  A physical label and attached photos can identify an item while manufacturer/model stay
  unknown. Every known observation needs explicit status, unit, physical datum, evidence
  and measurement date (or an explained unknown original date). Selecting working evidence
  retains measured/published disagreements and previous observations. Additional observation
  requests retain read-only access to original attachment evidence. Research tools cannot
  record or submit these human measurements. Unknown dimensions prevent placement; template
  zeroes are not assumed measured, and product-local heights stay unresolved until an explicit
  installation datum conversion is available. Placement carries per-axis service evidence and
  a project-owned specification snapshot through reload and JSON transfer; an absent product
  library is still reported. `tests/product-measurements.e2e.mjs` covers the recorded existing
  910 × 465 mm vanity footprint with unknown height/connections, then explicitly synthetic
  extra geometry/services for acceptance, 3D, specification and fresh-browser transfer.
- **Transfer catalogue evidence** manually exports selected accepted products and pending
  requests with their dependent history and original PDF/image bytes in a versioned JSON
  bundle (up to 80 MB). SHA-256 checks and fresh PDF extraction validate originals before
  import. Preview shows contents, additions and ID collisions; a separate human action
  commits it. Conflicting local IDs receive a coherent remap across records and citations,
  while unchanged reimports add nothing. Historical review decisions retain their source
  binding and remap provenance. Missing originals, unsupported schemas and storage failures
  refuse the transfer; failed commits restore the previous catalogue and remove only their
  newly staged files. Project JSON remains separate and carries its own placed evidence.
  `tests/catalogue-bundles.e2e.mjs` verifies actual download/import across independent browsers,
  reopened originals, pending human review, explicit mounting, reload and project transfer.
- Fitting briefs distinguish powered/unpowered and fixed/hinged variants, and product-local
  mounting dimensions from proposed project heights. Unknown fields remain explicit through
  human review and library storage. The existing placement path supports generic envelopes
  for floor-standing tapware/towel rails and fixed floor-supported screens; it explicitly
  refuses raised wall/ceiling fittings, recessed bodies and moving screens until installation
  geometry is available. A source datum the plan cannot express never becomes an invented
  envelope or service coordinate. `tests/bathroom-products.e2e.mjs` exercises all six new
  categories with explicitly synthetic evidence, real human review controls, library reload,
  conditional variants and the canonical diagram/specification export.

- The Bathroom Concept sample carries the owner's purchased fittings (bath, wall and basin
  mixers, spout, shower system, two towel rails, thermostat), each marked `purchased` with the code
  printed on its label. Only label-printed sizes are copied; every other size, reach and mounting
  height is a placeholder named in the kind's data. A kind may carry an `elevation` (define_item_kind),
  so a wall mixer over a bath is not an `items_overlap` once their heights differ. The corner bath
  is a right-angle isosceles triangle with a rounded hypotenuse; the arc depth is a placeholder.
  The shower screen is the owner's fixed glass panel, 900 wide × 2100 high on black clips, 1200 mm
  from the window wall; the face that 1200 mm is taken to is not recorded.

- Briefs can capture what a label prints beyond lengths. A `quantity` field carries its own unit
  (W, V, A, Ω, W/m, °C, m²) and range, and prints with that unit on the spec sheet; a wrong-unit
  value is refused. New briefs: floor heating cable, thermostat/controller and bath/basin waste
  (none placeable; the cable's route stays in the heating tools). A `packaging` datum records a
  carton size without ever making it the product's envelope. The human capture form also covers
  these three, so a photographed label can be recorded with its evidence and date.

- An accessory that sits inside another fixture (a bath waste, a basket) is fitted to it with
  `fit_item`: its place is given in the host's own frame (across its centreline, out from its back
  edge) and must lie inside the host's real outline. Its pose is derived from the host, so it
  moves, turns and is removed with it, and it is not an `items_overlap` with that host. An
  accessory whose host is gone, or that falls outside it, is a warning. The sample's Ahrok waste
  is fitted inside the bath.

- Tapware and shower fittings take optional working limits (minimum and maximum pressure in kPa,
  maximum hot water temperature in °C). When sources disagree, the working value keeps the others
  as alternatives, the disagreement is flagged, and the spec sheet prints the limit used for checks:
  the lowest of the sourced maximums (highest of the minimums). A figure whose datum a source does
  not make clear is recorded with the `unresolved` datum and an explanation; it is kept as
  written and is never used as a dimension or set-out. A set's parts are components, and a part
  that was not seen stays `unresolved` on the sheet, as the sample's K1130 trim does.

- A spec sheet you already hold can be attached to a request (PDF or image, up to 10 MB). It
  stays in this browser: the file in IndexedDB, its record with the library. A PDF's text is
  read in the browser with pdf.js, page by page, and `get_product_brief` hands it to the agent,
  which cites it as `attachment:<id>` with the page as locator. A citation to an attachment the
  request does not have, or a page the PDF does not have, is refused. Images are for the
  person's review only, and scanned pages are not OCR'd: the page says so, and an agent that
  needs a photo's contents asks for it to be pasted into the conversation. Storage that is full
  refuses the file whole with a clear message.

- One store, two users. A vanilla zustand store powers both the React UI and the WebMCP
  tools, so actions, validation and undo history are identical for both.
- Every tool call, human or agent, is logged to an on-page activity feed with source
  badges. The spec asks that tools run visibly on the page; this is that.
- `readOnlyHint` / `untrustedContentHint` annotations help the agent plan, and every tool
  carries a `title` next to its `name`. MCP's `destructiveHint` rides along too — WebMCP
  does not define it yet, so it is enforced page-side (see the spec notes below).
- Tools are registered with `registerTool(descriptor, { signal, exposedTo })` and retired
  by **aborting that signal**, which is the spec's unregistration path and what makes the
  runtime emit `toolchange`.
- `get_issues` runs a geometry constraint engine (below). Agents call it after editing
  and fix their own mistakes, which is the self-repair loop.
- Without a WebMCP runtime the app loses nothing. The built-in ToolRunner executes the
  same tools manually.

## Tests

`npm test` runs the unit tests. `npm run test:e2e` starts a dev server and runs every browser
suite in `tests/*.e2e.mjs` (three at a time; `E2E_JOBS`, `E2E_PORT` and `ALZA_BASE_URL` adjust
that), printing PASS, SKIP or FAIL for each. Every suite finds its browser through
`tests/browser.mjs`: Playwright's own Chromium when installed, otherwise set `CHROMIUM_PATH`.
`mm-geometry` drives the real WebMCP runtime and reports SKIP, with the reason, on a Chromium
that lacks `navigator.modelContextTesting`.

## Two things WebMCP makes possible that I had not seen elsewhere

### 1. The human approves what the agent destroys

The explainer lists per-call user confirmation as an **open question** ("a way for a tool
to prompt the user for confirmation"). Reno Layouts answers it on the page. A tool annotated
`destructiveHint` does not run when the agent calls it; it becomes a **request bar** at
the bottom of the studio (*"AGENT WANTS TO erase the whole plan"*) and the agent's
`execute()` stays pending until a human presses Approve or Reject. Reject returns a real
failure the agent can act on ("the human declined … ask them what to do instead"), and the
`AbortSignal` WebMCP passes to `execute()` releases the request if the agent gives up
first.

The gate is a toggle in **sidebar → Model**. It also guards the manual ToolRunner, because
both paths run through the same wrapper.

### 2. One agent, two origins, one plan

**Nordika** is a separate website on its own origin (`partner/`). It knows nothing about
Reno Layouts. It publishes its stock as its own WebMCP tools (`nordika_list_products`,
`nordika_get_product`) and shares them with the studio using
`registerTool(descriptor, { exposedTo })`.

Reno Layouts embeds it in an iframe carrying **`allow="tools"`** (the `tools` Permissions Policy),
discovers those tools with **`getTools({ fromOrigins })`** and calls them with
**`executeTool()`**. So an agent standing on one page composes two origins: it reads a
supplier's real catalogue and lays those products into the plan at their true dimensions,
where the constraint engine judges them like anything else. *"Furnish the living room with
in-stock Nordika pieces under €400"* is a single instruction that crosses a security
boundary with no server in the middle. The browser is the integration layer.

Where a runtime has no cross-origin support, the same two calls run over `postMessage`,
and the UI says which transport was used.

## The constraint engine (`get_issues`)

Metric precision is the product. The checker validates:

- **Walls:** too short, loose ends (T-junctions count as connected), collinear overlaps
  (total or partial), mid-span crossings.
- **Openings:** vano fully inside its wall (creation-time clamping + detection), overlapping
  openings, sill + height above wall height, and **a wall ending inside another wall's
  opening**.
- **Rooms:** floating, overlapping, doorless, too small.
- **Furniture:** oriented-rectangle **SAT** against walls (leaning is legal, crossing is an
  error), blocking door swing paths and window light (with a sill-height nuance),
  item-vs-item collisions (rugs exempt), items outside every room.

The bundled **Bathroom Concept** sample is an approximate layout, not a set-out plan.
Its notes identify display placeholders and dimensions that still need confirmation.

## Architecture

```
src/
  model/    types.ts · geometry.ts (snap, SAT, segment math) · issues.ts (checker)
            faces.ts (wall reference faces, build-ups, face-to-point distances)
            tiling.ts (proposed wall tile set-out: run limits, floor reference, grid, edge and opening cuts)
            products.ts (spec brief templates, validation) · productLibrary.ts (requests, review, library)
            fixtures.ts (face-anchored fixtures, rough-in readings, clearances, occupied walls)
            outline.ts (fixture plan outlines: arcs, polygons, convex SAT)
  sheets/   check.ts (sheet preflight findings, acknowledgements) · floorPlan.ts (A-01 SVG) · issued.ts
            tiling.ts (wall tile set-out elevation SVG)
            stageView.ts (stage view catalogue, spec rows, stage diagram + spec sheet) · viewState.ts (view state, outside the model)
            stageElevation.ts (one wall elevation per room-facing side for a stage view)
            catalog.ts (31 furniture kinds + runtime entries) · store.ts (shared actions, undo, activity) · seed.ts
  editor/   Editor.tsx — SVG: chained walls, rooms, openings with door arcs,
            furniture drag, blueprint underlay, millimetre dimensions, configurable pointer snap, pan/zoom
  three/    build.ts (extrusion with real openings, resolved joints, floors)
            furniture.ts (composite pieces + generic builder for imported products) · Scene3D.tsx (orbit/top/walk + WASD,
            click-to-place, OBJ/PNG export) · exportBus.ts
  mcp/      registry.ts (registration + uniform logging) · tools.ts (60 + 1 dynamic)
            bootstrap.ts (runtime detection, dynamic tool lifecycle, toolchange)
  ui/       App · Sidebar (Model/Check/Catalog/Supplier/Notes/Tools) · ToolRunner
            ActivityFeed · ApprovalBar (human-in-the-loop gate) · SupplierPanel (cross-origin)
tests/      geometry + issues suites (34 tests, incl. seed = 0 issues regression)
            mm-geometry.e2e.mjs: the surveyed-bathroom check for millimetre geometry (#3)
            wall-tiling.e2e.mjs: one wall with a window set out, origin moved 10 mm, sheet compared (#9)
e2e-full.mjs  Playwright: drives the real app in Chromium with
            --enable-features=WebMCP,WebMCPTesting, runs every tool through the UI and
            through navigator.modelContextTesting, asserts zero console errors — 57 checks
trace.mjs   the demo plan as data: walls, openings, rooms, furniture, and the kinds the
            agent defines for itself. Shared by the video and the screenshot gallery.
record6.mjs records the film's eight beats as real 60 fps screen capture (ffmpeg ddagrab)
shots.mjs   rebuilds the screenshot gallery from trace.mjs
serve-local.mjs  serves dist/ on two origins with the production headers, for local demos
```

Stack: Vite 7 · React 19 · TypeScript (strict) · zustand · Three.js (ACES tone mapping,
PCF soft shadows) · SVG 2D · vitest · Playwright. Deploys as a fully static site.

## What building this taught me about the spec

Four of the explainer's [open questions](https://github.com/webmachinelearning/webmcp#open-questions)
turned up as real problems while building. What I did about each, in case it is useful.

**User prompting and elicitation ([#165](https://github.com/webmachinelearning/webmcp/issues/165), [#50](https://github.com/webmachinelearning/webmcp/issues/50)).** Needed on day one: a tool that clears
someone's plan cannot just run because a model called it. The answer here lives entirely in the
page — the approval gate above. It works, but every site has to build its own, and the
confirmation UI is only as trustworthy as the page drawing it, which is the argument for the
browser mediating it instead.

Related, and worth flagging: `destructiveHint` is in
[MCP's `ToolAnnotations`](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
but not in [WebMCP's](https://webmachinelearning.github.io/webmcp/), which defines only
`readOnlyHint` and `untrustedContentHint`. Reno Layouts keeps it in its own descriptors and enforces it
page-side in `mcp/registry.ts`, so nothing depends on the browser propagating it. But if the
browser is ever going to mediate confirmation, it needs some way to know which tools are
destructive.

**Multimodal input and output ([#41](https://github.com/webmachinelearning/webmcp/issues/41), [#86](https://github.com/webmachinelearning/webmcp/issues/86), [#81](https://github.com/webmachinelearning/webmcp/issues/81)).** The gap I felt hardest. Tracing
needs the agent to *see* a drawing, and a tool result is text — so a page holding an image
cannot hand it over. Worse, the page's copy is not the agent's copy: the uploader re-encodes to
≤1600 px. So `get_underlay` returns no pixels at all. It tells the agent the image has to
arrive through both channels — uploaded on the page so the app knows the scale, pasted into the
conversation so the model can read it — and it returns a mapping that only works in fractions
(`u = x_px / image_width`, then `world_x = rect.x + u * rect.w`). Fractions survive a resize;
pixel coordinates do not.

**Skills integration ([#161](https://github.com/webmachinelearning/webmcp/issues/161)).** I wrote one before I knew the issue existed. Tracing a plan is
a procedure, not a tool call: establish scale, read the drawing, lay the walls, cut the openings,
check the result, annotate whatever was ambiguous. It ships as `TRACING_PROTOCOL`, embedded in
the tool descriptions because that is the only place a page can put it today. It spends
description budget on every tool that references it, and there is no way to say "this is a
procedure" rather than "this is a tool".

**Testing.** `navigator.modelContextTesting` is the difference between guessing and knowing —
the E2E battery drives real tool execution through it. It is off by default: Playwright's
bundled Chromium exposes it with `--enable-features=WebMCP,WebMCPTesting`, which the battery
passes. A stable Google Chrome (153 at the time of writing) did not expose it with any flag I tried.

**One thing that simply worked:** unregistering by aborting the registration signal.
`extend_selected_wall` appears when a human selects a wall and disappears when they deselect it,
and every runtime I tested tracked the change with no special handling on my side.

**One runtime gap, not a spec gap:** cross-origin discovery. `exposedTo` plus
`getTools({ fromOrigins })` is correct per the spec, but neither ChatGPT's in-app browser nor
Codex resolves `fromOrigins` today — they register the page's own tools and stop there. The
`postMessage` transport behind the same interface is why the Supplier panel still works in those
clients; the activity feed says which transport actually ran.

## Develop

```bash
npm install
npm run dev        # the studio            → http://localhost:5199
npm run partner    # the partner origin    → http://localhost:5200   (second terminal)
npm test           # 34 unit tests
npm run build      # production build — two entry points: the studio and partner/
node e2e-full.mjs  # 57-check Playwright battery (run both servers first)
```

The partner catalogue is a separate origin on purpose; that is the whole point of the
cross-origin tool exchange. A different port is a different origin, so `localhost:5200` is
all you need locally. `.env` points `npm run dev` and `node e2e-full.mjs` at that local
partner, so neither needs a `?supplier=` query.

In production, `.env.production` bakes the deployed origins into the build. Deploy
`dist/partner/` to its own host or subdomain. `?supplier=https://…` remains an optional
override. Without a partner origin, everything else in the app still works.

## Heating planning

Heating planning (#8) uses the same `room.heating` record in the room Inspector, 2D plan,
WebMCP (`set_room_heating`, `get_room_heating`), printable review and selected construction-stage
diagrams. All product values may stay unknown; numeric constraints carry provenance and a
source. Route coordinates and rectangular keep-outs are in plan metres (UI entry is mm).
Cable centre height is above the selected screed bottom; a room with drainage planes derives
local screed levels from their finished surface and the layers above screed. Without entered
levels the section stays unresolved. A changed screed thickness immediately rechecks the route.

Select the whole-room footprint or one or more existing floor-plane ids, then draw a polyline
or edit its exact points. Checks identify route crossing/touching/backtracking, departure
from the zone union (including gaps between zones), entered exclusions and clearance, entered
minimum non-adjacent spacing, and excess length only when the cable length has confirmed
provenance (`published`, `measured` or `site-confirmed`). Area is zone footprint excluding
entered keep-outs, not verified heat coverage. Straight segments do not define bend radii,
cold tails, connection lengths, sensor placement or electrical design. Manufacturer and
licensed electrician review always remains pending. The purchased cable's actual specifications
have not been supplied; synthetic tests demonstrate the planning capability and cannot satisfy
the actual purchased-product end-to-end acceptance check.

Run the heating browser check with a local studio server:
`ALZA_BASE_URL=http://127.0.0.1:5208 node tests/heating.e2e.mjs`.

## Sourced fixture installation geometry

Accepted products may include optional `installationGeometry`, reviewed separately by the human. It retains source/status for the geometry, line/arc outline, fixing and service coordinates and access requirements. Point coordinates use x across the fixture centreline, y out from the physical back, and z above its bottom, in metres. Outline coordinates explicitly use `datum: {across: "fixture-centreline", out: "footprint-centre"}`: x within ±width/2, y within ±depth/2. This is the existing line/arc representation; unsupported curves retain a sourced limitation and use the documented envelope, without fitting a curve by eye.

`place_product` supports wall-mounted surface mirrors and wall towel rails through explicit `installation: {mounting: "wall", roomId, floorDatum: "finished-floor" | "substrate-top", height?: {value, status, source}, orientation, mirror}`. Height is the **product bottom above that named room floor datum**, separate from published installation requirements. Use proposed status for a proposed project height. Missing height, floor level or wall face stays unknown and omits the fixture's vertical 3D geometry. Existing unsupported recess, ceiling and moving/swing modes remain explicit limitations. New mounted catalogue kinds cannot be generically dropped without their placement evidence.

The Inspector and `set_fixture_installation` edit the same placement. `get_rough_in` returns installed levels, transformed fixing/service points and access regions; source dimensions are unchanged. Mirroring requires documented reversibility and transforms all of them together. The physical back midpoint stays at the declared wall-face gap and along-wall distance through orientation; unsupported flush mounting and resulting wall intersections are reported rather than moving the back datum. Bottom placement basis and top basis are distinct: top additionally includes the portable accepted product height evidence, and access regions starting at that top retain it too. Plan, 3D extrusion, spatial clash checks and stage diagram/spec use the same instance. Access is drawn separately from physical footprint and retains both requirement source/status and placement basis. Geometry/placement snapshots travel with project export/import; no browser product library is required to read them. These are planning representations, not manufacturer CAD or installation/compliance approval.

Synthetic verification: `ALZA_BASE_URL=http://127.0.0.1:5251 node tests/installation.e2e.mjs` exercises real human geometry review and height/orientation controls, transformed points, rendered 3D OBJ, stage outputs, reload/portable import and unresolved floor output. Fixtures are explicitly synthetic evidence, not a catalogue of actual products.

## License

MIT — see [LICENSE](./LICENSE).

### Accepted catalogue revisions (#53)

The Products page opens a separate correction draft from an accepted specification. Human review produces a new revision of the same exact variant; changed SKU/finish/hand remains a distinct product. Accepted source records and their reviews remain available. Accepting a revision leaves every placed fixture unchanged.

Choose existing instances on the new revision card, preview dimensions, outlines, services, source evidence and resulting clashes, then acknowledge and apply the selected update. Preview cancellation makes no model change. Anchors and installation height/orientation remain project decisions. Changed measured/site-confirmed service axes are retained and identified for reconciliation; geometry overrides differing from pinned product evidence require individual reconciliation before update. Unknown anchors, floor datums and source axes stay unresolved. No tool accepts a revision or applies instance updates.

Placed fixtures carry independent accepted-product and geometry snapshots, including installation geometry, so a project backup renders old and new revisions without the browser library. Undo restores the selected update. Issued sheet SVGs and stage diagram/specification archives retain their original content, dates, acknowledgements and planning-evidence references; the Sheets page identifies historical outputs after later changes and offers downloads after reload or import. Older issuance records without content remain identifiable as legacy records.
