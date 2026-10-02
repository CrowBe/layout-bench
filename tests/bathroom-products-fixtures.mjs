// Explicitly SYNTHETIC fixtures. These URLs and figures are test evidence, not real products.
export const pub = (value) => ({ value, status: "published", sources: [{ url: "https://example.com/synthetic-fitting.pdf", locator: "p. 2, synthetic dimensions table" }] });
export const unknown = () => ({ value: null, note: "Synthetic test: searched the specification and installation table; this field is not published." });
const dims = (w, d, h) => ({ width: pub(w), depth: pub(d), height: pub(h) });
const fixing = { fixingLayout: pub("Synthetic: four 6 mm holes, 400 × 600 mm centres; offsets from product centreline and bottom.") };
const inlet = { inletOffset: pub(0), inletDepth: pub(0.02), inletHeight: pub(0.12), waterConnection: pub("Synthetic: G1/2 single inlet, product-local offsets as dimensioned.") };
export const powered = { power: pub("required"), powerConnection: pub("hardwired"), powerRequirements: pub("Synthetic: 230 V, 80 W; entry rear, isolation and access per installation section."), powerOffset: pub(0.1), powerHeight: pub(0.2), powerDepth: pub(-0.01) };
export const fittingCases = [
  { category: "tapware", supported: true, unknownKey: "fixingLayout", fields: { ...dims(0.15, 0.25, 0.95), ...fixing, ...inlet, mounting: pub("floor-standing"), inletMode: pub("single") } },
  { category: "shower-fittings", supported: false, unknownKey: "railLength", fields: { ...dims(0.25, 0.5, 1), ...fixing, ...inlet, fittingType: pub("system"), waterEntry: pub("single"), mounting: pub("wall"), headWidth: pub(0.25), armProjection: pub(0.4), railLength: pub(0.7), adjustment: pub("adjustable"), adjustmentMin: pub(0.2), adjustmentMax: pub(0.6) } },
  { category: "shower-screen", supported: true, unknownKey: "fixingLayout", fields: { ...dims(0.9, 0.025, 2), ...fixing, panelWidth: pub(0.88), panelHeight: pub(1.98), thickness: pub(0.01), mounting: pub("floor-supported"), handedness: pub("not-handed"), opening: pub("fixed") } },
  { category: "drain", supported: false, unknownKey: "outletDiameter", fields: { ...dims(0.8, 0.12, 0.08), grateLength: pub(0.78), grateWidth: pub(0.1), outletDirection: pub("vertical"), outletDiameter: pub(0.05), outletOffset: pub(0), outletDepth: pub(0.06), outletBelowGrate: pub(0.07), installationDepth: pub(0.08), installationRequirements: pub("Synthetic: flange at grate top; installation details in table.") } },
  { category: "towel-rail", supported: false, unknownKey: "fixingCentresHeight", fields: { ...dims(0.5, 0.1, 0.8), ...fixing, mounting: pub("wall"), fixingCentresWidth: pub(0.45), fixingCentresHeight: pub(0.7), heating: pub("electric"), ...powered } },
  { category: "mirror", supported: false, unknownKey: "accessRequirements", fields: { ...dims(0.6, 0.03, 0.8), ...fixing, kind: pub("mirror"), mounting: pub("surface"), accessRequirements: pub("Synthetic: removable via upper brackets, clearance 20 mm above product top."), power: pub("not-required") } },
];
