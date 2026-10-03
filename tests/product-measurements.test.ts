import { beforeEach, describe, expect, it } from 'vitest';
import { categoryById, roughInPoints, validateSubmission, type FieldValue } from '../src/model/products';
import { measurementFields, unknownMeasurementFields, validateMeasurementFields, withObservation, workingObservation, isProductSpecification } from '../src/model/productMeasurements';
import { products, productStore, configureProductStorage, initializeProductLibrary, PRODUCTS_KEY } from '../src/model/productLibrary';
import { actions, store } from '../src/model/store';
import { emptyModel, type ValueStatus } from '../src/model/types';
import { roughIn } from '../src/model/fixtures';
import { parseImport } from '../src/model/projects';
import { catalogue, specRows } from '../src/sheets/stageView';
import { buildPlan } from '../src/three/build';
const cat = categoryById('vanity')!;
const human = (value: number|string, reference?: FieldValue['reference'], status: ValueStatus = 'measured'): FieldValue => ({value,status,...(reference?{reference}:{}),measurement:{unit:typeof value==='string'?'choice':'metres',date:null,dateNote:'Original survey date was not recorded',evidence:'Recorded fitting note: existing vanity footprint; other inputs are synthetic test evidence',recordedBy:'human'}});
const footprint = ():Record<string,FieldValue> => ({...unknownMeasurementFields(cat), width:human(.910,'fixture-end'),depth:human(.465,'fixture-side')});
const accept = (fields:Record<string,FieldValue>) => {
 const id = products.openMeasurements('vanity',{label:'Existing vanity',notes:'Physical item identified by original fitting note; brand and model unknown'},fields).requestId as string;
 expect(products.submitMeasurements(id)).toMatchObject({ok:true});
 expect(products.accept(id)).toMatchObject({ok:false});
 for(const key of Object.keys(fields)) expect(products.review(id,key,'accepted')).toMatchObject({ok:true});
 expect(products.accept(id)).toMatchObject({ok:true});
 return productStore.getState().products.at(-1)!;
};
const wall = () => {const id=actions.addWall(0,0,3,0,.1,2.4).id as string;actions.setWallSide(id,'right',{existing:{value:0,status:'measured'},frame:{value:0,status:"measured"},layers:[{kind:"tile",thickness:{value:0,status:"measured"}}]});return {wallId:id,side:'right' as const,face:'existing' as const,distance:.8,status:'proposed' as const};};
beforeEach(()=>{productStore.setState({requests:[],products:[],loadError:null});store.setState({model:emptyModel(),kinds:[],undoStack:[]});});
describe('explicit reused fitting evidence (#48)',()=>{
 it('accepts only the recorded 910×465 footprint, keeps height/services unknown and refuses placement atomically',()=>{
  const p=accept(footprint()); expect(p.manufacturer).toBe('');expect(p.model).toBe('');expect(p.fields.height.value).toBeNull();
  const anchor=wall(), before=structuredClone(store.getState().model);
  expect(actions.placeProduct(p,anchor)).toMatchObject({ok:false});expect(store.getState().model).toEqual(before);
  expect(p.roughIn.every(point=>!point.resolved)).toBe(true);
 });
 it('requires a physical label without manufacturing brand/model, and isolates human entry from agent submission',()=>{
  expect(products.openMeasurements('vanity',{label:''})).toMatchObject({ok:false});expect(products.openMeasurements('mirror',{label:'Mirror'})).toMatchObject({ok:false});
  const id=products.openMeasurements('vanity',{label:'Physical vanity'}).requestId as string;
  expect(products.submit(id,{manufacturer:'',model:'',fields:footprint()})).toMatchObject({ok:false});
  expect(validateSubmission(cat,{manufacturer:'Synthetic',model:'Synthetic',fields:footprint()}).some(p=>p.code==='human_evidence_only')).toBe(true);
 });
 it.each(['status','reference','measurement'] as const)('refuses missing %s without changing prior evidence',key=>{
  const id=products.openMeasurements('vanity',{label:'Physical vanity'},footprint()).requestId as string;
  const before=structuredClone(productStore.getState().requests[0]);const value=human(.9,'fixture-end');delete value[key];
  expect(products.recordMeasurement(id,'width',value).ok).toBe(false);expect(productStore.getState().requests[0]).toEqual(before);
 });
 it.each(['unit','date','evidence'] as const)('refuses invalid explicit human %s',key=>{
  const fields=footprint(); if(key==='unit') fields.width.measurement!.unit='count';if(key==='date') fields.width.measurement!.date='2026-02-30';if(key==='evidence') fields.width.measurement!.evidence='';
  expect(validateMeasurementFields(cat,fields).some(p=>p.code==='measurement_provenance'&&p.field==='width')).toBe(true);
 });
 it('keeps measured and published observations separate when choosing the working evidence, including unknowns',()=>{
  const current=withObservation({value:null,note:'Awaiting survey'},human(.910,'fixture-end'));
  const conflicting=withObservation(current,{value:.900,status:'published',reference:'fixture-end',sources:[{url:'https://example.com/synthetic.pdf',locator:'p. 2'}]});
  const chosen=workingObservation(conflicting,1);expect(chosen.value).toBe(.910);expect(chosen.observations).toHaveLength(3);expect(chosen.observations![2].status).toBe('published');
  expect(validateMeasurementFields(cat,{...footprint(),width:chosen}).some(p=>p.code==='evidence_disagreement')).toBe(true);
  const unknown=workingObservation(chosen,0);expect(unknown.value).toBeNull();expect(unknown.observations).toHaveLength(3);
 });
 it('keeps prior evidence even when a working change omits its history',()=>{
  const id=products.openMeasurements('vanity',{label:'Physical vanity'},footprint()).requestId as string;
  expect(products.recordMeasurement(id,'width',human(.92,'fixture-end','estimated')).ok).toBe(true);
  const value=productStore.getState().requests[0].measurementDraft!.width;expect(value.observations?.map(v=>v.value)).toEqual([.910,.92]);
 });
 it('does not turn a published template zero into human evidence',()=>{
  expect(measurementFields(cat).some(f=>f.key==='service.waste.out')).toBe(true);
  const point=roughInPoints(cat,footprint(),true).find(p=>p.id==='waste')!;expect(point.out?.value).toBeUndefined();expect(point.missing).toContain('service.waste.out');
 });
 it.each(['finished-floor','fixture-bottom'] as const)('preserves per-axis status and %s height through placement, 3D and project import without a library',datum=>{
  const fields=footprint();fields.height=human(.840,'fixture-bottom','proposed'); // Synthetic, not a recorded real vanity height.
  fields.wasteOffset=human(.12,'fixture-centreline');fields['service.waste.out']=human(0,'finished-wall','proposed');fields.wasteHeight=human(.55,datum,'site-confirmed');
  fields.width=workingObservation(withObservation(withObservation(fields.width,{value:.9,status:'published',reference:'fixture-end',sources:[{url:'https://example.com/synthetic.pdf',locator:'p. 2'}]}),fields.width),0);
  const p=accept(fields);expect(actions.placeProduct(p,wall()).ok).toBe(true);
  const model=store.getState().model,item=model.items[0],sp=item.servicePoints![0];
  expect(sp.status).toBe('proposed');expect(sp.axisEvidence).toMatchObject({across:{status:'measured'},out:{status:'proposed'},up:{status:'site-confirmed',reference:datum}});
  expect(sp.up).toBe(datum==='finished-floor'?.55:undefined);expect(roughIn(model,item)[0].axisEvidence).toEqual(sp.axisEvidence);
  const built=buildPlan(model,'planning'),marker=built.group.getObjectByName(`${item.id}:service:${sp.id}`);
  expect(!!marker).toBe(datum==='finished-floor');if(marker) expect(marker.userData.provenance.axisEvidence).toEqual(sp.axisEvidence);
  const imported=parseImport(JSON.stringify({version:2,id:'transfer',model,kinds:store.getState().kinds,notes:[],presentation:'planning'}));expect(imported.model.items[0].productSpecification).toEqual(item.productSpecification);
  const rows=specRows(imported.model,{id:`fixture:${item.id}`,layer:"fixtures",type:"fixture",ref:item.id,label:"Vanity"});
  expect(rows.some(r=>r.missing?.includes("product not in this browser's library"))).toBe(true);
  expect(rows.some(r=>r.property==='width'&&r.status==='measured'&&r.source?.includes('Original survey date'))).toBe(true);
  expect(rows.some(r=>r.property.includes('observation')&&r.status==='published')).toBe(true);
 });
 it('keeps readable provenance across library reload and refuses malformed metadata without overwriting raw storage',()=>{
  const p=accept(footprint());const saved=JSON.stringify({version:1,requests:productStore.getState().requests,products:[p]});const data=new Map([[PRODUCTS_KEY,saved]]);
  const prev=configureProductStorage({local:()=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}})});
  try {initializeProductLibrary(true);expect(productStore.getState().products[0].fields).toEqual(p.fields);
   const bad=JSON.parse(saved);bad.products[0].fields.width.measurement.dateNote=42;const raw=JSON.stringify(bad);data.set(PRODUCTS_KEY,raw);initializeProductLibrary(true);expect(productStore.getState().loadError).toMatch(/Invalid product measurement/);products.openMeasurements('bath',{label:'Recovery'});expect(data.get(PRODUCTS_KEY)).toBe(raw);
  }finally{configureProductStorage(prev);}
 });
 it('handles malformed observations and alternatives without throwing',()=>{
  const fields=footprint();fields.width={...fields.width,observations:[null] as never,alternatives:{} as never};
  expect(()=>validateMeasurementFields(cat,fields)).not.toThrow();expect(validateMeasurementFields(cat,fields).some(p=>p.severity==='error')).toBe(true);
  expect(isProductSpecification({category:'vanity',fields,acceptedAt:0})).toBe(false);
 });
});
