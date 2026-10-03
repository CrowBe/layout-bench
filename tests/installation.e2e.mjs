/** Explicitly synthetic #51 evidence: real human review, canonical placement/edit, 3D OBJ,
 * source geometry transforms, stage exports, persistence and project roundtrip. */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { readFile, mkdir } from "node:fs/promises";
import { fittingCases, powered } from "./bathroom-products-fixtures.mjs";
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1100}}), errors=[];
page.on('pageerror',e=>errors.push(String(e)));
const q=value=>({value,status:'proposed',source:'Explicitly synthetic project set-out'});
const sources=[{url:'https://example.com/synthetic-mirror.pdf',locator:'p. 2 synthetic outline/fixing diagram'}];
const evidence={status:'published',sources};
const geometry={...evidence,datum:{across:'fixture-centreline',out:'fixture-back',up:'fixture-bottom'},handedness:'reversible',
 outline:{...evidence,datum:{across:'fixture-centreline',out:'footprint-centre'},shape:{start:{x:-.3,y:-.015},segments:[{to:{x:.3,y:-.015}},{to:{x:.2,y:.015},via:{x:.26,y:.001}},{to:{x:-.3,y:.015}}]}},
 fixings:[{id:'bracket',label:'Synthetic fixing',x:.2,y:0,z:.6,...evidence}],
 services:[{id:'power',label:'Synthetic service entry',service:'power',x:.1,y:-.01,z:.2,...evidence}],
 clearances:[{id:'lift',label:'Synthetic removal access',direction:'above',distance:.05,...evidence}]};
try {
 await page.goto(process.env.ALZA_BASE_URL??'http://127.0.0.1:5251/');
 await page.getByLabel('New project name').fill('Synthetic installation #51');
 await page.getByRole('button',{name:'Create blank'}).click();
 const run=(name,args={})=>page.evaluate(([name,args])=>window.__alza.runTool(name,args),[name,args]);
 const req=await run('request_product',{category:'mirror',brand:'Synthetic',model:'Arc mirror'});
 assert.equal(req.ok,true);
 const submitted=await run('submit_product_spec',{requestId:req.requestId,manufacturer:'Synthetic',model:'Arc mirror',fields:{...fittingCases[5].fields,...powered},installationGeometry:geometry});
 assert.equal(submitted.ok,true,submitted.summary);
 await page.getByRole('button',{name:/^Products/}).click();
 const detail=page.getByRole('region',{name:'Selected request'});
 const rows=detail.locator('tr[data-field]');
 for(let i=0;i<await rows.count();i++)await rows.nth(i).getByRole('button',{name:'Accept',exact:true}).click();
 await detail.getByRole('button',{name:'Accept product',exact:true}).click();
 assert.match(await detail.textContent(),/installationGeometry/);
 await detail.getByRole('button',{name:'Accept installation geometry',exact:true}).click();
 // A changed source invalidates the geometry approval; group/reused field reviews cannot bypass it.
 await detail.getByLabel('Feedback for the agent').fill('Correct synthetic fixing source locator');
 await detail.getByRole('button',{name:'Return to agent',exact:true}).click();
 geometry.fixings[0].sources=[{...sources[0],locator:'p. 3 corrected synthetic fixing diagram'}];
 assert.equal((await run('submit_product_spec',{requestId:req.requestId,manufacturer:'Synthetic',model:'Arc mirror',fields:{...fittingCases[5].fields,...powered},installationGeometry:geometry})).ok,true);
 await detail.locator('summary').filter({hasText:'unchanged accepted reviews available'}).click();
 await detail.getByRole('button',{name:/Reuse .* unchanged accepted reviews/}).click();
 await detail.getByRole('button',{name:'Accept product',exact:true}).click();
 assert.match(await detail.textContent(),/installationGeometry/);
 await detail.getByRole('button',{name:'Accept installation geometry',exact:true}).click();
 await detail.getByRole('button',{name:'Accept product',exact:true}).click();
 assert.match(await detail.textContent(),/status accepted/);
 await page.getByRole('button',{name:'Back to plan',exact:true}).click();
 const product=(await run('get_product_library')).products[0];
 assert.deepEqual(product.installationGeometry,geometry);
 const room=await run('add_room',{x:0,y:0,w:3,h:3,label:'Synthetic room',floor:'tile'});
 await run('set_room_floor',{room:room.id,substrateTop:q(-.05),layers:[{kind:'tile',thickness:q(.01)}]});
 const wall=await run('add_wall',{ax:0,ay:0,bx:3,by:0,thickness:.1,height:2.4});
 await run('set_wall_side',{wallId:wall.id,side:'right',existing:q(0),frame:q(0),layers:[{kind:'tile',thickness:q(.01)}]});
 const placement={mounting:'wall',roomId:room.id,floorDatum:'finished-floor',height:q(.9),mirror:false,orientation:0};
 const item=await run('place_product',{productId:product.id,wallId:wall.id,side:'right',face:'finished',distance:1,status:'proposed',installation:placement});
 assert.equal(item.ok,true,item.summary);
 await page.evaluate(id=>window.__alza.actions.selectItem(id),item.id);
 const panel=page.getByRole('region',{name:'Fixture installation'});
 await panel.getByLabel('Installation bottom height (mm)').fill('1000');
 await panel.getByLabel('Installation placement source').fill('Synthetic human proposal, not a manufacturer requirement');
 await panel.getByRole('button',{name:'Update installation placement'}).click();
 let read=(await run('get_rough_in',{itemId:item.id})).fixtures[0];
 assert.equal(read.installedLevels.bottom,.96);assert.equal(read.installedLevels.top,1.76);assert.equal(read.installedLevels.basis,'proposed');
 assert.equal(read.fixings[0].level,1.56);assert.equal(read.servicePoints.find(p=>p.pointId==='local:power').level,1.16);
 assert.equal(await page.locator(`[data-id="${item.id}"] [data-outline]`).count(),1);
 // Confirmed project placement does not promote the sourced product height to confirmed.
 const confirmed=value=>({value,status:'site-confirmed',source:'Synthetic confirmation of project placement only'});
 await run('set_room_floor',{room:room.id,substrateTop:confirmed(0),layers:[]});
 await run('set_wall_side',{wallId:wall.id,side:'right',existing:confirmed(0),frame:confirmed(0),layers:[]});
 await run('anchor_fixture',{itemId:item.id,wallId:wall.id,side:'right',face:'existing',distance:1,status:'site-confirmed'});
 await run('set_fixture_installation',{itemId:item.id,installation:{...placement,height:confirmed(1)}});
 read=(await run('get_rough_in',{itemId:item.id})).fixtures[0];
 assert.equal(read.installedLevels.bottom,1);assert.equal(read.installedLevels.top,1.8);
 assert.equal(read.installedLevels.basis,'site-confirmed');assert.equal(read.installedLevels.topBasis,'published');
 assert.deepEqual(read.installedLevels.heightEvidence,fittingCases[5].fields.height);
 assert.match(read.installedLevels.topSource,/synthetic-fitting.pdf/);
 assert.equal(read.accessRequirements[0].placementBasis,'published');assert.match(read.accessRequirements[0].placementSource,/synthetic-fitting.pdf/);
 assert.match(await page.getByRole('region',{name:'Fixture installation'}).textContent(),/top 1800 mm \(published\)/);
 await run('set_room_floor',{room:room.id,substrateTop:q(-.05),layers:[{kind:'tile',thickness:q(.01)}]});
 await run('set_wall_side',{wallId:wall.id,side:'right',existing:q(0),frame:q(0),layers:[{kind:'tile',thickness:q(.01)}]});
 await run('anchor_fixture',{itemId:item.id,wallId:wall.id,side:'right',face:'finished',distance:1,status:'proposed'});
 await run('set_fixture_installation',{itemId:item.id,installation:{...placement,height:q(1)}});

 await panel.getByLabel('Mirror installation').check();
 await panel.getByLabel('Installation orientation (degrees)').fill('90');
 await panel.getByRole('button',{name:'Update installation placement'}).click();
 read=(await run('get_rough_in',{itemId:item.id})).fixtures[0];
 assert.equal(read.position.rotation,90);assert.deepEqual(read.installationGeometry,geometry);
 assert.equal(read.fixings[0].x,1);assert.equal(read.fixings[0].y,.21);
 assert.match(await panel.textContent(),/Physical back midpoint/);
 assert.ok((await run('get_issues')).issues.some(i=>i.code==='item_through_wall')); 
 assert.equal(read.accessRequirements[0].status,'published');assert.equal(read.accessRequirements[0].placementBasis,'proposed');
 await run('set_sheet_info',{project:'Synthetic #51',site:'Test only',preparedBy:'Synthetic reviewer'});
 await run('set_diagram_view',{label:'Synthetic mounted fitting',visible:['fixtures','services-power']});
 let exported=await run('export_diagram_view',{includeOutputs:true});
 assert.equal(exported.ok,false);assert.ok(exported.open.length>0 && exported.open.every(f=>f.code==='geometry:item_through_wall'));
 const acknowledge=exported.open.map(f=>({code:f.code,ref:f.ref,reason:'Synthetic yaw demonstration intersects wall; unsupported mounting is retained for geometry verification only.'}));
 exported=await run('export_diagram_view',{includeOutputs:true,acknowledge});assert.equal(exported.ok,true,exported.summary);
 assert.match(exported.svg,/data-fixing="bracket"/);assert.match(exported.svg,/data-access="lift"/);assert.match(exported.specHtml,/960/);assert.match(exported.specHtml,/synthetic-mirror.pdf/);
 // Actual rendered 3D export contains the same absolute levels and transformed fixing.
 await page.getByRole('button',{name:'Build 3D ▲',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export OBJ',exact:true}).click();
 const obj=await readFile(await (await downloadPromise).path(),'utf8');
 const verticesFor=name=>{const chunks=obj.split(/^o /m);return chunks.filter(c=>c.split('\n')[0]===name).flatMap(c=>c.split('\n').filter(l=>l.startsWith('v ')).map(l=>l.split(' ').slice(1).map(Number)));};
 const body=verticesFor(item.id);assert.ok(body.length>20);
 assert.ok(Math.abs(Math.min(...body.map(v=>v[1]))-.96)<.001);assert.ok(Math.abs(Math.max(...body.map(v=>v[1]))-1.76)<.001);
 const fixing=verticesFor(`${item.id}:fixing:bracket`);assert.ok(fixing.length>0);assert.ok(fixing.some(v=>Math.abs(v[0]-1)<.008 && Math.abs(v[1]-1.56)<.008 && Math.abs(v[2]-.21)<.008));
 await mkdir('/tmp/layout-bench-51-evidence',{recursive:true});await page.screenshot({path:'/tmp/layout-bench-51-evidence/mounted-3d.png'});
 await page.getByRole('button',{name:'Back to 2D',exact:true}).click();
 const before=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__alza.store.getState().model.items[0])));
 await page.reload();await page.locator('.project-card').filter({hasText:'Synthetic installation #51'}).getByRole('button',{name:'Open',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.__alza.store.getState().model.items[0]),before);
 // Genuine JSON backup and import into a browser with no accepted product library.
 await page.getByRole('button',{name:'Projects',exact:true}).click();
 const jsonDownload=page.waitForEvent('download');
 await page.locator('.project-card').filter({hasText:'Synthetic installation #51'}).getByRole('button',{name:'Export JSON',exact:true}).click();
 const jsonFile=await (await jsonDownload).path();
 const fresh=await browser.newContext();const imported=await fresh.newPage();await imported.goto(process.env.ALZA_BASE_URL??'http://127.0.0.1:5251/');
 await imported.getByLabel('Import project JSON').setInputFiles({name:'synthetic-installation.json',mimeType:'application/json',buffer:await readFile(jsonFile)});
 await imported.getByLabel('Name for imported copy').fill('Portable installation #51');
 await imported.getByRole('button',{name:'Import as new project',exact:true}).click();
 assert.equal(await imported.locator('.brand-plan').textContent(),'Portable installation #51');
 const importedRead=await imported.evaluate(id=>window.__alza.runTool('get_rough_in',{itemId:id}),item.id);assert.deepEqual(importedRead.fixtures[0].installationGeometry,geometry);assert.equal(importedRead.fixtures[0].fixings[0].level,1.56);assert.deepEqual(importedRead.fixtures[0].installedLevels.heightEvidence,fittingCases[5].fields.height);
 assert.equal(await imported.evaluate(()=>JSON.parse(localStorage.getItem('alza.products.v1')??'{"products":[]}').products.length),0);
 await page.locator('.project-card').filter({hasText:'Synthetic installation #51'}).getByRole('button',{name:'Open',exact:true}).click();
 await fresh.close();
 // With no resolved floor, product/local heights stay in evidence but actual level is unknown.
 await run('set_room_floor',{room:room.id,substrateTop:{}});
 read=(await run('get_rough_in',{itemId:item.id})).fixtures[0];assert.equal(read.installedLevels.bottom,undefined);assert.equal(read.fixings[0].level,undefined);
 await page.evaluate(id=>window.__alza.actions.selectItem(id),item.id);
 assert.match(await page.getByRole('region',{name:'Fixture installation'}).textContent(),/Installation unresolved/);
 await run('set_diagram_view',{label:'Unknown datum',visible:['fixtures','services-power']});exported=await run('export_diagram_view',{includeOutputs:true,acknowledge});assert.equal(exported.ok,true,exported.summary);assert.match(exported.svg,/INSTALLATION LEVEL \?/);assert.match(exported.specHtml,/substrate top/);
 assert.deepEqual(errors,[]);console.log('PASS: sourced arc geometry human review → proposed wall height/transform → consistent fixing/service/access evidence → genuine 3D OBJ/stage output → reload/portable project → unknown floor datum');
}finally{await browser.close();}
