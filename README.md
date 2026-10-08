# Reno Layouts

Plan a renovation to the millimetre, in 2D and 3D, with an AI agent working on the same live
plan you are.

Reno Layouts is a fork of [Alza](https://github.com/Elioz404/Alza), created by
[Elioz404](https://github.com/Elioz404) for the [WebMCP Challenge](https://webmcp.devpost.com/).
Credit for the original floor-plan studio, its WebMCP integration and the
[demo film](https://www.youtube.com/watch?v=RihMFcMstvI) belongs to Alza and its contributors.
This fork adds renovation planning: surveyed geometry, wall and floor build-ups, tiling,
drainage, underfloor heating, fixture rough-in, product research and trade drawings. The
original MIT copyright notice is kept in [LICENSE](./LICENSE).

## What it does

- **Draw the room exactly.** Walls, doors, windows, rooms and fixtures in a 2D editor, stored
  to 0.1 mm. Select anything to type exact values. Load a photo or scan of a plan as an underlay
  and trace over it.
- **Record what you know, and what you don't.** Every dimension carries a status (site-confirmed,
  measured, published, proposed, estimated) and the face or datum it is measured from. Anything
  nobody has supplied stays unknown and prints as "?", never as a guessed number.
- **Build it up in layers.** Wall linings and tiles per wall side, floor layers down to the slab,
  wastes and falls, a heating cable route, and fixtures set out from a named wall face with their
  water, waste and power points.
- **See it in 3D.** Raise the plan into a 3D model you can orbit or walk through at eye height,
  for the finished room or any construction stage.
- **Print for the trades.** Dimensioned A3 floor plans, wall elevations, tile set-outs, a heating
  review and a specification sheet for each construction stage. Everything is a proposed set-out
  for trade review: not as-built, not a compliance certificate.
- **Let an agent help.** The page publishes its tools through [WebMCP](https://webmachinelearning.github.io/webmcp/),
  so an agent in your browser can apply measurements, research product specifications, compose
  stage drawings and check its own work. You approve anything destructive, and you accept
  products; no agent can.

Everything runs in your browser. There is no backend and no account; projects stay on your machine.

## Run it

You need Node.js (22 is what the repo is developed on).

```bash
npm install
npm run dev        # the studio, at http://localhost:5199
npm run partner    # optional: the demo furniture shop on a second origin, at http://localhost:5200
```

The app opens on a project chooser. **Bathroom Concept** is the shipped sample. Create a blank
project, or duplicate the sample as a starting point.

## Using it

- **Projects** switches projects, exports a project as JSON, imports a backup under a new name,
  and deletes projects you created. Projects save in this browser's local storage: they do not
  sync between devices and are lost if you clear site data, so export backups. If storage is full
  or a saved project cannot be read, the app says so and offers a backup download instead of
  overwriting it.
- **Products** is a library shared by every project in this browser: research requests,
  attached spec sheets (PDF or image), and products you have reviewed and accepted. Accepted
  products can be placed against a wall with their published rough-in points.
- The sidebar has **Model** (plan name and totals, blueprint underlay, the approval gate), **Check** (problems the
  plan has right now), **Sheets** (preview, issue and download trade drawings and stage views),
  **Catalog** (furniture and fixture kinds) and **Supplier** (the partner shop's products).
- Select a wall, room, opening or fixture to edit it in the **Inspector**: wall faces and
  build-up, wall and floor tiling, floor layers, drainage, heating, and fixture set-out.
- **Build 3D** raises the plan. Switch between orbit, top and walk views, show one construction
  stage or everything, and export an OBJ or a PNG snapshot.

## Using it with an agent

An agent can use the page's tools when it runs in a browser that supports WebMCP:

- **ChatGPT desktop:** open the app's URL in the in-app browser.
- **Google Chrome:** enable `chrome://flags/#enable-webmcp-testing` and restart.

The header shows **● Site tools live** when the tools are registered, and the **Notes** and
**Tools** tabs and the activity feed appear. Without WebMCP everything else still works and
those agent panels stay hidden. The full tool list is in [docs/TOOLS.md](docs/TOOLS.md).

Things to try:

- *"This wall is 2110 mm between finished faces. Update the plan and check it."*
- *"Research the toilet I bought: it's an American Standard Cygnet. Here is the spec sheet."*
- *"Export the rough-in stage drawings for the plumber."*
- *"Trace this plan."* Upload the image under **Model → Blueprint underlay**, paste the same
  image into the chat, and give the agent one real dimension so it can set the scale.

Destructive calls (removing walls, clearing the plan) wait on the page for you to approve or
reject them while **Model → Ask me before destructive agent actions** is on.

### Skills plugin

[`plugins/reno-layouts`](plugins/reno-layouts) is a skills-only plugin with four workflows:
edit a layout from supplied measurements, research a product request, export construction-stage
drawings, and propose a wall tile set-out. It adds guidance only; the open page supplies the
tools. Build the upload archive with `npm run build && npm run plugin:pack` (needs Python 3),
which writes `dist/reno-layouts-plugin.zip` in OpenAI's
[plugin format](https://developers.openai.com/plugins/build/plugins). Upload it where ChatGPT
offers plugin ZIP upload.

## The Bathroom Concept sample

The shipped sample is a real bathroom renovation taken from survey through to trade drawings.
Its model and the owner's decisions live in
[`src/model/seed-bathroom.ts`](src/model/seed-bathroom.ts); its notes say what is still
unconfirmed. Every output is saved in the repository:

| What | Where | Regenerate |
|------|-------|------------|
| Plan, wall elevations and specification for all 9 construction stages | [`shots/stage-pack/`](shots/stage-pack/README.md) | `npm run stage-pack` |
| A-01 floor plan, floor and wall tiling sheets, heating review | [`shots/sample-sheets/`](shots/sample-sheets/README.md) | `npm run sample-sheets` |
| 3D renders of the finished room and each build stage | [`shots/renovation-3d/`](shots/renovation-3d/) | `node stage-shots.mjs` (with `npm run dev` running) |
| Printable A3 PDF sets: wall set to pin up, full trade set for the folder | [`shots/printables/`](shots/printables/README.md) | `npm run printables` (after the two above) |
| 1:20 3D print of the finished room (3MF for Bambu Studio, STL) | [`shots/print-3d/`](shots/print-3d/README.md) | `npm run print-3d` |

## Contributing

See [AGENTS.md](AGENTS.md) for the architecture, its rules, and how to build and test.

## License

MIT. See [LICENSE](./LICENSE).
