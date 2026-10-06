/** Bounded fitting briefs (#50). All figures describe the exact product, never a proposed
 * project mounting height. Text layouts retain the source's datums until #51 can model them. */
import type { FieldSpec, LengthField, QuantityField, ProductCategory, ReferenceId } from "./products";

type When = { field: string; in: string[] };
const length = (key: string, label: string, definition: string, reference: ReferenceId, min = 0, max = 3, when?: When): LengthField =>
  ({ type: "length", key, label, definition, reference, min, max, group: "installation", required: true, ...(when ? { when } : {}) });
const choice = (key: string, label: string, options: string[], definition: string, when?: When): FieldSpec =>
  ({ type: "choice", key, label, options, definition, group: "installation", required: true, ...(when ? { when } : {}) });
const text = (key: string, label: string, definition: string, when?: When): FieldSpec =>
  ({ type: "text", key, label, definition, group: "installation", required: true, ...(when ? { when } : {}) });
const quantity = (key: string, label: string, unit: string, definition: string, min: number, max: number, when?: When, group: FieldSpec["group"] = "installation"): QuantityField =>
  ({ type: "quantity", key, label, unit, definition, min, max, group, required: true, ...(when ? { when } : {}) });
/** Working limits are useful for an installer but not needed for a trade drawing, so they may stay blank. */
const limits = (when?: When): FieldSpec[] => [
  { ...quantity("pressureMin", "Working pressure, minimum", "kPa", "Lowest supply pressure the product works at, as published. Convert MPa to kPa (1 MPa = 1000 kPa) and cite the source figure; a conflicting figure goes under alternatives.", 0, 2000, when), required: false },
  { ...quantity("pressureMax", "Working pressure, maximum", "kPa", "Highest static inlet pressure the product is rated for, as published. Where sources differ, submit the one you trust with the others under alternatives; the lowest is used for checks.", 0, 2000, when), required: false },
  { ...quantity("temperatureMax", "Hot water temperature, maximum", "°C", "Highest supply temperature, as published. Where sources differ, submit the one you trust with the others under alternatives; the lowest is used for checks.", 0, 120, when), required: false },
];
const when = (field: string, ...values: string[]): When => ({ field, in: values });
const envelope = (): FieldSpec[] => [
  { ...length("width", "Overall width", "Maximum product width, across its own left and right ends; metres.", "fixture-end", 0.001), group: "envelope" },
  { ...length("depth", "Exposed projection / depth", "Maximum exposed projection from the product's back/mounting plane, excluding any concealed body; metres.", "fixture-side", 0.001), group: "envelope" },
  { ...length("height", "Overall product height", "Maximum product height from its own bottom edge; not an installed height above the project floor; metres.", "fixture-bottom", 0.001), group: "envelope" },
];
const fixing = () => text("fixingLayout", "Fixing arrangement / centres", "Published fixing count, centres, hole sizes and mounting arrangement, naming the product edge or centreline for each offset. Preserve units and the exact source layout; do not invent positions from an image.");
const powerWhen = when("power", "required");
const powerFields = (condition = powerWhen): FieldSpec[] => [
  choice("power", "Power mode", ["not-required", "required"], "Whether this exact supplied variant requires electrical power."),
  choice("powerConnection", "Electrical connection", ["plug", "hardwired", "low-voltage", "other"], "Published connection type; no proposed project socket location.", condition),
  text("powerRequirements", "Power / access requirements", "Published voltage, rating, cable route, driver/transformer and isolation or servicing access requirements, with units and any source datums. Required accessories are recorded as exact components.", condition),
  length("powerOffset", "Power entry sideways offset", "Product power entry centre sideways from product centreline, facing it; left negative; metres.", "fixture-centreline", -1.5, 1.5, condition),
  length("powerHeight", "Power entry height within product", "Product power entry centre above the product's own bottom edge; metres. Do not submit a proposed project outlet height.", "fixture-bottom", 0, 3, condition),
  length("powerDepth", "Power entry depth", "Product power entry centre from its back/mounting plane; metres; behind this plane is negative.", "fixture-side", -0.5, 0.5, condition),
];
const localPower = (condition = powerWhen) => ({ id: "power", label: "Product power entry", service: "power" as const, when: condition,
  across: { field: "powerOffset" }, out: { field: "powerDepth" }, up: { field: "powerHeight" } });
const box = { w: "width", d: "depth", h: "height" };
const unsupported = (limitation: string) => ({ supportedWhen: [], limitation });

export const BATHROOM_PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    id: "tapware", label: "Tapware", envelope: box,
    placement: { supportedWhen: [when("mounting", "floor-standing")], limitation: "Only floor-standing tapware can use a generic floor-based envelope. Deck and wall mounting, concealed bodies and project mounting heights are not represented." },
    fields: [
      ...envelope(),
      choice("mounting", "Mounting", ["deck", "wall-exposed", "wall-concealed", "floor-standing", "other"], "Published product mounting mode, including whether the body is concealed."),
      { type: "count", key: "tapHoles", label: "Mounting hole count", group: "installation", required: true, min: 1, max: 5, when: when("mounting", "deck"), definition: "Number of required holes in the deck or basin; count." },
      text("holeLayout", "Mounting hole layout", "Published hole diameters and centres relative to the product centreline or named deck edge, with units; do not infer a layout from hole count.", when("mounting", "deck")),
      fixing(),
      ...limits(),
      choice("inletMode", "Water inlet arrangement", ["single", "hot-cold", "other"], "Whether the exact product has one inlet or separate hot and cold inlets."),
      length("inletSpacing", "Hot / cold inlet centres", "Centre-to-centre inlet spacing across the product; metres.", "fixture-centreline", 0, 1, when("inletMode", "hot-cold")),
      text("waterConnection", "Water connection details", "Published inlet size/thread, hot/cold orientation and flexible/concealed connection arrangement; retain named source datums and units."),
      length("inletOffset", "Water inlet sideways offset", "Centre of the single inlet, or midpoint of the hot/cold pair, from product centreline; left negative; metres.", "fixture-centreline", -1, 1),
      length("inletDepth", "Water inlet depth", "Inlet centre or pair midpoint from the product back/mounting plane; behind it is negative; metres.", "fixture-side", -0.5, 1),
      length("inletHeight", "Water inlet height within product", "Inlet centre or pair midpoint above product bottom, not a project mounting height; metres.", "fixture-bottom", 0, 2),
      length("concealedDepthMin", "Concealed body minimum depth", "Minimum body installation depth behind the finished wall, as published; metres.", "finished-wall", 0, 0.5, when("mounting", "wall-concealed")),
      length("concealedDepthMax", "Concealed body maximum depth", "Maximum body installation depth behind the finished wall, as published; metres.", "finished-wall", 0, 0.5, when("mounting", "wall-concealed")),
    ],
    // The midpoint of a pair is not a connection: keep the pair's individual layout as
    // sourced requirements until #51 can represent it, rather than inventing a single inlet.
    roughIn: [{ id: "inlet", label: "Single water inlet", service: "water", when: when("inletMode", "single"), across: { field: "inletOffset" }, out: { field: "inletDepth" }, up: { field: "inletHeight" } }],
  },
  {
    id: "shower-fittings", label: "Shower fittings", envelope: box,
    placement: unsupported("Shower wall/ceiling mounting and adjustable head/rail geometry cannot use the current floor-based envelope."),
    fields: [
      ...envelope(),
      choice("fittingType", "Fitting / assembly type", ["head", "rail", "arm", "system"], "Whether the exact product is a head, rail, arm, or combined shower system; component extents only apply when supplied."),
      choice("mounting", "Mounting", ["wall", "ceiling", "other"], "Published attachment plane for this exact shower fitting assembly."),
      length("headWidth", "Head width / diameter", "Maximum head width or diameter across its own centreline; metres.", "fixture-centreline", 0.001, 1, when("fittingType", "head", "system")),
      length("armProjection", "Arm projection", "Arm exposed extent from its mounting plane to its furthest end; metres.", "fixture-side", 0, 1.5, when("fittingType", "arm", "system")),
      length("railLength", "Rail length", "Rail length from its lower end; metres.", "fixture-bottom", 0, 2, when("fittingType", "rail", "system")),
      fixing(),
      ...limits(),
      choice("adjustment", "Adjustment mode", ["fixed", "adjustable"], "Whether the supplied assembly has published dimensional adjustment."),
      length("adjustmentMin", "Minimum adjustable position", "Minimum head/carriage position along the rail from its lower end; metres.", "fixture-bottom", 0, 2, when("adjustment", "adjustable")),
      length("adjustmentMax", "Maximum adjustable position", "Maximum head/carriage position along the rail from its lower end; metres.", "fixture-bottom", 0, 2, when("adjustment", "adjustable")),
      choice("waterEntry", "Water entry arrangement", ["none", "single", "other"], "A bare fixing rail has no water entry; a fitting or assembly may have one or several connections."),
      text("waterConnection", "Water connection details", "Published thread/diameter and connection arrangement, naming the mounting plane and each source datum; retain units.", when("waterEntry", "single", "other")),
      length("inletOffset", "Water inlet sideways offset", "Inlet centre sideways from the assembly centreline; left negative; metres.", "fixture-centreline", -1, 1, when("waterEntry", "single")),
      length("inletDepth", "Water inlet depth", "Inlet centre from the assembly mounting plane; behind it negative; metres.", "fixture-side", -0.5, 1, when("waterEntry", "single")),
      length("inletHeight", "Water inlet height within product", "Inlet centre above assembly bottom; not a proposed project shower height; metres.", "fixture-bottom", 0, 3, when("waterEntry", "single")),
    ],
    roughIn: [{ id: "inlet", label: "Shower water entry", service: "water", when: when("waterEntry", "single"), across: { field: "inletOffset" }, out: { field: "inletDepth" }, up: { field: "inletHeight" } }],
  },
  {
    id: "shower-screen", label: "Shower screen", envelope: box,
    placement: { supportedWhen: [when("opening", "fixed"), when("mounting", "floor-supported")], limitation: "Only a fixed floor-supported screen can use its generic envelope. Hinged/sliding movement, wall-supported or raised panels and fixing geometry are not represented." },
    fields: [
      ...envelope(),
      length("panelWidth", "Panel width", "Published glass panel width from its named end; metres; overall assembly width remains separate.", "fixture-end", 0.001, 3),
      length("panelHeight", "Panel height", "Published glass panel height from its bottom edge; metres; excludes mounting channels unless the source includes them.", "fixture-bottom", 0.001, 3),
      length("thickness", "Glass thickness", "Published panel thickness through the glass plane; metres.", "fixture-side", 0.001, 0.05),
      choice("mounting", "Panel support", ["floor-supported", "wall-supported", "other"], "Whether the assembly stands at finished floor level or is supported/raised from the wall."),
      choice("handedness", "Handedness", ["left", "right", "reversible", "not-handed"], "Published hand, facing the screen from the dry side; never infer from a photograph."),
      choice("opening", "Opening mode", ["fixed", "hinged", "sliding"], "Whether the assembly is a fixed panel, hinged door or sliding door."),
      length("openingWidth", "Clear opening width", "Published clear opening between limiting assembly edges; metres.", "fixture-end", 0.001, 2, when("opening", "hinged", "sliding")),
      text("openingLayout", "Swing / sliding arrangement", "Published pivot/track location, swing direction and angular range (degrees), or travel (with units), relative to named product edges. No swing geometry is inferred.", when("opening", "hinged", "sliding")),
      fixing(),
    ], roughIn: [],
  },
  {
    id: "drain", label: "Drain", envelope: box,
    placement: unsupported("Recessed drain bodies, floor penetrations and installation depth below finished floor are not represented by the floor-based envelope. Link the product to a floor waste instead (set_room_drainage wastes[].product)."),
    fields: [
      ...envelope(),
      { ...choice("grateType", "Grate type", ["slotted", "tile-insert", "other"], "Published grate kind. A tile-insert grate holds a piece of the floor tile, so the tiler cuts tile for the insert as well as around it."), required: false },
      length("grateLength", "Grate length", "Maximum grate length along its own end-to-end axis; metres.", "fixture-end", 0.001, 3),
      length("grateWidth", "Grate width", "Maximum grate width across its own centreline; metres.", "fixture-centreline", 0.001, 1),
      choice("outletDirection", "Outlet direction", ["vertical", "horizontal", "other"], "Published discharge direction; no project pipe route is proposed."),
      length("outletDiameter", "Outlet diameter", "Published outlet connection diameter through the outlet centreline; metres.", "fixture-centreline", 0.001, 0.3),
      length("outletOffset", "Outlet sideways offset", "Outlet centre sideways from body centreline; left negative; metres.", "fixture-centreline", -1.5, 1.5),
      length("outletDepth", "Outlet from body back edge", "Outlet centre from drain body's back edge in plan; metres.", "fixture-side", 0, 1),
      length("outletBelowGrate", "Outlet below grate", "Outlet centre below grate top; positive down; metres. The named top datum cannot yet be converted into plan service geometry.", "other", 0, 1),
      length("installationDepth", "Installation depth", "Published body depth below grate top / finished floor; positive down; metres. Preserve another source datum explicitly.", "finished-floor", 0.001, 1),
      text("installationRequirements", "Installation / fixing requirements", "Published flange, bedding, waterproofing interface, fall and service access requirements; retain source datums and units."),
    ], roughIn: [{ id: "outlet", label: "Drain outlet (depth below grate)", service: "waste", across: { field: "outletOffset" }, out: { field: "outletDepth" }, up: { field: "outletBelowGrate" } }],
  },
  {
    id: "towel-rail", label: "Towel rail", envelope: box,
    placement: { supportedWhen: [when("mounting", "floor-standing")], limitation: "Only floor-standing towel rails can use a generic envelope. Raised wall mounting, fixing centres and heating connection geometry are not represented." },
    fields: [
      ...envelope(), fixing(),
      choice("mounting", "Mounting", ["wall", "floor-standing", "other"], "Published support mode; a proposed project mounting height is separate from the product."),
      length("fixingCentresWidth", "Horizontal fixing centres", "Horizontal centre-to-centre fixing span across the rail; metres.", "fixture-centreline", 0, 2),
      length("fixingCentresHeight", "Vertical fixing centres", "Vertical centre-to-centre fixing span; metres; zero only when published as one fixing row.", "fixture-bottom", 0, 3),
      choice("heating", "Heating mode", ["unheated", "electric", "hydronic", "dual"], "Heating mode of this exact variant; electric/dual require power, hydronic/dual require water connections."),
      ...powerFields(when("heating", "electric", "dual")),
      text("waterConnection", "Heating water connections", "Published flow/return thread sizes, centres and offsets from named rail edges, with units; no pipe route is inferred.", when("heating", "hydronic", "dual")),
    ], roughIn: [localPower(when("heating", "electric", "dual"))],
  },
  {
    id: "mirror", label: "Mirror / mirror cabinet", envelope: box,
    placement: unsupported("Raised wall mirrors and recessed cabinets, door swings, fixing and access geometry cannot use the current floor-based envelope."),
    fields: [
      ...envelope(),
      choice("kind", "Product kind", ["mirror", "cabinet"], "Plain mirror or mirror cabinet; exact illuminated/demister variant is part of the product identity."),
      choice("mounting", "Mounting", ["surface", "recessed", "other"], "Published wall mounting mode."),
      length("recessDepth", "Required recess depth", "Published required depth behind finished wall; metres.", "finished-wall", 0.001, 0.5, when("mounting", "recessed")),
      text("recessOpening", "Recess opening / allowances", "Published recess width/height and tolerance with units, naming the opening edges and finished wall datum.", when("mounting", "recessed")),
      fixing(),
      text("accessRequirements", "Door / servicing access", "Published door swing, removal, maintenance and ventilation clearance requirements, with units and datums. For a plain mirror record explicit no-access requirement only when sourced."),
      ...powerFields(),
    ], roughIn: [localPower()],
  },
  {
    id: "heating-cable", label: "Floor heating cable", envelope: box,
    placement: unsupported("A floor heating cable is a length of cable, not an envelope. Its proposed route is entered with the heating tools, which read length, output and coverage from a referenced heating-cable brief."),
    fields: [
      choice("cableType", "Installation type", ["in-screed", "under-tile", "other"], "Where the exact product is designed to be embedded; a label naming a screed is not under-tile."),
      length("cableLength", "Heating cable length", "Heated cable length from its cold joint to its end, excluding cold tails; metres.", "fixture-end", 1, 300),
      quantity("outputPerMetre", "Output per metre", "W/m", "Rated output per metre at the rated voltage.", 1, 100),
      quantity("totalPower", "Total power", "W", "Rated power of the whole cable at the rated voltage.", 10, 10000),
      quantity("ratedVoltage", "Rated voltage", "V", "Supply voltage the rating is given at.", 12, 480),
      quantity("ratedCurrent", "Rated current", "A", "Current at the rated power and voltage.", 0.05, 80),
      quantity("resistance", "Cable resistance", "Ω", "Resistance of the whole cable as printed; useful for commissioning checks.", 1, 10000),
      quantity("coverageAreaMin", "Coverage area, minimum", "m²", "Smallest floor area the sheet or label says this cable should cover.", 0.1, 100),
      quantity("coverageAreaMax", "Coverage area, maximum", "m²", "Largest floor area the sheet or label says this cable should cover.", 0.1, 100),
      length("coldTailLength", "Cold tail length", "Length of each unheated supply lead, from its free end to the cold joint; metres.", "fixture-end", 0, 20),
      text("installationRequirements", "Installation requirements", "Published cover, minimum bend radius, spacing, crossing and sensor rules, with units and source datums."),
    ], roughIn: [],
  },
  {
    id: "thermostat", label: "Thermostat / controller", envelope: box,
    placement: unsupported("A wall controller's flush box depth, mounting height and bathroom-zone rules are not represented by a floor-based envelope."),
    fields: [
      ...envelope(),
      choice("mounting", "Mounting", ["flush", "surface", "din-rail", "other"], "Published mounting method."),
      length("flushBoxDepth", "Flush box depth", "Depth the flush back box needs behind the finished wall, as published; metres.", "finished-wall", 0.001, 0.2, when("mounting", "flush")),
      quantity("ratedVoltageMin", "Rated voltage, minimum", "V", "Lowest supply voltage of the printed range.", 5, 480),
      quantity("ratedVoltageMax", "Rated voltage, maximum", "V", "Highest supply voltage of the printed range.", 5, 480),
      quantity("ratedCurrent", "Rated switching current", "A", "Maximum load current as printed.", 0.1, 100),
      quantity("tempRangeMin", "Setpoint range, minimum", "°C", "Lowest settable temperature.", -50, 150),
      quantity("tempRangeMax", "Setpoint range, maximum", "°C", "Highest settable temperature.", -50, 150),
      text("ingressProtection", "Ingress protection", "The printed IP code of the housing, exactly as printed (e.g. IP21); no zone suitability is inferred."),
      choice("floorSensor", "Floor sensor / limitation sensor", ["included", "separately-required", "none"], "Whether a sensor probe is supplied with this exact variant."),
      choice("connectivity", "Connectivity", ["none", "wifi", "other"], "Published connectivity of the exact variant."),
      text("certification", "Certification marks", "Printed approval marks and numbers, exactly as printed."),
    ], roughIn: [],
  },
  {
    id: "waste", label: "Bath / basin waste", envelope: box,
    placement: unsupported("Waste bodies sit inside a bath or basin and below the finished surface; they have no floor envelope of their own."),
    fields: [
      ...envelope(),
      length("outletDiameter", "Nominal outlet diameter", "Published connection size through its centreline; metres (a '40 mm' waste is 0.04). Name its kind in outletSizeKind; a hole is not a connection.", "fixture-centreline", 0.01, 0.2),
      { type: "choice", key: "outletSizeKind", label: "Outlet size kind", group: "installation", required: false, options: ["hole", "outlet", "connection", "thread"], definition: "Which quantity outletDiameter is: a waste hole, an outlet, a pipe connection, or a thread. Compared only like-for-like (outlet and connection are both pipe sizes; a hole is not)." },
      choice("style", "Style", ["dome-pop", "pop-up", "click-clack", "plug-and-chain", "other"], "Published operating style."),
      choice("overflow", "Overflow", ["with", "without"], "Whether this waste takes an overflow."),
      text("strainer", "Strainer / basket", "Published strainer or basket arrangement, e.g. a pull-out basket; as printed."),
      text("certification", "Certification marks", "Printed approval marks, licence numbers and standards, exactly as printed."),
    ], roughIn: [],
  },
];
