/* Berliner Geodatensuche: official CSW catalogue browser for WMS map layers.
   The source catalogue is GeoNetwork CSW of GDI Berlin; no fixed source limit. */
(function(){
"use strict";
const CSW="https://gdi.berlin.de/geonetwork/srv/ger/csw";
const BASE="https://gdi.berlin.de/services/wms/";
const THEMES=["Alle","Luftbilder","Historische Karten","Verkehr","Baumbestand","Umweltatlas","Klima","Stadtplanung","Denkmäler","Gewässer"];
function node(tag,text,cl){const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cl)e.className=cl;return e;}
function textElement(n,key){
 return Array.from(n.getElementsByTagName("*")).find(x=>x.localName===key)?.textContent?.trim()||"";
}
function normalQuery(q){
 return String(q||"").trim().slice(0,90).replace(/[^A-Za-z0-9ÄÖÜäöüß .\/_-]/g," ").replace(/\s+/g," ").trim();
}
function parseCSW(xml){
 const doc=new DOMParser().parseFromString(xml,"application/xml");
 if(doc.getElementsByTagName("parsererror").length)throw Error("Der Geodatenkatalog liefert keine gültigen Suchdaten.");
 const root=Array.from(doc.getElementsByTagName("*")).find(e=>e.localName==="SearchResults");
 if(!root)throw Error("Die Geodatensuche hat kein gültiges CSW-Suchergebnis gesendet.");
 const matched=Number(root.getAttribute("numberOfRecordsMatched")||0);
 const records=Array.from(root.children).filter(x=>/Record|MD_Metadata/i.test(x.localName));
 const results=new Map();
 for(const r of records){
  const title=textElement(r,"title")||"Berliner Geodienst";
  const description=textElement(r,"description")||textElement(r,"abstract")||"";
  const raw=r.textContent+" "+Array.from(r.getElementsByTagName("*"))
    .map(x=>Array.from(x.attributes||[]).map(a=>a.value).join(" ")).join(" ");
  const names=raw.match(/https?:\/\/gdi\.berlin\.de\/services\/wms\/[a-z0-9_-]+/gi)||[];
  // Keep every leaf field of the original ISO 19139/CSW record. This permits
  // inspection of all available metadata, including contacts, constraints,
  // dates, keywords, lineage, licenses and identifiers.
  const metadata=[];
  for(const el of Array.from(r.getElementsByTagName("*"))){
    if(el.children.length)continue;
    const val=(el.textContent||"").trim()||
      el.getAttribute("codeListValue")||el.getAttribute("href")||
      el.getAttribute("xlink:href")||"";
    if(!val)continue;
    const parent=el.parentElement?.localName||"";
    const key=(parent&&parent!==el.localName?parent+" · ":"")+el.localName;
    metadata.push({name:key,value:val});
  }
  const metadataXml=new XMLSerializer().serializeToString(r);
  const recordId=textElement(r,"fileIdentifier")||textElement(r,"identifier")||"";
  for(const found of names){
   const url=found.replace(/^http:/i,"https:");
   if(!/^https:\/\/gdi\.berlin\.de\/services\/wms\/[a-z0-9_-]+$/i.test(url))continue;
   if(!results.has(url))results.set(url,{title,description,url,metadata,metadataXml,recordId});
  }
 }
 return {results:[...results.values()],matched};
}
async function searchCSW(query,start,options={}){
 const parameters=new URLSearchParams({
  SERVICE:"CSW",REQUEST:"GetRecords",VERSION:"2.0.2",
  resultType:"results",typeNames:"csw:Record",elementSetName:"full",
  outputSchema:"http://www.isotc211.org/2005/gmd",
  maxRecords:"30",startPosition:String(start),
  constraintLanguage:"CQL_TEXT",constraint_language_version:"1.1.0",
  constraint: options.category
    ? "TopicCategory = '"+String(options.category).replace(/[^A-Za-z]/g,"")+"'"
    : "AnyText like '%"+normalQuery(query)+"%'"
 });
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),16000);
 try{
  const response=await fetch(CSW+"?"+parameters.toString(),{mode:"cors",signal:ctl.signal,
   headers:{Accept:"application/xml,text/xml,*/*"}});
  if(!response.ok)throw Error("CSW HTTP "+response.status);
  return parseCSW(await response.text());
 }finally{clearTimeout(timer);}
}
function safeLink(value){
 try{
  const u=new URL(String(value).trim());
  return /^(https?:)$/.test(u.protocol)?u.href:null;
 }catch(_){return null;}
}
function metadataDetails(label,fields,xml,filename){
 const details=node("details",null,"geo-metadata");
 const summary=node("summary",label);details.appendChild(summary);
 let rendered=false;
 details.addEventListener("toggle",()=>{
  if(!details.open||rendered)return;
  rendered=true;
  const list=node("div",null,"metadata-scroll");
  if(!fields.length)list.appendChild(node("p","Für diesen Eintrag wurden keine zusätzlichen Angaben übermittelt.","gdi-small"));
  for(const field of fields){
   if(field.value===undefined||field.value===null||String(field.value).trim()==="")continue;
   const row=node("div",null,"metadata-row");
   const name=node("b",field.name||"Metadaten");
   const link=safeLink(field.value);
   let v;
   if(link){
     v=node("a",String(field.value));v.href=link;v.target="_blank";v.rel="noopener noreferrer";
   }else{
     v=node("button",String(field.value),"metadata-copy");
     v.type="button";v.title="Wert kopieren";
     v.setAttribute("aria-label",(field.name||"Metadaten")+": Wert kopieren");
     v.addEventListener("click",async()=>{
       try{await navigator.clipboard.writeText(String(field.value));v.title="Kopiert";setTimeout(()=>v.title="Wert kopieren",1700);}
       catch(_){window.prompt("Metadatenwert kopieren:",String(field.value));}
     });
   }
   row.append(name,v);list.appendChild(row);
  }
  details.appendChild(list);
  if(xml){
   const actions=node("div",null,"metadata-actions");
   const download=node("button","Alle Metadaten als XML speichern");
   download.type="button";
   download.addEventListener("click",()=>{
    const blob=new Blob([xml],{type:"application/xml;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=node("a");a.href=url;a.download=filename||"geoportal-metadaten.xml";
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   });
   actions.append(download);details.append(actions);
  }
 });
 return details;
}
function layerFields(layer,service){
 const out=[
  {name:"Kartenwerk / Dienst",value:service.title},
  {name:"Titel der Kartenebene",value:layer.title},
  {name:"Technischer Layername",value:layer.name},
  {name:"Beschreibung",value:layer.abstract},
  {name:"Abfragbare Sachdaten (WMS)",value:layer.queryable?"Ja – sofern GetFeatureInfo unterstützt wird":"Nicht als abfragbar ausgewiesen"},
  {name:"Koordinatensysteme",value:(layer.crs||[]).join(", ")},
  {name:"Suchbegriffe",value:(layer.keywords||[]).join(", ")},
  {name:"Kartenstile",value:(layer.styles||[]).join(", ")},
  {name:"Quellennachweis",value:layer.attribution},
  {name:"Mindestmaßstab",value:layer.minScale},
  {name:"Höchstmaßstab",value:layer.maxScale},
  {name:"Geographische Ausdehnung W/S/O/N",value:(layer.box||[]).join(", ")},
  {name:"WMS-Dienst",value:service.url},
  {name:"GetCapabilities",value:service.url+"?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1"}
 ];
 for(const url of layer.metadataUrls||[])out.push({name:"Metadatenquelle",value:url});
 for(const url of layer.dataUrls||[])out.push({name:"Datenquelle",value:url});
 return out.filter(x=>x.value!==""&&x.value!==undefined);
}
function yearOf(name){
 const m=String(name).match(/(?:18[6-9]\d|19\d{2}|20[0-2]\d)/);
 return m?Number(m[0]):null;
}
// Amtliche ISO-19115-Themenkategorien wie im Geoportal Berlin.
// Keine erfundenen Unterkategorien; alle Dienste werden aus dem CSW ermittelt.
const TOPICS=[
 {label:"Atmosphäre",code:"climatologyMeteorologyAtmosphere"},
 {label:"Bauwerke",code:"structure"},
 {label:"Binnengewässer",code:"inlandWaters"},
 {label:"Biologie",code:"biota"},
 {label:"Geowissenschaften",code:"geoscientificInformation"},
 {label:"Gesellschaft",code:"society"},
 {label:"Gesundheitswesen",code:"health"},
 {label:"Grenzen",code:"boundaries"},
 {label:"Höhenangaben",code:"elevation"},
 {label:"Oberflächenbeschreibung",code:"imageryBaseMapsEarthCover"},
 {label:"Ortsangaben",code:"location"},
 {label:"Planungsunterlagen, Kataster",code:"planningCadastre"},
 {label:"Umwelt",code:"environment"},
 {label:"Ver- und Entsorgung/Kommunikation",code:"utilitiesCommunication"},
 {label:"Verkehrswesen",code:"transportation"},
 {label:"Wirtschaft",code:"economy"}
];
const BASEMAP=/(?:^|[\s_\-])(basiskarte|grundkarte|hintergrund(?:karte)?|background|basemap|openstreetmap|webatlas|topplus|basiskarten)(?:$|[\s_\-])/i;
const INDEXONLY=/bildmitten?|bildzentren|gebietsabdeckung|blattschnitt|bildindex|bildpunkte|footprints?|aufnahmeorte|flugstreifen|blattgrenze/i;
function isBackground(x){return BASEMAP.test((x.title||"")+" "+(x.name||"")+" "+(x.url||""));}
function isIndexed(x){return INDEXONLY.test((x.title||"")+" "+(x.name||""));}
function mount({parent,maps,preview,capabilities,services=[]}){
 if(!parent||!preview||!capabilities)return;
 const styles=node("style");
 styles.textContent=".gdi-browser{border:0;padding:0;margin:0}.gdi-browser .gdi-browser-description{font-size:12px;line-height:1.5;color:#63786b;margin:0 0 11px}.gdi-browser .gdi-browser-search{display:flex;gap:8px}.gdi-browser .gdi-browser-search input{min-width:0;flex:1;padding:11px;border:1px solid #cadbce;border-radius:11px;font-size:13px;background:#fff}.gdi-browser button{font:700 12px system-ui;border-radius:11px;border:1px solid #c9dfce;padding:10px;color:#28533e;background:#f6f9f6;cursor:pointer}.gdi-browser button:disabled{opacity:.52}.gdi-browser .gdi-action{background:#245744;color:white;border-color:#245744}.gdi-browser .gdi-breadcrumb{font-size:11px;color:#718579;margin:13px 0 7px;line-height:1.45}.gdi-browser .gdi-navrow{display:flex;justify-content:space-between;align-items:center;gap:9px;margin:7px 0 12px}.gdi-browser .gdi-step-title{font-size:15px;font-weight:800;color:#224938;overflow-wrap:anywhere}.gdi-browser .gdi-back{background:#edf5ef;color:#245440;white-space:nowrap}.gdi-browser .gdi-palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px;margin:10px 0}.gdi-browser .gdi-palette>button{display:flex;align-items:center;justify-content:space-between;text-align:left;gap:8px;min-height:57px;padding:12px 13px;line-height:1.35;background:#fff;border:1px solid #d6e5da;box-shadow:0 2px 7px #18402b0c;color:#254c3a}.gdi-browser .gdi-palette>button:hover,.gdi-browser .gdi-palette>button:focus-visible{background:#eaf4ed;border-color:#94b89f}.gdi-browser .gdi-arrow{font-size:20px;color:#6c977b;flex:none}.gdi-browser .gdi-palette>button .gdi-mini{display:block;color:#718478;font-size:10px;font-weight:400;margin-top:4px;overflow-wrap:anywhere}.gdi-browser .gdi-status{font-size:11px;color:#557360;line-height:1.5;margin:10px 0}.gdi-browser .gdi-layer-card{border:1px solid #d9e7dc;border-radius:12px;background:white;padding:11px;margin:8px 0}.gdi-browser .gdi-layer-card strong{display:block;font-size:12px;color:#264b39;overflow-wrap:anywhere}.gdi-browser .gdi-layer-card small{display:block;color:#6c7d72;font-size:11px;margin:5px 0;line-height:1.4}.gdi-browser .gdi-layer-card button{margin-top:7px;background:#245744;color:white;border-color:#245744}.gdi-browser .gdi-layer-filter{box-sizing:border-box;width:100%;border-radius:10px;border:1px solid #cdded0;padding:10px;margin:9px 0;font-size:13px}.gdi-browser .gdi-extra{border-top:1px solid #e1ebe4;margin-top:12px;padding-top:11px}.gdi-browser .gdi-extra a{color:#246345;font-size:12px}.gdi-browser .gdi-more{width:100%;margin:9px 0}.gdi-browser .gdi-hint{font-size:11px;color:#65786a;line-height:1.5}.gdi-browser .gdi-tag{font-size:10px;color:#577562}.gdi-browser .gdi-icon{font-size:19px;width:21px;flex:none}@media(max-width:470px){.gdi-browser .gdi-palette{grid-template-columns:1fr}.gdi-browser .gdi-palette>button{padding:11px 9px;min-height:64px;font-size:11px}.gdi-browser .gdi-icon{display:none}}";
 document.head.appendChild(styles);
 const root=node("section",null,"gdi-browser");

 const form=node("form",null,"gdi-browser-search");
 const input=node("input");input.type="search";input.placeholder="Fachkarte suchen …";input.maxLength=90;input.setAttribute("aria-label","Berliner Fachkarte suchen");
 const searchButton=node("button","Suchen","gdi-action");searchButton.type="submit";
 form.append(input,searchButton);
 const crumbs=node("div",null,"gdi-breadcrumb");
 const header=node("div",null,"gdi-navrow");
 const back=node("button","‹ Zurück","gdi-back");back.type="button";
 const step=node("strong",null,"gdi-step-title");header.append(back,step);
 const palette=node("div",null,"gdi-palette");
 const results=node("div");results.setAttribute("aria-live","polite");
 const status=node("p",null,"gdi-status");
 const extras=node("div",null,"gdi-extra");
 const official=node("a","Amtliche Geodatensuche öffnen");
 official.href="https://gdi.berlin.de/geonetwork/srv/ger/catalog.search";
 official.target="_blank";official.rel="noopener noreferrer";
 extras.appendChild(official);
 const urlForm=node("form",null,"gdi-browser-search");
 const urlInput=node("input");urlInput.type="url";urlInput.placeholder="Berliner WMS-Adresse einfügen";urlInput.setAttribute("aria-label","Offizielle Berliner WMS-URL");
 const urlButton=node("button","Öffnen");urlButton.type="submit";urlForm.append(urlInput,urlButton);
 extras.appendChild(node("p","Du hast bereits einen WMS-Link? Öffne hier seine Kartenebenen.","gdi-hint"),urlForm);
 root.append(form,crumbs,header,palette,status,results,extras);parent.appendChild(root);
 let stack=[{level:"root",title:"Fachkarten"}], requestId=0,searchPosition=1,selectedQuery="",serviceSeen=new Set(),resultsCount=0;
 const present=()=>stack[stack.length-1];
 const addButton=(label,action,description,icon)=>{
  const b=node("button");b.type="button";
  if(icon)b.appendChild(node("span",icon,"gdi-icon"));
  const span=node("span");span.textContent=label;

  b.append(span,node("span","›","gdi-arrow"));b.addEventListener("click",action);palette.appendChild(b);
  return b;
 };
 const backgroundService=x=>isBackground(x);
 function push(view){requestId++;stack.push(view);render();}
 function pop(){if(stack.length>1){requestId++;stack.pop();render();}}
 function setStatus(message){status.textContent=message||"";}
 function clear(){palette.replaceChildren();results.replaceChildren();setStatus("");}
 function render(){
  const view=present();clear();
  crumbs.textContent=stack.map(s=>s.title).join(" › ");
  step.textContent=view.title;
  back.hidden=stack.length===1;
  if(view.level==="root"){
   for(const topic of TOPICS){
    addButton(topic.label,()=>push({level:"services",title:topic.label,category:topic.code,query:"",preset:[]}));
   }}else if(view.level==="services"){
   searchPosition=1;selectedQuery=view.query;serviceSeen=new Set();resultsCount=0;
   setStatus("Kartendienste werden ermittelt …");
   for(const id of view.preset||[]){
    const svc=services.find(s=>s.id===id&&!s.indexOnly);
    if(svc)showService({title:svc.title,url:"https://gdi.berlin.de/services/wms/"+svc.slug,description:svc.note});
   }
   loadMoreServices(view);
  }else if(view.level==="layers"){
   setStatus("Kartenebenen werden geladen …");loadLayers(view);
  }
 }
 function showService(item){
  if(backgroundService(item)||serviceSeen.has(item.url))return;
  serviceSeen.add(item.url);resultsCount++;
  addButton(item.title||"Berliner Fachkarte",()=>{
   push({level:"layers",title:item.title||"Kartenebenen",service:item});
  });
 }
 async function loadMoreServices(view){
  if(present()!==view)return;
  const id=++requestId,start=searchPosition;
  setStatus("Suche im Berliner Fachkartenkatalog …");
  try{
   const page=await searchCSW(view.query,start,{category:view.category});
   if(id!==requestId||present()!==view)return;
   searchPosition+=30;
   for(const item of page.results)showService(item);
   setStatus(resultsCount+" relevante WMS-Dienste gefunden. "+
      (page.matched>=searchPosition?"Weitere Katalogseiten verfügbar.":"Weitere Treffer über die Suche möglich."));
   results.replaceChildren();
   if(page.matched>=searchPosition){
    const more=node("button","Weitere Kartendienste laden","gdi-more");
    more.type="button";more.addEventListener("click",()=>loadMoreServices(view));
    results.appendChild(more);
   }
   if(!resultsCount)results.appendChild(node("p","Noch keine passenden Fachkarten gefunden. Probiere einen anderen Suchbegriff oder die amtliche Suche.","gdi-hint"));
  }catch(error){
   if(id!==requestId||present()!==view)return;
   setStatus("Automatische Katalogsuche derzeit nicht verfügbar ("+error.message+"). Bekannte amtliche Karten oben kannst du trotzdem auswählen. Alternativ die amtliche Suche öffnen.");
  }
 }
 async function loadLayers(view){
  const id=++requestId;
  try{
   const info=await capabilities(view.service.url);
   if(id!==requestId||present()!==view)return;
   const available=(info.leaves||[]).filter(l=>l.name&&!isBackground(l)&&!isIndexed(l));
   const svc=services.find(s=>"https://gdi.berlin.de/services/wms/"+s.slug===view.service.url);
   // For known aerial-photo services, display only actual photographs,
   // never photo-centre and sheet-footprint index layers.
   const aerial=svc?.id?.startsWith("aerial")||/luftbild_/.test(view.service.url);
   const layers=aerial?available.filter(l=>/raster|mosaik|luftbild|bilddaten|orthophoto/i.test(l.name+" "+l.title)):available;
   if(!layers.length){setStatus("Dieser Dienst bietet keine einbindbare Fachkartenebene an. Eventuell werden nur Übersichts-/Indexdaten angeboten.");return;}
   results.replaceChildren();
   const filter=node("input",null,"gdi-layer-filter");filter.type="search";filter.placeholder="Kartenebenen filtern …";
   filter.setAttribute("aria-label","Fachkartenebenen durchsuchen");results.appendChild(filter);
   const body=node("div");results.appendChild(body);
   const show=()=>{
    body.replaceChildren();const term=filter.value.trim().toLocaleLowerCase("de");
    const match=layers.filter(l=>!term||(l.title+" "+l.name+" "+(l.abstract||"")).toLocaleLowerCase("de").includes(term));
    let visible=80;
    const addCards=()=>{
     const fragment=document.createDocumentFragment();
     for(const layer of match.slice(body.querySelectorAll(".gdi-layer-card").length,visible)){
      const row=node("div",null,"gdi-layer-card");
      const heading=node("strong",layer.title||layer.name);

       const layerMetadata=metadataDetails("Metadaten",layerFields(layer,view.service),view.service.metadataXml||"","geoportal-metadaten.xml");
      const button=node("button","Auf Karte legen");button.type="button";
      button.addEventListener("click",()=>{
       const name=layers.length===1?view.service.title:view.service.title+" · "+(layer.title||layer.name);
       const item={name:name.slice(0,210),year:yearOf(name),region:"Berlin",
         sourceUrl:view.service.url,type:"geoportal",layerName:layer.name,
         bounds:Array.isArray(layer.box)&&layer.box.length===4
           ?[[layer.box[1],layer.box[0]],[layer.box[3],layer.box[2]]]:null,
         detailUrl:"https://gdi.berlin.de/view/"+view.service.url.split("/").pop(),
         provider:"Geoportal Berlin / Land Berlin"};
       try{preview(item);}catch(e){setStatus("Vorschau konnte nicht geöffnet werden: "+e.message);}
      });
      row.append(heading,button,layerMetadata);
      fragment.append(row);
     }
     body.querySelector(".gdi-more")?.remove();
     body.append(fragment);
     if(match.length>visible){
      const more=node("button","Weitere "+Math.min(80,match.length-visible)+" Ebenen anzeigen","gdi-more");
      more.type="button";more.addEventListener("click",()=>{visible+=80;addCards();});
      body.append(more);
     }
    };
    addCards();
    setStatus(layers.length+" einbindbare Fachkartenebenen. „Auf Karte legen“ öffnet eine ungespeicherte Vorschau.");
   };
   filter.addEventListener("input",show);show();
  }catch(error){
   if(id!==requestId||present()!==view)return;
   setStatus("Ebenen nicht erreichbar: "+error.message+". Prüfe den Originaldienst oder verwende einen anderen Kartendienst.");
  }
 }
 back.addEventListener("click",pop);
 form.addEventListener("submit",e=>{
  e.preventDefault();const query=normalQuery(input.value);
  if(!query){setStatus("Bitte einen Suchbegriff eingeben.");return;}
  push({level:"services",title:"Suche: "+query,query,preset:[]});
 });
 urlForm.addEventListener("submit",e=>{
  e.preventDefault();const url=urlInput.value.trim().split("?")[0].replace(/^http:/,"https:");
  if(!/^https:\/\/gdi\.berlin\.de\/services\/wms\/[a-z0-9_-]{2,120}$/i.test(url)){
   setStatus("Hier können nur offizielle Berliner WMS-Dienste geladen werden.");return;
  }
  push({level:"layers",title:"Kartenebenen",service:{url,title:url.split("/").pop(),description:"Amtlicher Berliner WMS"}});
 });
 render();
}
window.AtlasGeoSearch={mount,parseCSW,searchCSW};
})();