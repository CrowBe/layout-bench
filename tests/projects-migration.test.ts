import { describe, expect, it } from "vitest";
import { DOCUMENT_VERSION, DEMO_ID, parseImport, parseLibrary, parseProject } from "../src/model/projects";

/** Stored v1 export. Identity migration must keep every field except the version number. */
const v1Project = {
  version: 1,
  id: "project_survey",
  model: {
    name: "Bathroom Survey",
    walls: [
      { id: "wall_n", ax: 0, ay: 0, bx: 4.25, by: 0, thickness: 0.15, height: 2.7 },
      { id: "wall_e", ax: 4.25, ay: 0, bx: 4.25, by: 3.1, thickness: 0.15, height: 2.4 },
    ],
    openings: [
      { id: "door_main", kind: "door", wallId: "wall_n", t: 0.42, width: 0.9, sill: 0, height: 2.1, hinge: "b", side: "left" },
      { id: "win_bath", kind: "window", wallId: "wall_e", t: 0.55, width: 0.6, sill: 1.1, height: 0.8, heightDefaulted: true },
    ],
    rooms: [
      { id: "room_bath", x: 0.1, y: 0.1, w: 4.05, h: 2.9, label: "Bathroom", floor: "tile" },
    ],
    items: [
      { id: "item_vanity", kind: "survey_vanity", x: 1.25, y: 0.4, rotation: 90 },
    ],
    underlay: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", opacity: 0.35, x: -0.2, y: 0.15, w: 5.5, h: 3.4, pw: 1600, ph: 900 },
  },
  notes: [
    { id: "note_1", author: "human", text: "Check window height on site.", at: 1_700_000_000_000 },
    { id: "note_2", author: "agent", text: "Vanity is 910 mm wide.", at: 1_700_000_100_000 },
  ],
  kinds: [
    {
      entry: { kind: "survey_vanity", label: "Survey vanity", w: 0.91, d: 0.465, h: 0.85, color: "#d8dde2", category: "bath" },
      parts: [{ shape: "box", x: 0, y: 0.4, z: 0, w: 0.91, h: 0.8, d: 0.465, color: "#d8dde2" }],
    },
  ],
};

const v1Library = {
  version: 1,
  activeId: "project_survey",
  projects: [
    {
      version: 1,
      id: DEMO_ID,
      model: {
        name: "Sunset Loft",
        walls: [{ id: "wall_n", ax: 0, ay: 0, bx: 8, by: 0, thickness: 0.15, height: 2.7 }],
        openings: [],
        rooms: [],
        items: [],
        underlay: null,
      },
      notes: [],
      kinds: [],
    },
    v1Project,
  ],
};

describe("project document migration", () => {
  it("bumps the stored document version", () => {
    expect(DOCUMENT_VERSION).toBe(2);
  });

  it("loads a stored v1 export as v2 with the same model content", () => {
    const project = parseImport(JSON.stringify(v1Project));
    expect(project.version).toBe(2);
    expect(project.id).toBe(v1Project.id);
    expect(project.model.walls).toEqual(v1Project.model.walls);
    expect(project.model.openings).toEqual(v1Project.model.openings);
    expect(project.model.rooms).toEqual(v1Project.model.rooms);
    expect(project.model.items).toEqual(v1Project.model.items);
    expect(project.model.underlay).toEqual(v1Project.model.underlay);
    expect(project.notes).toEqual(v1Project.notes);
    expect(project.kinds).toEqual(v1Project.kinds);
    expect(project.model).toEqual(v1Project.model);
  });

  it("loads a stored v1 library as v2 and migrates every project", () => {
    const library = parseLibrary(JSON.stringify(v1Library));
    expect(library.version).toBe(2);
    expect(library.activeId).toBe(v1Library.activeId);
    expect(library.projects.map((project) => project.version)).toEqual([2, 2]);
    expect(library.projects.map((project) => project.id)).toEqual([DEMO_ID, v1Project.id]);
    const survey = library.projects[1];
    expect(survey.model.walls).toEqual(v1Project.model.walls);
    expect(survey.model.openings).toEqual(v1Project.model.openings);
    expect(survey.model.rooms).toEqual(v1Project.model.rooms);
    expect(survey.model.items).toEqual(v1Project.model.items);
    expect(survey.model.underlay).toEqual(v1Project.model.underlay);
    expect(survey.notes).toEqual(v1Project.notes);
    expect(survey.kinds).toEqual(v1Project.kinds);
    expect(library.projects[0].model.walls[0]).toEqual(v1Library.projects[0].model.walls[0]);
  });

  it("does not mutate the v1 document it migrates", () => {
    const stored = structuredClone(v1Project);
    const project = parseProject(stored);
    expect(project.version).toBe(2);
    expect(stored.version).toBe(1);
    expect(stored.model.walls[0].ax).toBe(0);
  });

  it("parses a native v2 project and library", () => {
    const project = parseProject({ ...v1Project, version: 2 });
    expect(project.version).toBe(2);
    expect(project.model).toEqual(v1Project.model);
    expect(project.notes).toEqual(v1Project.notes);
    expect(project.kinds).toEqual(v1Project.kinds);

    const library = parseLibrary(JSON.stringify({
      ...v1Library,
      version: 2,
      projects: v1Library.projects.map((entry) => ({ ...entry, version: 2 })),
    }));
    expect(library.version).toBe(2);
    expect(library.projects.map((entry) => entry.version)).toEqual([2, 2]);
    expect(library.projects[1].model).toEqual(v1Project.model);
    expect(library.activeId).toBe("project_survey");
  });

  it("still validates a migrated document", () => {
    const broken = structuredClone(v1Project);
    broken.model.walls[0].ax = Number.NaN;
    expect(() => parseImport(JSON.stringify(broken))).toThrow(/invalid model data/);
  });

  it("rejects version 0 and version 99 without treating them as readable", () => {
    expect(() => parseImport(JSON.stringify({ ...v1Project, version: 0 }))).toThrow(/Unsupported project document version/);
    expect(() => parseImport(JSON.stringify({ ...v1Project, version: 99 }))).toThrow(/Unsupported project document version/);
    expect(() => parseProject({ ...v1Project, version: 0 })).toThrow(/Unsupported project document version/);
    expect(() => parseProject({ ...v1Project, version: 99 })).toThrow(/Unsupported project document version/);

    for (const version of [0, 99]) {
      expect(() => parseLibrary(JSON.stringify({ ...v1Library, version }))).toThrow(/Unsupported or unreadable saved library/);
      expect(() => parseLibrary(JSON.stringify({ ...v1Library, version }))).toThrow(/Original browser data was kept/);
    }
  });
});
