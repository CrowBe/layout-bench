/** Manual file transfer with a separate, reviewable human import commit. */
import {useState} from 'react';
import {products,useProductStore} from '../model/productLibrary';
import {MAX_BUNDLE_BYTES,type BundlePreview,type CatalogueBundle} from '../model/productBundles';
import {exactProductLabel} from '../model/productIdentity';
import {logActivity} from '../model/store';
export function ProductBundles(){
 const requests=useProductStore(s=>s.requests),library=useProductStore(s=>s.products);
 const [selectedRequests,setRequests]=useState<string[]>([]),[selectedProducts,setProducts]=useState<string[]>([]),[preview,setPreview]=useState<BundlePreview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const toggle=(ids:string[],id:string)=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];
 const exportSelected=async()=>{setBusy(true);setError('');setMessage('');try{const result=await products.exportBundle({requestIds:selectedRequests,productIds:selectedProducts});logActivity('human','export_catalogue_bundle',result.summary,result.ok);if(!result.ok){setError(result.summary);return;}const bundle=result.bundle as CatalogueBundle,url=URL.createObjectURL(new Blob([JSON.stringify(bundle)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`reno-catalogue-${bundle.bundleId.slice(0,12)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage(result.summary);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const importPreview=async()=>{if(!preview)return;setBusy(true);setError('');try{const result=await products.importBundle(preview);logActivity('human','import_catalogue_bundle',result.summary,result.ok);if(result.ok){setMessage(result.summary);setPreview(null);}else setError(result.summary);}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <section className="products-card" aria-label="Portable catalogue">
  <strong>Transfer catalogue evidence</strong>
  <p className="hint">Manual transfer between browsers. A bundle contains selected products, dependent request/review history, and original PDF/image bytes. Project JSON remains separate. No purchasing or project selection is inferred.</p>
  <details><summary>Select products and pending requests</summary>
   {library.map(p=><label className="field" key={p.id}><input type="checkbox" aria-label={`Export product ${exactProductLabel(p)}`} checked={selectedProducts.includes(p.id)} onChange={()=>setProducts(toggle(selectedProducts,p.id))}/>{exactProductLabel(p)}</label>)}
   {requests.filter(r=>r.status==='open'||r.status==='submitted').map(r=><label className="field" key={r.id}><input type="checkbox" aria-label={`Export request ${r.id}`} checked={selectedRequests.includes(r.id)} onChange={()=>setRequests(toggle(selectedRequests,r.id))}/>{r.known.physicalItem?.label||[r.known.brand,r.known.model].filter(Boolean).join(' ')||r.id} · {r.status} · {r.id}</label>)}
  </details>
  <button type="button" disabled={busy||!selectedProducts.length&&!selectedRequests.length} onClick={()=>void exportSelected()}>Export selected catalogue bundle</button>
  <label className="field">Preview catalogue bundle<input type="file" accept="application/json,.json" disabled={busy} onChange={async event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file)return;setPreview(null);setMessage('');setError('');if(file.size>MAX_BUNDLE_BYTES){setError('Catalogue bundle exceeds 80 MB.');return;}setBusy(true);try{const result=await products.previewBundle(await file.text());logActivity('human','preview_catalogue_bundle',result.summary,result.ok);if(result.ok){setPreview(result.preview as BundlePreview);setMessage(result.summary);}else setError(result.summary);}catch(e){setError(String(e));}finally{setBusy(false);}}}/></label>
  {preview&&<section aria-label="Catalogue import preview">
   <strong>Review before importing</strong><p>{preview.bundle.products.length} accepted products · {preview.bundle.requests.length} requests · {preview.bundle.files.length} original files with validated SHA-256 bytes</p>
   <p>{preview.additions.products.length} product additions · {preview.additions.requests.length} request additions · {preview.files.length} file additions</p>
   {preview.warnings.map((warning,i)=><p className="inspector-warn" key={i}>{warning}</p>)}
   <ul>{preview.bundle.products.map(p=><li key={p.id}>{exactProductLabel(p)} · {p.category} · accepted evidence</li>)}{preview.bundle.requests.map(r=><li key={r.id}>{r.id} · {r.category} · {r.status}</li>)}</ul>
   {!!preview.collisions.length&&<table className="products-table" aria-label="Catalogue ID collisions"><thead><tr><th>Existing ID</th><th>Type</th><th>Proposed new ID</th></tr></thead><tbody>{preview.collisions.map(c=><tr key={`${c.type}:${c.id}`}><td>{c.id}</td><td>{c.type}</td><td>{c.target}</td></tr>)}</tbody></table>}
   <p className="hint">Original bytes and every attachment citation follow the displayed ID mapping. Existing catalogue records and project instances are preserved. Previously recorded human decisions remain history; pending or stale reviews still require the human.</p>
   <button type="button" disabled={busy||!preview.canCommit} onClick={()=>void importPreview()}>{preview.reused?'Confirm already-present bundle':'Import previewed catalogue bundle'}</button><button type="button" disabled={busy} onClick={()=>setPreview(null)}>Cancel catalogue import</button>
  </section>}
  {busy&&<p role="status">Checking original evidence…</p>}{message&&!busy&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
