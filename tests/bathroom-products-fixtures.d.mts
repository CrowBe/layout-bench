import type { FieldValue } from "../src/model/products";
export function pub(value: number | string): FieldValue;
export function unknown(): FieldValue;
export const powered: Record<string, FieldValue>;
export const fittingCases: { category: string; supported: boolean; unknownKey: string; fields: Record<string, FieldValue> }[];
