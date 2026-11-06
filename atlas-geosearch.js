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
  for(const found of names){
   const url=found.replace(/^http:/i,"https:");
   if(!/^https:\/\/gdi\.berlin\.de\/services\/wms\/[a-z0-9_-]+$/i.test(url))continue;
   if(!results.has(url))results.set(url,{title,description:description.slice(0,250),url});
  }
 }
 return {results:[...results.values()],matched};
}
async function searchCSW(query,start){
 const parameters=new URLSearchParams({
  SERVICE:"CSW",REQUEST:"GetRecords",VERSION:"2.0.2",
  resultType:"results",typeNames:"csw:Record",elementSetName:"full",
  outputSchema:"http://www.isotc211.org/2005/gmd",
  maxRecords:"30",startPosition:String(start),
  constraintLanguage:"CQL_TEXT",constraint_language_version:"1.1.0",
  constraint:"AnyText like '%"+normalQuery(query)+"%'"
 });
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),16000);
 try{
  const response=await fetch(CSW+"?"+parameters.toString(),{mode:"cors",signal:ctl.signal,
   headers:{Accept:"application/xml,text/xml,*/*"}});
  if(!response.ok)throw Error("CSW HTTP "+response.status);
  return parseCSW(await response.text());
 }finally{clearTimeout(timer);}
}
function yearOf(name){
 const m=String(name).match(/(?:18[6-9]\d|19\d{2}|20[0-2]\d)/);
 return m?Number(m[0]):null;
}
function mount({parent,maps,add,capabilities}){
 if(!parent||!add||!capabilities)return;
 const styles=node("style");
 styles.textContent=".gdi-browser{border:1px solid #c6d8c7;border-radius:12px;background:#fff;padding:12px;margin:12px 0}.gdi-browser h3{margin:0 0 8px;font-size:14px;color:#214939}.gdi-browser p,.gdi-browser .gdi-small{font-size:11px;line-height:1.5;color:#5d7869}.gdi-browser form{display:flex;gap:7px}.gdi-browser input{min-width:0;flex:1;border:1px solid #c6d8cb;border-radius:9px;padding:11px;font-size:13px}.gdi-browser button{border:1px solid #bfd5c5;border-radius:9px;padding:9px;font-size:12px;color:#214d3a;font-weight:700;background:#f1f8f1}.gdi-browser button.primary{background:#245544;color:#fff}.gdi-browser button:disabled{opacity:.5}.gdi-browser .themes{display:flex;gap:6px;overflow-x:auto;padding:9px 0;scrollbar-width:thin}.gdi-browser .themes button{flex:none;white-space:nowrap}.gdi-browser .catalog-result{padding:10px 0;border-top:1px solid #e2ece4}.gdi-browser .catalog-result strong{display:block;font-size:12px;overflow-wrap:anywhere}.gdi-browser .catalog-result small{display:block;color:#6d8074;font-size:11px;margin:3px 0 7px}.gdi-browser .catalog-result button{margin:3px 5px 3px 0}.gdi-browser .catalog-layers{padding:5px 0 5px 10px;border-left:2px solid #b4d3bc}.gdi-browser .catalog-layer{padding:8px 0;border-bottom:1px dashed #dce6de;display:flex;gap:6px;justify-content:space-between;align-items:center}.gdi-browser .catalog-layer span{font-size:11px;min-width:0;overflow-wrap:anywhere}.gdi-browser .catalog-layer button{white-space:nowrap;flex:none}.gdi-browser .catalog-status{font-size:11px;line-height:1.4;margin:8px 0;color:#486a58}.gdi-browser .browse-footer{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:9px 0}.gdi-browser a{color:#245e47}";
 document.head.appendChild(styles);
 const box=node("section",null,"gdi-browser");
 const title=node("h3","Gesamten Berliner Geodatenkatalog durchsuchen");
 const note=node("p","Amtliche Kartenwerke, Luftbilder, Umwelt- und Fachkarten direkt suchen und einzelne Kartenebenen in deine Sammlung übernehmen.");
 const form=node("form"),input=node("input"),go=node("button","Suchen","primary");
 input.type="search";input.placeholder="z. B. Luftbilder, Eisenbahn, Bäume";input.maxLength=90;
 input.setAttribute("aria-label","Geodatenkatalog durchsuchen");
 go.type="submit";form.append(input,go);
 const themes=node("div",null,"themes");
 const results=node("div");results.setAttribute("aria-live","polite");
 const status=node("p","Suchbegriff eingeben oder ein Thema auswählen.","catalog-status");
 const footer=node("div",null,"browse-footer");
 const more=node("button","Weitere Treffer laden");more.type="button";more.hidden=true;
 const official=node("a","Alle Daten im Geoportal recherchieren");
 official.href="https://gdi.berlin.de/geonetwork/srv/ger/catalog.search";
 official.target="_blank";official.rel="noopener noreferrer";
 footer.append(more,official);
 const urlRow=node("div",null,"catalog-result");
 const urlHelp=node("small","Alternativ einen WMS-Link aus der Berliner Geodatensuche einfügen:");
 const urlForm=node("form");
 const urlInput=node("input");urlInput.type="url";urlInput.placeholder="https://gdi.berlin.de/services/wms/…";urlInput.setAttribute("aria-label","WMS-Adresse");
 const urlGo=node("button","Ebenen laden");urlGo.type="submit";
 urlForm.append(urlInput,urlGo);urlRow.append(urlHelp,urlForm);
 box.append(title,note,form,themes,status,results,footer,urlRow);
 const marker=parent.querySelector("#gdiItems");
 if(marker)marker.before(box);else parent.append(box);
 let currentQuery="",next=1,loading=false;
 const originalLabel=go.textContent;
 function sourceURL(url){
  return /^https:\/\/gdi\.berlin\.de\/services\/wms\/[a-z0-9_-]{2,120}$/i.test(url);
 }
 function setStatus(t){status.textContent=t;}
 function hideMore(){more.hidden=true;}
 function renderService(entry){
  if(!sourceURL(entry.url))return;
  const row=node("div",null,"catalog-result");
  const t=node("strong",entry.title),desc=node("small",entry.description.slice(0,180)||entry.url);
  const open=node("button","Kartenebenen anzeigen");open.type="button";
  const layerBox=node("div",null,"catalog-layers");layerBox.hidden=true;
  const external=node("a","Quelle");external.href="https://gdi.berlin.de/view/"+entry.url.slice(BASE.length);
  external.target="_blank";external.rel="noopener noreferrer";
  row.append(t,desc,open,external,layerBox);results.appendChild(row);
  open.addEventListener("click",async()=>{
   if(!layerBox.hidden){layerBox.hidden=true;open.textContent="Kartenebenen anzeigen";return;}
   open.disabled=true;open.textContent="Lade Ebenen …";
   try{
    const caps=await capabilities(entry.url);
    const layers=(caps.leaves||[]).filter(x=>x.name);
    layerBox.replaceChildren();
    if(!layers.length)throw Error("Keine benannten Ebenen verfügbar.");
    const filter=node("input");
    filter.type="search";filter.placeholder="Kartenebenen filtern …";filter.setAttribute("aria-label","Kartenebenen filtern");
    layerBox.appendChild(filter);
    const container=node("div");
    layerBox.appendChild(container);
    function showLayers(){
     container.replaceChildren();
     const q=filter.value.trim().toLocaleLowerCase("de");
     const selection=layers.filter(l=>!q||(l.title+" "+l.name).toLocaleLowerCase("de").includes(q)).slice(0,100);
     for(const layer of selection){
      const row=node("div",null,"catalog-layer");
      const label=node("span",layer.title||layer.name);
      const addButton=node("button","+ Übernehmen");addButton.type="button";
      const already=maps.some(m=>m&&!m.hidden&&m.sourceUrl===entry.url&&m.type==="geoportal"&&m.layerName===layer.name);
      if(already){addButton.disabled=true;addButton.textContent="Gespeichert";}
      addButton.addEventListener("click",()=>{
       try{
        const name=layers.length===1?entry.title:entry.title+" · "+(layer.title||layer.name);
        add({
         name:name.slice(0,200),year:yearOf(name),region:"Berlin",
         sourceUrl:entry.url,type:"geoportal",layerName:layer.name,
         detailUrl:"https://gdi.berlin.de/view/"+entry.url.slice(BASE.length),
         provider:"Geoportal Berlin / Land Berlin"
        },null);
        setStatus("Die Kartenebene „"+(layer.title||layer.name)+"“ wurde deiner Kartenbibliothek hinzugefügt.");
        addButton.disabled=true;addButton.textContent="Gespeichert";
        parent.closest("dialog")?.close();
        document.getElementById("sidebar")?.classList.remove("open");
       }catch(e){setStatus("Karte konnte nicht hinzugefügt werden: "+e.message);}
      });
      row.append(label,addButton);container.append(row);
     }
     if(layers.length>100&&!q)container.prepend(node("p","100 Ebenen sichtbar – über das Suchfeld weitere finden.","gdi-small"));
     if(!selection.length)container.append(node("p","Keine passenden Kartenebenen.","gdi-small"));
    }
    filter.addEventListener("input",showLayers);showLayers();
    layerBox.hidden=false;open.textContent="Kartenebenen schließen";
   }catch(e){setStatus("Ebenen konnten nicht geladen werden: "+e.message);open.textContent="Erneut versuchen";}
   finally{open.disabled=false;}
  });
 }
 async function search(query,append=false){
  if(loading)return;
  loading=true;go.disabled=true;more.disabled=true;
  if(!append){results.replaceChildren();next=1;currentQuery=normalQuery(query);}
  official.href="https://gdi.berlin.de/geonetwork/srv/ger/catalog.search#/search?any="+encodeURIComponent(currentQuery);
  setStatus("Suche im amtlichen Berliner Geodatenkatalog …");
  try{
   const page=await searchCSW(currentQuery,next);
   for(const entry of page.results)renderService(entry);
   next+=30;
   more.hidden=!(page.matched>=next);
   setStatus("Katalog: "+page.matched+" Datensätze gefunden. "+
    page.results.length+" WMS-Dienste auf dieser Suchseite; weitere Seiten können geladen werden.");
   if(!page.results.length)results.append(node("p","Diese Trefferseite enthält keine direkt einbindbaren WMS-Karten. Weitere Treffer laden oder den Suchbegriff ändern.","gdi-small"));
  }catch(e){
   setStatus("Die automatische Geodatensuche konnte nicht geladen werden ("+
     (e.name==="AbortError"?"Zeitüberschreitung":e.message)+
     "). Öffne die amtliche Suche über den Link unten oder füge dort gefundene WMS-Adressen über das Feld ein.");
   hideMore();
  }finally{go.disabled=false;more.disabled=false;loading=false;}
 }
 form.addEventListener("submit",e=>{e.preventDefault();search(input.value);});
 for(const theme of THEMES){
  const b=node("button",theme);b.type="button";
  b.addEventListener("click",()=>{input.value=theme==="Alle"?"":theme;search(input.value);});
  themes.appendChild(b);
 }
 more.addEventListener("click",()=>search(currentQuery,true));
 urlForm.addEventListener("submit",e=>{
  e.preventDefault();
  const candidate=urlInput.value.trim().split("?")[0];
  if(!sourceURL(candidate)){setStatus("Bitte eine offizielle Berliner WMS-Adresse verwenden, zum Beispiel https://gdi.berlin.de/services/wms/baumbestand.");return;}
  renderService({title:"Berliner WMS · "+candidate.slice(BASE.length),url:candidate,description:"Manuell ausgewählter Kartendienst"});
  setStatus("Kartenwerk eingefügt. Wähle darunter „Kartenebenen anzeigen“.");
  urlInput.value="";
 });
}
window.AtlasGeoSearch={mount,parseCSW,searchCSW};
})();