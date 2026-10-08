import { describe, expect, it } from "vitest";
import { demoProject, parseLibrary, sampleFingerprint, sampleStatus, DOCUMENT_VERSION } from "../src/model/projects";

/** A saved copy as it comes back from localStorage. */
const reload = (project: ReturnType<typeof demoProject>) =>
  parseLibrary(JSON.stringify({ version: DOCUMENT_VERSION, activeId: null, projects: [project] })).projects[0];

describe("Bathroom Concept sample freshness", () => {
  it("fingerprints the shipped sample the same way every time it is built", () => {
    expect(demoProject().sampleFingerprint).toBe(demoProject().sampleFingerprint);
  });

  it("treats a saved, unedited current sample as current", () => {
    expect(sampleStatus(reload(demoProject()))).toBe("current");
  });

  it("ignores presentation, which is a view setting", () => {
    expect(sampleStatus(reload({ ...demoProject(), presentation: "styled" }))).toBe("current");
  });

  it("marks an unedited copy of an older sample as safe to replace", () => {
    const older = demoProject();
    older.model = { ...older.model, name: "Bathroom Concept (older)" };
    older.sampleFingerprint = sampleFingerprint(older);
    expect(sampleStatus(reload(older))).toBe("outdated");
  });

  it("never marks an edited copy as safe to replace", () => {
    const edited = demoProject();
    edited.model = { ...edited.model, walls: edited.model.walls.slice(1) };
    expect(sampleStatus(reload(edited))).toBe("outdated-edited");
  });

  it("treats an older copy saved before fingerprints as edited", () => {
    const legacy = demoProject();
    delete legacy.sampleFingerprint;
    legacy.model = { ...legacy.model, name: "Bathroom Concept (older)" };
    expect(sampleStatus(reload(legacy))).toBe("outdated-edited");
  });
});
