import { currentReview, requiredReviewKeys, reviewEvidence } from "../src/model/productReview";
import { identityOf } from "../src/model/productIdentity";
import { beforeEach, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { categoryById, validateSubmission } from "../src/model/products";
import { products, productStore } from "../src/model/productLibrary";
import { checkModel } from "../src/model/issues";
import { installationReading, localPointReading, clearanceRegions } from "../src/model/installation";
import { anchorPose, roughIn } from "../src/model/fixtures";
import { itemPolygon, kindPolygon, toWorld } from "../src/model/outline";
import { catalogue, specRows, renderStageDiagram } from "../src/sheets/stageView";
import { demoProject, parseImport } from "../src/model/projects";
import { buildFixture } from "../src/three/build";
import * as THREE from "three";
import { fittingCases, pub, powered } from "./bathroom-products-fixtures.mjs";
const q = (value: number) => ({value,status:"proposed" as const,source:"Synthetic project set-out"});
const sources = [{url:"https://example.com/synthetic-mirror.pdf",locator:"p. 2 synthetic outline and fixing diagram"}];
const evidence = {status:"published" as const,sources};
const geometry = () => ({...evidence,
  datum: {across:"fixture-centreline" as const,out:"fixture-back" as const,up:"fixture-bottom" as const},
  handedness:"reversible" as const,
  outline:{...evidence,datum:{across:"fixture-centreline" as const,out:"footprint-centre" as const},shape:{start:{x:-.3,y:-.015},segments:[{to:{x:.3,y:-.015}},{to:{x:.2,y:.015},via:{x:.26,y:.001}},{to:{x:-.3,y:.015}}]}},
  fixings:[{id:"bracket",label:"Synthetic bracket",x:.2,y:0,z:.6,...evidence}],
  services:[{id:"power",label:"Synthetic power",service:"power" as const,x:.1,y:-.01,z:.2,...evidence}],
  clearances:[{id:"lift",label:"Synthetic removal access",direction:"above" as const,distance:.05,...evidence}],
});
function setup(){
  const fields={...fittingCases[5].fields,...powered};
  const id=products.request("mirror",{brand:"Synthetic"}).requestId as string;
  const submission={manufacturer:"Synthetic",model:"Arc mirror",fields,installationGeometry:geometry()};
  const submitted=products.submit(id,submission);expect(submitted.ok,submitted.summary).toBe(true);
  for(const key of Object.keys(fields))products.review(id,key,"accepted");
  expect(products.accept(id).ok).toBe(false); // geometry also requires a human review
  products.review(id,"installationGeometry","accepted");expect(products.accept(id).ok).toBe(true);
  const room=actions.addRoom(0,0,3,3,"Synthetic room","tile").id as string;
  actions.setRoomFloor(room,{substrateTop:q(-.05),layers:[{kind:"tile",thickness:q(.01)}]});
  const wall=actions.addWall(0,0,3,0,.1,2.4).id as string;
  actions.setWallSide(wall,"right",{existing:q(0),frame:q(0),layers:[{kind:"tile",thickness:q(.01)}]});
  const r=actions.placeProduct(productStore.getState().products[0],{wallId:wall,side:"right",face:"finished",distance:1,status:"proposed",installation:{mounting:"wall",roomId:room,floorDatum:"finished-floor",height:q(.9),mirror:false,orientation:0}});
  expect(r.ok).toBe(true);return store.getState().model.items[0];
}
beforeEach(()=>{store.setState({model:emptyModel(),kinds:[],undoStack:[]});productStore.setState({requests:[],products:[]});});
it("requires human reviewed sourced geometry and derives wall height, fixing/service levels and 3D from the canonical item",()=>{
  const item=setup(),model=store.getState().model;
  expect(installationReading(model,item)).toMatchObject({resolved:true,bottom:.86,top:1.66,basis:"proposed"});
  const fixing=localPointReading(model,item,item.installationGeometry!.fixings![0]);
  expect(fixing).toMatchObject({x:1.2,y:.01,level:1.46,basis:"proposed"});
  // Source outline y=-depth/2 is the physical back; point y=0 is measured from that back.
  expect(Math.min(...itemPolygon(item)!.map(p=>p.y))).toBeCloseTo(fixing.y!,4);
  expect(item.installationGeometry!.outline!.datum.out).toBe("footprint-centre");
  expect(roughIn(model,item).find(p=>p.pointId==="local:power")).toMatchObject({x:1.1,y:0,up:1.1,level:1.06,status:"proposed"});
  const mesh=buildFixture(model,item)!; const box=new THREE.Box3().setFromObject(mesh);
  expect(box.min.y).toBeCloseTo(.86,4);expect(box.max.y).toBeCloseTo(1.66,4);
  const el=catalogue(model).elements.find(e=>e.type==="fixture")!;
  expect(specRows(model,el)).toEqual(expect.arrayContaining([expect.objectContaining({property:"installed bottom level (mm)",value:"860",status:"proposed"})]));
});
it("mirrors and rotates outline, fixings, services and access requirements together while source coordinates survive",()=>{
  const item=setup(); const original=structuredClone(item.installationGeometry);
  expect(actions.setFixtureInstallation(item.id,{...item.installation!,mirror:true,orientation:90}).ok).toBe(true);
  const it=store.getState().model.items[0],model=store.getState().model;
  expect(it.installationGeometry).toEqual(original);
  const pose=anchorPose(model,it);expect(pose.rotation).toBe(90);
  const point=localPointReading(model,it,it.installationGeometry!.fixings![0]);
  const expected=toWorld([{x:-.2,y:-.015}],it)[0];
  expect(point.x).toBeCloseTo(expected.x,4);expect(point.y).toBeCloseTo(expected.y,4);
  expect(itemPolygon(it)).toEqual(toWorld(kindPolygon({w:.6,d:.03,outline:original!.outline!.shape}).map(p=>({...p,x:-p.x})),it));
  const el=catalogue(model).elements.find(e=>e.type==="fixture")!;
  expect(renderStageDiagram(model,[el],{label:"Synthetic",findings:[]})).toContain("polygon");
});
it("withholds vertical geometry and point levels when a floor or wall datum is unresolved",()=>{
  const it=setup();actions.setRoomFloor(it.installation!.roomId!,{substrateTop:{}});
  const model=store.getState().model;
  expect(installationReading(model,model.items[0]).bottom).toBeUndefined();
  expect(buildFixture(model,model.items[0])).toBeNull();
  expect(localPointReading(model,model.items[0],it.installationGeometry!.fixings![0]).level).toBeUndefined();
});
it("exports/imports the source geometry and explicit placement without its browser product library",()=>{
  setup();const s=store.getState();const parsed=parseImport(JSON.stringify({...demoProject(),id:"geometry",model:s.model,kinds:s.kinds}));
  expect(parsed.model.items[0]).toEqual(s.model.items[0]);
  const el=catalogue(parsed.model).elements.find(e=>e.type==="fixture")!;
  expect(specRows(parsed.model,el)).toEqual(expect.arrayContaining([expect.objectContaining({property:"fixing bracket",source:expect.stringContaining("synthetic-mirror.pdf")})]));
});
it("rejects unsourced geometry and preserves an explicit unsupported-shape envelope fallback",()=>{
  const cat=categoryById("mirror")!,fields=fittingCases[5].fields;
  expect(validateSubmission(cat,{manufacturer:"Synthetic",model:"Mirror",fields,installationGeometry:{...geometry(),outline:{...geometry().outline,sources:[]}}}).some(p=>p.severity==="error")).toBe(true);
  const g=geometry();delete (g.outline as {shape?:unknown}).shape;Object.assign(g.outline,{limitation:"Source uses an unsupported spline; no approximation supplied."});
  expect(validateSubmission(cat,{manufacturer:"Synthetic",model:"Mirror",fields,installationGeometry:g}).filter(p=>p.severity==="error")).toEqual([]);
});
it("uses vertical extents for physical clash checks and keeps access requirements separate",()=>{
  const item=setup();actions.defineItemKind({kind:"low_test",label:"Synthetic low fixture",w:.6,d:.03,h:.2});
  actions.placeItem("low_test",item.x,item.y);
  let model=store.getState().model;
  expect(checkModel(model).some(p=>p.code==="items_overlap")).toBe(false);
  const other=model.items[1];
  actions.defineItemKind({kind:"above_test",label:"Synthetic obstruction",w:.6,d:.03,h:.05});
  actions.placeItem("above_test",item.x,item.y);
  const above=store.getState().model.items[2];
  store.setState({model:{...store.getState().model,items:store.getState().model.items.map(i=>i.id===above.id?{...i,anchor:item.anchor,installation:{...item.installation!,height:q(1.7)}}:i)}});
  model=store.getState().model;
  expect(checkModel(model).some(p=>p.code==="fixture_access_obstructed" && p.refs.includes(above.id))).toBe(true);
  expect(checkModel(model).some(p=>p.code==="items_overlap" && p.refs.includes(item.id))).toBe(false);
  const region=clearanceRegions(model,model.items[0])[0];
  expect(region).toMatchObject({status:"published",placementBasis:"proposed",sources});
  expect(actions.placeItem(item.kind,1,1).ok).toBe(false);
  expect(other.installation).toBeUndefined();
});
it("refuses mirroring a documented fixed hand without changing source geometry or model",()=>{
  const it=setup();const model=store.getState().model;
  store.setState({model:{...model,items:[{...it,productIdentity:{manufacturer:"Synthetic",model:"Left",identity:{...identityOf(it.productIdentity??{}),handedness:{state:"known",value:"left",sources}}}}]}});
  const before=JSON.stringify(store.getState().model);
  expect(actions.setFixtureInstallation(it.id,{...it.installation!,mirror:true}).ok).toBe(false);
  expect(JSON.stringify(store.getState().model)).toBe(before);
});
it("translates accepted field-local service heights from explicit placement without inventing a finish-floor datum",()=>{
  const it=setup();const product=productStore.getState().products[0];
  const poweredProduct={...product,installationGeometry:undefined,roughIn:[{id:"power",label:"Synthetic field power",service:"power" as const,resolved:true,missing:[],across:{from:"fixture-centreline" as const,field:"powerOffset",value:.1},out:{from:"fixture-side" as const,field:"powerDepth",value:-.01},up:{from:"fixture-bottom" as const,field:"powerHeight",value:.2}}],fields:{...product.fields,powerOffset:pub(.1),powerDepth:pub(-.01),powerHeight:pub(.2)}};
  const r=actions.placeProduct(poweredProduct,{...it.anchor!,installation:{...it.installation!,floorDatum:"substrate-top",height:q(.5),mirror:false}});
  expect(r.ok).toBe(true);const next=store.getState().model.items.at(-1)!;
  const p=roughIn(store.getState().model,next)[0];
  expect(p).toMatchObject({pointId:"local:power",up:.69,level:.65,status:"proposed"});
  expect(next.installationGeometry!.services![0].axisEvidence!.up).toEqual(pub(.2));
  actions.setRoomFloor(it.installation!.roomId!,{layers:[{kind:"tile",thickness:{}}]});
  const unknown=roughIn(store.getState().model,store.getState().model.items.at(-1)!)[0];
  expect(unknown.level).toBe(.65);expect(unknown.up).toBeUndefined();
});
it("renders an installed envelope without decorative defaults that alter its dimensions",()=>{
  const it=setup();const product={...productStore.getState().products[0],installationGeometry:undefined};
  const placed=actions.placeProduct(product,{...it.anchor!,installation:it.installation});expect(placed.ok).toBe(true);
  const item=store.getState().model.items.at(-1)!;const mesh=buildFixture(store.getState().model,item)!;
  const box=new THREE.Box3().setFromObject(mesh);expect(box.min.y).toBeCloseTo(.86,4);expect(box.max.y).toBeCloseTo(1.66,4);
  expect(box.max.x-box.min.x).toBeCloseTo(.6,4);expect(box.max.z-box.min.z).toBeCloseTo(.03,4);
});

it("binds geometry approval to source evidence and envelope, with explicit reuse for unchanged revisions", () => {
  const fields={...fittingCases[5].fields,...powered};
  const id=products.request("mirror",{brand:"Synthetic"}).requestId as string;
  const submission={manufacturer:"Synthetic",model:"Arc mirror",fields,installationGeometry:geometry()};
  expect(products.submit(id,submission).ok).toBe(true);
  const req=()=>productStore.getState().requests[0];
  expect(requiredReviewKeys(req())).toContain("installationGeometry");
  for(const group of ["envelope","rough-in","installation"] as const)products.reviewGroup(id,group);
  expect(currentReview(req(),"installationGeometry")).toBeUndefined();
  for(const key of Object.keys(fields))products.review(id,key,"accepted");
  products.review(id,"installationGeometry","accepted");
  expect(products.returnToAgent(id,"Confirm unchanged evidence").ok).toBe(true);
  expect(products.submit(id,submission).ok).toBe(true);
  expect(currentReview(req(),"installationGeometry")).toBeUndefined();
  expect(req().reuseCandidates?.installationGeometry).toBeDefined();
  expect(products.accept(id).ok).toBe(false);
  expect(products.reuseReviews(id).ok).toBe(true);
  expect(currentReview(req(),"installationGeometry")?.method).toBe("reused");
  expect(products.returnToAgent(id,"Correct source locator").ok).toBe(true);
  const changed=structuredClone(submission);changed.installationGeometry.fixings[0].sources=[{...sources[0],locator:"p. 3 corrected fixing diagram"}];
  expect(products.submit(id,changed).ok).toBe(true);
  expect(req().reuseCandidates?.installationGeometry).toBeUndefined();
  products.reuseReviews(id);
  expect(products.accept(id).ok).toBe(false);
  expect(products.review(id,"installationGeometry","accepted").ok).toBe(true);
  // Even a changed pending record with an old review fingerprint cannot bypass acceptance.
  const stale=structuredClone(req());stale.submission!.fields.height=pub(.81);
  productStore.setState({requests:[stale]});
  expect(currentReview(req(),"installationGeometry")).toBeUndefined();
  expect(products.accept(id).ok).toBe(false);
});

it("refuses mirroring fixed, conflicting and unknown hand evidence on placement and later edits",()=>{
  const it=setup(),accepted=productStore.getState().products[0];
  for(const [identityHand,shapeHand,alternatives] of [["left","reversible",undefined],["reversible","right",undefined],["reversible","reversible",[{value:"left",source:sources[0]}]],[null,"unknown",undefined]] as const){
    const hand={state:identityHand?"known" as const:"unknown" as const,value:identityHand,sources,...(alternatives?{alternatives:[...alternatives]}:{})};
    const identity={...identityOf(accepted),handedness:hand};
    const installationGeometry={...geometry(),handedness:shapeHand};
    const product={...accepted,identity,installationGeometry};
    const before=JSON.stringify(store.getState().model);
    expect(actions.placeProduct(product,{...it.anchor!,installation:{...it.installation!,mirror:true}}).ok).toBe(false);
    expect(JSON.stringify(store.getState().model)).toBe(before);
    const model=store.getState().model;store.setState({model:{...model,items:[{...it,installationGeometry,productIdentity:{...it.productIdentity!,identity}}]}});
    const editedBefore=JSON.stringify(store.getState().model);
    expect(actions.setFixtureInstallation(it.id,{...it.installation!,mirror:true}).ok).toBe(false);
    expect(JSON.stringify(store.getState().model)).toBe(editedBefore);
  }
  const conflict={manufacturer:"Synthetic",model:"Right",identity:{...identityOf(accepted),handedness:{state:"known" as const,value:"right",sources}},fields:accepted.fields,installationGeometry:geometry()};
  expect(validateSubmission(categoryById("mirror")!,conflict)).toEqual(expect.arrayContaining([expect.objectContaining({code:"geometry_hand_conflict",severity:"warning"})]));
});

it("binds geometry review to category-specific envelope fields, including bath length",()=>{
  setup();const original=structuredClone(productStore.getState().requests[0]);
  original.status="submitted";original.category="bath";original.submission!.fields.length=pub(1.7);
  const evidence=reviewEvidence(original,"installationGeometry");
  original.submission!.fields.length=pub(1.8);
  expect(reviewEvidence(original,"installationGeometry")).not.toBe(evidence);
});

it("keeps confirmed bottom placement separate from published top height after portable export",()=>{
  const item=setup();const confirmed=(value:number)=>({value,status:"site-confirmed" as const,source:"Synthetic confirmation of project placement only"});
  actions.setRoomFloor(item.installation!.roomId!,{substrateTop:confirmed(0),layers:[]});
  actions.setWallSide(item.anchor!.wallId,"right",{existing:confirmed(0),frame:confirmed(0),layers:[]});
  actions.anchorFixture(item.id,{...item.anchor!,face:"existing",status:"site-confirmed"});
  actions.setFixtureInstallation(item.id,{...item.installation!,height:confirmed(.9)});
  const model=store.getState().model,it=model.items[0];
  const lv=installationReading(model,it);
  expect(lv).toMatchObject({bottom:.9,top:1.7,basis:"site-confirmed",topBasis:"published",heightEvidence:pub(.8)});
  const top=specRows(model,catalogue(model).elements.find(e=>e.type==="fixture")!).find(r=>r.property==="installed top level (mm)")!;
  expect(top.status).toBe("published");expect(top.source).toContain("example.com");
  const above=clearanceRegions(model,it)[0];expect(above.placementBasis).toBe("published");expect(above.placementSource).toContain("example.com");
  const parsed=parseImport(JSON.stringify({...demoProject(),id:"confirmed-placement",model,kinds:store.getState().kinds}));
  expect(installationReading(parsed.model,parsed.model.items[0])).toMatchObject({topBasis:"published",heightEvidence:pub(.8)});
  productStore.setState({products:[],requests:[]});
  expect(installationReading(parsed.model,parsed.model.items[0]).topBasis).toBe("published");
  expect(installationReading(parsed.model,{...parsed.model.items[0],productSpecification:undefined}).topBasis).toBe("unknown");
});
it("keeps the named physical back midpoint at the declared wall-face gap and along-wall distance through yaw",()=>{
  const it=setup();actions.setFixtureInstallation(it.id,{...it.installation!,mirror:true,orientation:90});
  const model=store.getState().model,item=model.items[0];
  const origin=localPointReading(model,item,{id:"back",label:"Physical back midpoint",x:0,y:0,z:0,...evidence});
  expect(origin).toMatchObject({x:1,y:.01});
  expect(anchorPose(model,item)).toMatchObject({backOffset:.01,alongFromA:1});
  expect(checkModel(model)).toEqual(expect.arrayContaining([expect.objectContaining({code:"item_through_wall",refs:expect.arrayContaining([it.id])})]));
  expect(installationReading(model,item).limitations).toEqual(expect.arrayContaining([expect.stringMatching(/physical back/i)]));
});
