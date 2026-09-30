import type { CatalogEntry } from "./catalog";
import type { Note, PlanModel } from "./types";

/** A rough bathroom concept sample. Geometry and placements are illustrative, not set-out. */
export const seedBathroom = (): PlanModel => ({
  name: "Bathroom Concept",
  walls: [
    { id: "wall_n", ax: -0.05, ay: -0.05, bx: 2.15, by: -0.05, thickness: 0.1, height: 2.4 },
    { id: "wall_e", ax: 2.15, ay: -0.05, bx: 2.15, by: 3.05, thickness: 0.1, height: 2.4 },
    { id: "wall_s", ax: 2.15, ay: 3.05, bx: -0.05, by: 3.05, thickness: 0.1, height: 2.4 },
    { id: "wall_w", ax: -0.05, ay: 3.05, bx: -0.05, by: -0.05, thickness: 0.1, height: 2.4 },
  ],
  openings: [
    { id: "window_n", kind: "window", wallId: "wall_n", t: 0.5, width: 1.81, sill: 1.52, height: 0.6 },
    { id: "door_s", kind: "door", wallId: "wall_s", t: 0.7409090909090909, width: 0.8, sill: 0, height: 1.9, hinge: "b", side: "left" },
  ],
  rooms: [{ id: "bathroom", x: 0, y: 0, w: 2.1, h: 3, label: "Bathroom", floor: "tile" }],
  items: [
    { id: "bath", kind: "bath_envelope", x: 1.6, y: 0.5, rotation: 0 },
    { id: "vanity", kind: "vanity_recorded", x: 1.85, y: 1.7, rotation: 270 },
    { id: "toilet", kind: "toilet_proxy", x: 1.7, y: 2.6, rotation: 270 },
    { id: "screen", kind: "screen_proposed", x: 0.45, y: 1.2, rotation: 0 },
  ],
  underlay: null,
});

export const bathroomKinds: { entry: CatalogEntry }[] = [
  { entry: { kind: "bath_envelope", label: "Bath", w: 1, d: 1, h: 0.63, color: "#c4cfd4", category: "bath" } },
  { entry: { kind: "vanity_recorded", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, color: "#b59c7f", category: "bath" } },
  { entry: { kind: "toilet_proxy", label: "Toilet", w: 0.48, d: 0.7, h: 0.8, color: "#e2ded4", category: "bath" } },
  { entry: { kind: "screen_proposed", label: "Screen", w: 0.9, d: 0.01, h: 2, color: "#77b8d6", category: "bath" } },
];

export const bathroomNotes = (): Note[] => {
  const at = Date.now();
  return [
    { id: "note-concept", author: "human", text: "Approximate concept sample for exploring a bathroom layout. Dimensions and geometry have been simplified for this editor.", at },
    { id: "note-placeholders", author: "human", text: "Wall sizes, opening details, fixture positions, and clearances include placeholders or proposals. Confirm them before relying on the plan.", at: at + 1 },
    { id: "note-limits", author: "human", text: "This sample is not measured set-out or a trade drawing. Drainage, services, falls, and construction layers are not represented.", at: at + 2 },
  ];
};
