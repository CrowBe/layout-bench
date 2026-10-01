/** The last issued sheet in this page session, so a person can download what an agent issued. */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export interface IssuedSheet {
  projectId: string | null;
  sheet: string;
  rev: string;
  svg: string;
  at: number;
}

export const issuedStore = createStore<{ last: IssuedSheet | null }>(() => ({ last: null }));
export const useIssued = () => useStore(issuedStore, (s) => s.last);
export const recordIssued = (projectId: string | null, sheet: string, rev: string, svg: string) =>
  issuedStore.setState({ last: { projectId, sheet, rev, svg, at: Date.now() } });
