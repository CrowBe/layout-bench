/** Accepted product-local geometry (#51) and explicit project placement. Source coordinates
 * never change; all consumers derive the same transformed points and level interval. */
import type { Item, PlanModel, Quantity, ValueStatus } from "./types";
import { categoryById, type SourceRef, type FieldValue } from "./products";
import { evidenceText } from "./productMeasurements";
import { identityOf, type ExactProduct } from "./productIdentity";
import type { LibraryProduct } from "./productLibrary";
import { catalogByKind, catalogForItem, type CatalogLookup } from "./catalog";
import { floorLevels, finishedLevel } from "./floor";
import { heightAt } from "./drainage";
import { input, known, resolveFace, weakest, VALUE_STATUSES } from "./faces";
import { quantize } from "./geometry";
import { outlineProblems, toWorld, type Outline } from "./outline";

export interface GeometryEvidence { status: ValueStatus; sources: SourceRef[]; note?: string }
export interface LocalPoint extends GeometryEvidence { axisEvidence?: {across?: FieldValue;out?: FieldValue;up?: FieldValue}; id: string; label: string; x: number | null; y: number | null; z: number | null }
export interface LocalService extends LocalPoint { service: "water" | "waste" | "power" }
export interface AccessRequirement extends GeometryEvidence { id: string; label: string; direction: "left" | "right" | "front" | "above" | "below"; distance: number | null }
export interface InstallationGeometry extends GeometryEvidence {
  /** x across centreline, y out from physical back, z above product bottom; metres. */
  datum: { across: "fixture-centreline"; out: "fixture-back"; up: "fixture-bottom" };
  handedness: "unknown" | "left" | "right" | "reversible" | "not-handed";
  outline?: GeometryEvidence & { datum: { across: "fixture-centreline"; out: "footprint-centre" }; shape?: Outline; limitation?: string };
  fixings?: LocalPoint[];
  services?: LocalService[];
  clearances?: AccessRequirement[];
}
export interface FixtureInstallation {
  mounting: "wall" | "floor";
  roomId?: string;
  floorDatum: "finished-floor" | "substrate-top";
  /** Product bottom above the selected floor datum. Omission is unknown, never zero. */
  height?: Quantity;
  mirror: boolean;
  /** Yaw relative to the anchor's facing direction, degrees. */
  orientation: number;
}
/** A fixed or conflicting source hand never becomes another exact variant. */
export function mirroringProblem(product: Pick<ExactProduct, "identity">, geometry?: InstallationGeometry): string | null {
  const hand=identityOf(product).handedness;
  const documented=hand.state === "known" ? hand.value : null;
  if ([documented,geometry?.handedness].some(h=>h === "left" || h === "right") ||
      hand.alternatives?.some(a=>a.value !== documented)) return "Mirroring is unavailable: fixed or conflicting handedness evidence needs individual review; the exact variant is retained.";
  return documented === "reversible" || geometry?.handedness === "reversible" ? null : "Mirroring requires documented reversibility for this exact product; unknown handedness is retained.";
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optionalNumber = (v: unknown) => v === null || finite(v);
export function validInstallation(v: unknown): v is FixtureInstallation {
  return obj(v) && ["wall","floor"].includes(String(v.mounting)) && ["finished-floor","substrate-top"].includes(String(v.floorDatum)) &&
    (v.roomId === undefined || typeof v.roomId === "string") && typeof v.mirror === "boolean" && finite(v.orientation) &&
    (v.height === undefined || obj(v.height) && (v.height.value === undefined || finite(v.height.value) && v.height.value >= 0 && v.height.value <= 10) &&
      (v.height.status === undefined || VALUE_STATUSES.includes(v.height.status as ValueStatus)) && (v.height.value === undefined || typeof v.height.source === "string" && !!v.height.source.trim()));
}
/** Structural validation protects persisted products/projects before any renderer reads them. */
export function validInstallationGeometry(v: unknown): v is InstallationGeometry {
  if (!obj(v) || !obj(v.datum) || v.datum.across !== "fixture-centreline" || v.datum.out !== "fixture-back" || v.datum.up !== "fixture-bottom" ||
      !["unknown","left","right","reversible","not-handed"].includes(String(v.handedness))) return false;
  const evidence = (e: unknown) => obj(e) && VALUE_STATUSES.includes(e.status as ValueStatus) && Array.isArray(e.sources) && e.sources.length > 0 && e.sources.every(s => obj(s) && typeof s.url === "string" && typeof s.locator === "string" && !!s.locator.trim()) && (e.note === undefined || typeof e.note === "string");
  const point = (p: unknown) => obj(p) && typeof p.id === "string" && !!p.id.trim() && typeof p.label === "string" && optionalNumber(p.x) && optionalNumber(p.y) && optionalNumber(p.z) && evidence(p);
  if (!evidence(v)) return false;
  if (v.outline !== undefined && (!evidence(v.outline) || !obj(v.outline) || !obj(v.outline.datum) || v.outline.datum.across !== "fixture-centreline" || v.outline.datum.out !== "footprint-centre" ||
      (v.outline.shape === undefined ? typeof v.outline.limitation !== "string" || !v.outline.limitation.trim() : !obj(v.outline.shape) || !Array.isArray(v.outline.shape.segments) || !obj(v.outline.shape.start) || !finite(v.outline.shape.start.x) || !finite(v.outline.shape.start.y) || !v.outline.shape.segments.every(s => obj(s) && obj(s.to) && finite(s.to.x) && finite(s.to.y) && (s.via === undefined || obj(s.via) && finite(s.via.x) && finite(s.via.y)))))) return false;
  if (v.fixings !== undefined && (!Array.isArray(v.fixings) || !v.fixings.every(point))) return false;
  if (v.services !== undefined && (!Array.isArray(v.services) || !v.services.every(p => point(p) && obj(p) && ["water","waste","power"].includes(String(p.service))))) return false;
  if (v.clearances !== undefined && (!Array.isArray(v.clearances) || !v.clearances.every(c => evidence(c) && obj(c) && typeof c.id === "string" && typeof c.label === "string" && ["left","right","front","above","below"].includes(String(c.direction)) && (c.distance === null || finite(c.distance) && c.distance >= 0 && c.distance <= 10)))) return false;
  for (const list of [v.fixings,v.services,v.clearances]) if (Array.isArray(list) && new Set(list.map(p => (p as {id:string}).id)).size !== list.length) return false;
  return true;
}
export function geometryProblems(v: unknown, w: number, d: number, h: number): string[] {
  if (!validInstallationGeometry(v)) return ["Installation geometry needs named supported local datums, sourced evidence and finite coordinates (or explicit null unknowns)."];
  const out = v.outline?.shape ? outlineProblems(v.outline.shape,w,d) : [];
  if(v.outline?.shape){let previous=v.outline.shape.start;for(const s of v.outline.shape.segments){if(s.via && Math.abs((s.via.x-previous.x)*(s.to.y-previous.y)-(s.via.y-previous.y)*(s.to.x-previous.x))<1e-12)out.push("An arc needs three non-collinear source points; provide a sourced line or an explicit envelope fallback limitation.");previous=s.to;}}
  for (const p of [...v.fixings ?? [],...v.services ?? []]) {
    if ([p.x,p.y,p.z].some(n=>n!==null && Math.abs(n)>10)) out.push(`${p.label} needs finite local coordinates within 10 m; no project coordinates are accepted as product-local data.`);
  }
  return out;
}
/** Product-local service axes already reviewed as fields can use explicit instance elevation.
 * Each axis keeps its original field evidence; unsupported datum axes stay null. */
export function geometryForPlacement(product:LibraryProduct):InstallationGeometry | undefined {
  const g=product.installationGeometry ? structuredClone(product.installationGeometry) : undefined;
  const services=(product.roughIn??[]).filter(p=>p.up?.from==="fixture-bottom" && !g?.services?.some(s=>s.id===p.id)).map(p=>{
    const axisEvidence=Object.fromEntries([['across',p.across],['out',p.out],['up',p.up]].flatMap(([key,axis])=>{
      const a=axis as typeof p.across;return a?.field && product.fields[a.field] ? [[key,structuredClone(product.fields[a.field])]] : [];
    })) as LocalPoint['axisEvidence'];
    const fields=Object.values(axisEvidence??{}),sources=fields.flatMap(f=>f.sources??[]);
    return {id:p.id,label:p.label,service:p.service,x:p.across?.from==="fixture-centreline"?p.across.value??null:null,y:p.out?.from==="fixture-side"?p.out.value??null:null,z:p.up?.value??null,status:weakest(fields.filter(f=>typeof f.value==="number").map(f=>input("source axis",{value:f.value as number,status:f.status}))) as ValueStatus,sources,axisEvidence};
  }).filter(p=>p.sources.length>0);
  if(!g && !services.length)return undefined;
  const evidence=services.flatMap(p=>p.sources);
  return {...(g??{status:"published",sources:evidence,datum:{across:"fixture-centreline",out:"fixture-back",up:"fixture-bottom"},handedness:"unknown"}),services:[...g?.services??[],...services]};
}

export function installationReading(model: PlanModel, item: Item, lookup: CatalogLookup = catalogByKind) {
  const p = item.installation, cat = catalogForItem(item,lookup);
  const limitations: string[]=[];
  if(p?.mounting === "wall" && Math.abs(((p.orientation % 360) + 360) % 360)>1e-6)limitations.push("Physical back midpoint remains on the named wall-face gap; this yaw does not represent supported flush wall mounting. Check wall intersections.");
  if (!p) return {resolved:true,bottom:0.04,top:cat ? cat.h+.04 : undefined,basis:"estimated" as ValueStatus | "unknown",missing:[] as string[],datum:"legacy display ground",limitations,topBasis:"estimated" as ValueStatus | "unknown",heightEvidence:undefined as FieldValue | undefined,bottomSource:"Legacy display ground; no entered installation datum",topSource:"Legacy catalogue height; evidence unknown",floorLevel:0.04,finishedFloorLevel:0.04};
  const missing: string[] = [];
  const room = model.rooms.find(r => r.id === p.roomId);
  if (!room) missing.push("named floor room");
  if (!known(p.height)) missing.push("product bottom height and status above floor datum");
  const face = item.anchor && model.walls.find(w => w.id === item.anchor!.wallId);
  if (!face || !item.anchor) missing.push("wall anchor");
  else { const f=resolveFace(face.sides?.[item.anchor.side],item.anchor.face);if(!f.resolved)missing.push(...f.missing); }
  let floor = room ? p.floorDatum === "substrate-top" ? floorLevels(room.floorBuildUp)[0] : finishedLevel(room.floorBuildUp) : undefined;
  if (room?.drainage?.planes.length && p.floorDatum === "finished-floor") {
    const lv=heightAt(room.drainage,item.x,item.y);
    floor={level:"finished",label:"Local finished floor",kind:"tile",resolved:lv.level!==undefined,top:lv.level,basis:lv.basis,missing:lv.level===undefined?[lv.reason??"local floor level"]:[],inputs:[]};
  }
  if (!floor?.resolved) missing.push(...floor?.missing ?? ["floor level"]);
  if (!cat) missing.push("product envelope");
  const resolved=missing.length===0;
  const bottom=resolved ? quantize(floor!.top!+p.height!.value!) : undefined;
  const basis=resolved ? weakest([input("height",p.height),{field:"floor",value:floor!.top!,status:floor!.basis},{field:"anchor",value:0,status:item.anchor!.status}]) : "unknown";
  // Product dimensions retain their own evidence; confirmed bottom placement cannot
  // promote a published height into a confirmed top level. This snapshot is portable.
  const specification=item.productSpecification;
  const heightKey=specification && categoryById(specification.category)?.envelope.h;
  const heightEvidence=heightKey ? specification!.fields[heightKey] : undefined;
  const heightMatches=typeof heightEvidence?.value === "number" && cat && Math.abs(heightEvidence.value-cat.h)<1e-6;
  const topBasis=bottom!==undefined ? weakest([{field:"installed bottom",value:bottom,status:basis},{field:"product height",value:heightMatches?cat!.h:null,status:heightMatches?heightEvidence!.status??"unknown":"unknown"}]) : "unknown";
  const side=face && item.anchor && face.sides?.[item.anchor.side];
  const bottomSource=[...new Set([item.anchor?.source,p.height?.source,room?.floorBuildUp?.substrateTop?.source,...room?.floorBuildUp?.layers.map(l=>l.thickness.source)??[],side?.existing?.source,side?.frame?.source,...side?.layers.map(l=>l.thickness.source)??[]].filter(Boolean))].join("; ");
  const topSource=[bottomSource,evidenceText(heightEvidence)].filter(Boolean).join("; ");
  let finishedFloorLevel=room ? finishedLevel(room.floorBuildUp).top : undefined;
  if(room?.drainage?.planes.length)finishedFloorLevel=heightAt(room.drainage,item.x,item.y).level;
  return {resolved,limitations,topBasis,heightEvidence,bottomSource,topSource,...(bottom!==undefined?{bottom,top:quantize(bottom+cat!.h)}:{}),basis,missing:[...new Set(missing)],datum:`${room?.label??"unknown room"}: ${p.floorDatum}; ${room?.floorBuildUp?.datum??"unknown floor datum"}`,floorLevel:floor?.resolved?floor.top:undefined,finishedFloorLevel};
}
export function localPointReading(model: PlanModel,item:Item,p:LocalPoint, lookup: CatalogLookup = catalogByKind) {
  const cat=catalogForItem(item,lookup),lv=installationReading(model,item,lookup),missing=[...lv.missing];
  if (p.x===null || p.y===null || !cat) missing.push("local plan coordinates");
  if (p.z===null)missing.push("local height");
  const face=item.anchor && model.walls.find(w=>w.id===item.anchor!.wallId);
  const planResolved=!!cat && p.x!==null && p.y!==null && !!face && resolveFace(face.sides?.[item.anchor!.side],item.anchor!.face).resolved;
  const xy=planResolved?toWorld([{x:(item.installation?.mirror?-1:1)*p.x!,y:p.y!-cat!.d/2}],item)[0]:undefined;
  const level=lv.bottom!==undefined && p.z!==null ? quantize(lv.bottom+p.z):undefined;
  return {id:p.id,label:p.label,...(xy?{x:quantize(xy.x),y:quantize(xy.y)}:{}),...(level!==undefined?{level}:{}),basis:lv.resolved?weakest([input("local coordinate",{value:0,status:p.status}),{field:"placement",value:0,status:lv.basis}]):"unknown",resolved:missing.length===0,missing,source:p.sources.map(s=>`${s.url} (${s.locator})`).join("; "),local:p};
}
export function clearanceRegions(model:PlanModel,item:Item, lookup: CatalogLookup = catalogByKind) {
  const c=catalogForItem(item,lookup),lv=installationReading(model,item,lookup);
  if(!c)return [];
  return (item.installationGeometry?.clearances??[]).map(r=>{
    const d=r.distance;
    let x0=-c.w/2,x1=c.w/2,y0=-c.d/2,y1=c.d/2,bottom=lv.bottom,top=lv.top;
    if(d!==null){if(r.direction==="left"){x1=x0;x0-=d;}if(r.direction==="right"){x0=x1;x1+=d;}if(r.direction==="front"){y0=y1;y1+=d;}if(r.direction==="above"){bottom=top;top=top===undefined?undefined:top+d;}if(r.direction==="below"){top=bottom;bottom=bottom===undefined?undefined:bottom-d;}}
    const polygon=toWorld([{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}].map(p=>({...p,x:item.installation?.mirror?-p.x:p.x})),item);
    const placementBasis=r.direction==="below"?lv.basis:lv.topBasis;
    const placementSource=r.direction==="below"?lv.bottomSource:lv.topSource;
    const levelBasis=weakest([{field:"installed extent",value:bottom??null,status:placementBasis},{field:"access distance",value:d,status:d===null?"unknown":r.status}]);
    const levelSource=[placementSource,...r.sources.map(s=>`${s.url} (${s.locator})`)].filter(Boolean).join("; ");
    return {...r,polygon,bottom,top,placementBasis,placementSource,levelBasis,levelSource,resolved:d!==null && lv.resolved,missing:d===null?["specified clearance distance"]:lv.missing};
  });
}
