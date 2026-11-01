/* Historischer Kartenatlas 2 – Karten- und Regionenverwaltung.
   Diese Version speichert Änderungen lokal im Browser. Keine Anmeldung/Synchronisation. */
(function () {
  "use strict";
  var KEY = "historischer-atlas-v2-library";
  function el(id) { return document.getElementById(id); }
  function safeHttp(value) {
    try { var original = String(value || "").trim(); var u = new URL(original); return (u.protocol === "https:" || u.protocol === "http:") ? original : ""; }
    catch (_) { return ""; }
  }
  function loadStore() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_) { return {}; }
  }
  function node(tag, css, txt) {
    var n = document.createElement(tag);
    if (css) n.className = css;
    if (txt !== undefined) n.textContent = String(txt);
    return n;
  }
  function validCoords(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }
  function mount(api) {
    var maps = api.maps, defs = api.regionDefinitions, regions = api.definedRegions;
    var defaultCount = maps.length;
    var defaults = maps.map(function (m) { return Object.assign({}, m); });
    var saved = loadStore();
    var storedRegions = Array.isArray(saved.regions) ? saved.regions : [];
    var custom = Array.isArray(saved.custom) ? saved.custom : [];
    var overrides = saved.overrides && typeof saved.overrides === "object" ? saved.overrides : {};
    var hidden = new Set(Array.isArray(saved.hidden) ? saved.hidden.filter(Number.isInteger) : []);

    function registerRegion(name, lat, lon, zoom) {
      name = String(name || "").trim().slice(0, 100);
      lat = Number(lat); lon = Number(lon); zoom = Number(zoom);
      if (!name || !validCoords(lat, lon)) throw new Error("Bitte gültigen Regionsnamen und Koordinaten eingeben.");
      if (!Number.isFinite(zoom) || zoom < 2 || zoom > 19) zoom = 12;
      defs[name] = {center: [lat, lon], zoom: zoom};
      if (!regions.includes(name)) regions.splice(Math.max(1, regions.indexOf("Favoriten")), 0, name);
      return name;
    }
    storedRegions.forEach(function (r) {
      try { if (r && r.name) registerRegion(r.name, r.lat, r.lon, r.zoom); } catch (_) {}
    });
    Object.keys(overrides).forEach(function (key) {
      var id = Number(key), edit = overrides[key];
      if (!Number.isInteger(id) || id < 0 || id >= defaultCount || !edit || typeof edit !== "object") return;
      if (!safeHttp(edit.sourceUrl)) return;
      Object.assign(maps[id], sanitizeMap(edit));
    });
    custom.forEach(function (c) {
      if (!c || typeof c !== "object") { maps.push({id: maps.length,hidden:true}); return; }
      var item = sanitizeMap(c);
      item.id = maps.length; item.custom = true;
      if (!item.sourceUrl || !item.name) item.hidden = true;
      maps.push(item);
    });
    maps.forEach(function (m, index) { m.id = index; m.hidden = !!m.hidden || hidden.has(index); });

    function sanitizeMap(v) {
      var type = v.type === "wms" ? "wms" : v.type === "tms" ? "tms" : "xyz";
      var name = String(v.name || "").trim().slice(0, 220);
      var url = safeHttp(v.sourceUrl);
      return {
        name: name, displayName: name, year: Number.isInteger(Number(v.year)) && Number(v.year) >= 1 && Number(v.year) <= 2100 ? Number(v.year) : null,
        region: String(v.region || "Berlin").trim().slice(0, 100),
        sourceUrl: url,
        detailUrl: safeHttp(v.detailUrl) || url,
        provider: String(v.provider || "Eigene Karte").slice(0, 140),
        type: type, layerName: String(v.layerName || "").trim().slice(0, 250)
      };
    }
    function persist() {
      var obj = {
        version: 2,
        regions: storedRegions,
        custom: maps.slice(defaultCount).map(function (m) {
          return {name:m.name,region:m.region,year:m.year,sourceUrl:m.sourceUrl,detailUrl:m.detailUrl,provider:m.provider,type:m.type,layerName:m.layerName};
        }),
        overrides: overrides,
        hidden: maps.filter(function (m) {return m.hidden;}).map(function (m) {return m.id;})
      };
      try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
      catch (_) { api.setNotice("Speichern nicht möglich. Bitte Browserspeicher prüfen."); return false; }
    }
    function redraw() { api.renderRegions(); api.renderList(); api.updateTimeline(); }
    var css = node("style");
    css.textContent = ".manager-launch{width:100%;margin:10px 0 0;border:1px solid #b6cfbe;background:#eaf3ec;color:#214c3f;border-radius:10px;padding:10px;font-weight:750;font-size:12px;text-align:center}.manager-launch:hover{background:#dcecdf}.manager-edit{background:#f4f8f3;border:1px solid #dce6dd;color:#466b55;border-radius:8px;padding:5px 7px;font-size:13px}.manager-edit:hover{background:#dfebdd}.manager-modal{border:1px solid #dbe5db;border-radius:17px;padding:0;width:min(640px,calc(100% - 18px));max-height:90dvh;box-shadow:0 20px 90px #132d2b55;color:#284438;background:white}.manager-modal::backdrop{background:#11291f91}.manager-inner{padding:22px;max-height:87dvh;overflow:auto}.manager-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px}.manager-head h2{font:700 22px Georgia,serif;margin:0}.manager-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 15px}.manager-tab{border:1px solid #d9e3d9;background:#f8faf6;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:700;color:#375b4c}.manager-tab[aria-selected=true]{background:#245044;color:white}.manager-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.manager-fields label,.manager-label{display:block;font-size:12px;font-weight:700;color:#435a4b}.manager-fields input,.manager-fields select,.manager-search{width:100%;margin-top:5px;padding:11px 10px;border:1px solid #d1ddce;border-radius:9px;background:white;color:#20382c;font-size:14px}.manager-wide{grid-column:1/-1}.manager-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}.manager-action{padding:10px 13px;border:1px solid #b8ccbf;background:#fff;color:#26483c;border-radius:9px;font-size:13px;font-weight:700}.manager-primary{background:#214d3e;color:white;border-color:#214d3e}.manager-danger{color:#933e34;border-color:#ecd0cd}.manager-muted{font-size:12px;color:#6a7c70;line-height:1.5}.manager-results{display:grid;gap:9px;margin-top:12px;max-height:38dvh;overflow:auto}.manager-result{padding:12px;border:1px solid #d9e3d9;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:12px}.manager-result strong{display:block;font-size:13px;overflow-wrap:anywhere}.manager-result small{display:block;color:#718075;margin-top:4px}.manager-status{margin:9px 0;color:#4c6657;font-size:12px}.manager-hidden{display:none!important}@media(max-width:500px){.manager-fields{grid-template-columns:1fr}.manager-inner{padding:14px}.manager-head h2{font-size:19px}}";
    document.head.appendChild(css);
    var launcher = node("button", "manager-launch", "+ Karten entdecken und verwalten");
    launcher.type = "button";
    el("regions").after(launcher);
    var dialog = node("dialog", "manager-modal");
    dialog.id = "managerDialog";
    dialog.innerHTML = '<div class="manager-inner"><div class="manager-head"><h2>Kartenbibliothek verwalten</h2><button id="managerClose" class="manager-action" type="button" aria-label="Schließen">✕</button></div><div class="manager-tabs"><button id="managerDiscoverTab" class="manager-tab" type="button">Karten entdecken</button><button id="managerMapTab" class="manager-tab" type="button">Karte hinzufügen</button><button id="managerRegionTab" class="manager-tab" type="button">Regionen</button><button id="managerBackupTab" class="manager-tab" type="button">Sicherung</button></div><section id="managerDiscover"><form id="managerDiscoverForm"><label class="manager-label" for="managerDiscoverQuery">Historische Karten nach Ort oder Begriff suchen</label><div style="display:flex;gap:7px"><input id="managerDiscoverQuery" class="manager-search" required minlength="2" maxlength="90" value="Berlin" placeholder="Berlin, Wien, Rom …"><button class="manager-action manager-primary" type="submit">Suchen</button></div></form><p class="manager-muted">Suche in bereits georeferenzierten MapWarper-Karten. Angezeigte Treffer sind externe Angebote; Verfügbarkeit und Nutzungsrechte hängen vom Anbieter ab.</p><div id="managerSearchStatus" class="manager-status" role="status"></div><div id="managerResults" class="manager-results"></div><p class="manager-muted"><a href="https://mapwarper.net/" target="_blank" rel="noopener noreferrer">MapWarper öffnen ↗</a> · Weitere Geoportale werden später angebunden.</p></section><section id="managerMap" class="manager-hidden"><form id="managerMapForm" class="manager-fields"><label class="manager-wide">Kartenname<input id="mgrName" required maxlength="220" placeholder="z. B. Berlin 1910"></label><label>Jahr (optional)<input id="mgrYear" type="number" min="1" max="2100" placeholder="1910"></label><label>Region<select id="mgrRegion"></select></label><label>Kartentyp<select id="mgrType"><option value="xyz">XYZ / WMTS-Kachel-URL</option><option value="tms">TMS-Kachel-URL</option><option value="wms">WMS-Dienst</option></select></label><label>Kartenanbieter<input id="mgrProvider" placeholder="z. B. MapWarper"></label><label class="manager-wide">Kachel-URL oder WMS-Endpunkt<input id="mgrUrl" type="text" required spellcheck="false" placeholder="https://…/{z}/{x}/{y}.png"></label><label class="manager-wide" id="mgrLayerWrap">WMS-Layername<input id="mgrLayer" placeholder="Technischer Name der Kartenebene"></label><label class="manager-wide">Link zur Originalquelle (optional)<input id="mgrDetails" spellcheck="false" placeholder="https://…"></label><div class="manager-actions manager-wide"><button class="manager-action manager-primary" type="submit">Karte speichern</button><button id="mgrDelete" class="manager-action manager-danger manager-hidden" type="button">Karte entfernen</button><button id="mgrCancelEdit" class="manager-action" type="button">Abbrechen</button></div></form><p class="manager-muted">XYZ benötigt {z}, {x}, {y}. WMS benötigt den Layernamen aus „GetCapabilities“. Ein WMS-Server muss die verwendete Projektion EPSG:3857 unterstützen. Änderungen bleiben zunächst nur in diesem Browser gespeichert.</p></section><section id="managerRegion" class="manager-hidden"><form id="managerRegionForm" class="manager-fields"><label class="manager-wide">Neue Region / Ort<input id="mgrRegionName" required maxlength="100" placeholder="z. B. Potsdam"></label><label>Breitengrad<input id="mgrLat" type="number" min="-90" max="90" step="any" placeholder="52.4"></label><label>Längengrad<input id="mgrLon" type="number" min="-180" max="180" step="any" placeholder="13.0"></label><label>Karten-Zoom<input id="mgrZoom" type="number" min="2" max="19" value="12"></label><div class="manager-actions manager-wide"><button class="manager-action" type="button" id="mgrLookupRegion">Koordinaten automatisch suchen</button><button class="manager-action manager-primary" type="submit">Region speichern</button></div></form><p id="mgrRegionStatus" class="manager-status" role="status"></p><div id="mgrRegionList" class="manager-results"></div><p class="manager-muted">Regionen können neu angelegt und bearbeitet werden. Für die automatische Ortssuche verwenden wir OpenStreetMap / Nominatim.</p></section><section id="managerBackup" class="manager-hidden"><p class="manager-muted">Änderungen werden derzeit nur auf diesem Gerät gespeichert. Exportiere eine Sicherung, bevor du den Browser wechselst oder lokale Daten löschst. Die Datei enthält deine individuellen Karteneinträge, Regionen und ausgeblendeten Karten.</p><div class="manager-actions"><button id="mgrExport" class="manager-action manager-primary">Sicherung herunterladen</button><label class="manager-action" for="mgrImport" style="cursor:pointer">Sicherung importieren</label><input id="mgrImport" type="file" accept="application/json,.json" hidden></div><p class="manager-muted">Ein Konto und geräteübergreifende Speicherung werden als nächste Ausbaustufe ergänzt.</p></section></div>';
    document.body.appendChild(dialog);
    function open(tab) { switchTab(tab || "discover"); if (!dialog.open) dialog.showModal(); }
    function switchTab(tab) {
      ["Discover","Map","Region","Backup"].forEach(function (x) {
        var selected = x.toLowerCase() === tab;
        el("manager"+x).classList.toggle("manager-hidden", !selected);
        el("manager"+x+"Tab").setAttribute("aria-selected", String(selected));
      });
      if (tab === "map") populateRegions();
      if (tab === "region") renderRegionList();
    }
    launcher.addEventListener("click", function () { open("discover"); });
    el("managerClose").addEventListener("click", function () { dialog.close(); });
    ["Discover","Map","Region","Backup"].forEach(function (name) {
      el("manager"+name+"Tab").addEventListener("click", function () {
        if (name === "Map") beginNewMap();
        else open(name.toLowerCase());
      });
    });
    function populateRegions() {
      var select = el("mgrRegion"), old = select.value;
      select.replaceChildren();
      regions.filter(function (r) {return !["Alle","Favoriten","Weitere"].includes(r);}).forEach(function (r) {
        var opt = node("option", "", r); opt.value = r; select.appendChild(opt);
      });
      if (Array.from(select.options).some(function (o) {return o.value === old;})) select.value = old;
    }
    var editing = null;
    function beginNewMap() {
      editing = null;
      el("managerMapForm").reset();
      el("mgrDelete").classList.add("manager-hidden");
      el("mgrType").value = "xyz";
      populateRegions();
      el("mgrLayerWrap").classList.add("manager-hidden");
      open("map");
      el("mgrName").focus();
    }
    function editMap(id) {
      var m = maps[id]; if (!m || m.hidden) return;
      editing = id;
      open("map");
      populateRegions();
      el("mgrName").value = m.name || "";
      el("mgrYear").value = m.year || "";
      el("mgrRegion").value = m.region;
      el("mgrType").value = m.type || "xyz";
      el("mgrProvider").value = m.provider || "";
      el("mgrUrl").value = m.sourceUrl || "";
      el("mgrLayer").value = m.layerName || "";
      el("mgrDetails").value = m.detailUrl || "";
      el("mgrDelete").classList.remove("manager-hidden");
      toggleLayer();
    }
    function toggleLayer() { el("mgrLayerWrap").classList.toggle("manager-hidden", el("mgrType").value !== "wms"); }
    el("mgrType").addEventListener("change", toggleLayer);
    el("mgrCancelEdit").addEventListener("click", beginNewMap);
    function mapExists(item, exceptId) {
      return maps.some(function (m) {return m && !m.hidden && m.id !== exceptId && m.sourceUrl === item.sourceUrl && (m.layerName || "") === (item.layerName || "");});
    }
    function upsert(item, id) {
      item = sanitizeMap(item);
      if (!item.name || !item.sourceUrl) throw new Error("Name und gültige HTTP(S)-Adresse sind erforderlich.");
      if (!defs[item.region]) throw new Error("Bitte zuerst eine Region anlegen.");
      if (item.type === "wms" && !item.layerName) throw new Error("Bitte den WMS-Layernamen angeben.");
      if (item.type !== "wms" && !["{z}","{x}","{y}"].every(function (v) {return item.sourceUrl.includes(v);}))
        throw new Error("Eine XYZ-/TMS-URL muss {z}, {x} und {y} enthalten.");
      if (mapExists(item, id)) throw new Error("Diese Karte ist bereits in deiner Bibliothek.");
      if (id === null || id === undefined) {
        item.id = maps.length; item.custom = true; maps.push(item);
      } else {
        item.id = id; item.custom = id >= defaultCount;
        Object.assign(maps[id], item);
        if (id < defaultCount) overrides[id] = Object.assign({}, item);
      }
      persist(); redraw(); api.selectMap(item.id); return item;
    }
    el("managerMapForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      try {
        upsert({
          name:el("mgrName").value,year:el("mgrYear").value,region:el("mgrRegion").value,
          type:el("mgrType").value,sourceUrl:el("mgrUrl").value,layerName:el("mgrLayer").value,
          provider:el("mgrProvider").value,detailUrl:el("mgrDetails").value
        }, editing);
        dialog.close(); api.setNotice("Karte gespeichert.");
      } catch (e) { api.setNotice(e.message, 6000); window.alert(e.message); }
    });
    function removeMap(id) {
      var item = maps[id]; if (!item || item.hidden) return;
      if (!window.confirm("„" + item.name + "“ aus deiner Kartenbibliothek entfernen? Die Originalquelle bleibt erhalten.")) return;
      var active = api.getActive();
      item.hidden = true;
      if (active && active.id === id) {
        var next = maps.find(function (m) {return m && !m.hidden;});
        if (next) api.selectMap(next.id);
      }
      persist(); redraw(); dialog.close(); api.setNotice("Karte aus Bibliothek entfernt.");
    }
    el("mgrDelete").addEventListener("click", function () { if (editing !== null) removeMap(editing); });
    async function lookupLocation(q) {
      var u = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=" + encodeURIComponent(q);
      var response = await fetch(u, {headers:{"Accept":"application/json"}});
      if (!response.ok) throw new Error("Ortssuche aktuell nicht erreichbar (HTTP " + response.status + ").");
      var hits = await response.json();
      if (!Array.isArray(hits) || !hits.length) throw new Error("Keine geografischen Koordinaten gefunden.");
      return {lat:Number(hits[0].lat),lon:Number(hits[0].lon)};
    }
    async function ensureRegion(name) {
      if (defs[name]) return name;
      var hit = await lookupLocation(name);
      return saveRegion(name, hit.lat, hit.lon, 12);
    }
    function saveRegion(name, lat, lon, zoom) {
      name = registerRegion(name, lat, lon, zoom);
      var data = {name:name,lat:Number(lat),lon:Number(lon),zoom:Number(zoom)};
      var idx = storedRegions.findIndex(function (r) {return r.name === name;});
      if (idx >= 0) storedRegions[idx] = data; else storedRegions.push(data);
      persist(); redraw(); populateRegions(); return name;
    }
    el("mgrLookupRegion").addEventListener("click", async function () {
      var q = el("mgrRegionName").value.trim();
      if (!q) {el("mgrRegionStatus").textContent = "Zuerst eine Region eingeben.";return;}
      el("mgrRegionStatus").textContent = "Suche Koordinaten …";
      try {
        var loc = await lookupLocation(q);
        el("mgrLat").value = loc.lat; el("mgrLon").value = loc.lon;
        el("mgrRegionStatus").textContent = "Koordinaten gefunden. Bitte „Region speichern“ auswählen.";
      } catch (e) { el("mgrRegionStatus").textContent = e.message; }
    });
    el("managerRegionForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      try {
        var name = saveRegion(el("mgrRegionName").value, el("mgrLat").value === "" ? NaN : Number(el("mgrLat").value), el("mgrLon").value === "" ? NaN : Number(el("mgrLon").value), Number(el("mgrZoom").value));
        api.setRegionFilter(name); redraw(); renderRegionList();
        el("mgrRegionStatus").textContent = "Region „" + name + "“ gespeichert.";
      } catch (e) {el("mgrRegionStatus").textContent = e.message;}
    });
    function renderRegionList() {
      var wrap = el("mgrRegionList"); wrap.replaceChildren();
      regions.filter(function (r) {return !["Alle","Favoriten","Weitere"].includes(r);}).forEach(function (name) {
        var r = defs[name];
        if (!r) return;
        var row = node("div","manager-result"), title = node("div");
        title.append(node("strong","",name),node("small","",r.center[0].toFixed(4)+", "+r.center[1].toFixed(4)+" · Zoom "+r.zoom));
        var edit = node("button","manager-action","Bearbeiten"); edit.type = "button";
        edit.addEventListener("click",function () {
          el("mgrRegionName").value=name;el("mgrLat").value=r.center[0];el("mgrLon").value=r.center[1];el("mgrZoom").value=r.zoom;
          el("mgrRegionStatus").textContent="Region kann mit neuen Koordinaten aktualisiert werden.";
          el("mgrRegionName").focus();
        });
        row.append(title,edit);wrap.appendChild(row);
      });
    }
    el("managerDiscoverForm").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var query=el("managerDiscoverQuery").value.trim();
      var out=el("managerResults"), status=el("managerSearchStatus");
      if (query.length<2) return;
      out.replaceChildren();
      var count=0, remote=0, listed=new Set();
      function appendSuggestion(item) {
        var url=safeHttp(item.sourceUrl).replace(/^http:/,"https:");
        if (!url || listed.has(url)) return;
        listed.add(url); item.sourceUrl=url;
        var found=maps.some(function(m) {return m&&!m.hidden&&String(m.sourceUrl).replace(/^http:/,"https:")===url;});
        var row=node("div","manager-result"), box=node("div");
        box.append(node("strong","",item.name),node("small","",(item.year?item.year+" · ":"")+item.provider+" · Kartenkacheln"));
        var btn=node("button","manager-action"+(found?"":" manager-primary"),found?"Vorhanden":"+ Übernehmen");
        btn.disabled=found;btn.type="button";
        btn.addEventListener("click",async function () {
          btn.disabled=true;btn.textContent="Übernahme …";
          try {
            await ensureRegion(item.region);
            var added=upsert(item,null);
            btn.textContent="Übernommen";
            api.setNotice("„"+added.name+"“ hinzugefügt. Quelle und Nutzungsrechte beachten.");
          } catch(e) {btn.disabled=false;btn.textContent="+ Übernehmen";api.setNotice(e.message,6500);window.alert(e.message);}
        });
        row.append(box,btn);out.appendChild(row);count++;
      }
      var local=query.toLowerCase();
      if (/berlin|brandenburg|potsdam/.test(local)) {
        appendSuggestion({name:"Schmettausches Kartenwerk 1767–1787",year:1787,region:query,sourceUrl:"https://tiles.historic.place/region/Schmettau-1787/{z}/{x}/{y}.png",detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",provider:"Historic.Place",type:"xyz"});
        appendSuggestion({name:"Straubes Übersichtsplan Berlin 1910",year:1910,region:query,sourceUrl:"https://tiles.codefor.de/berlin-straubeplan/{z}/{x}/{y}.png",detailUrl:"https://daten.berlin.de/",provider:"Code for Germany / Geoportal Berlin",type:"xyz"});
        appendSuggestion({name:"Berlin 1860",year:1860,region:query,sourceUrl:"https://tiles.historic.place/Berlin1860/{z}/{x}/{y}.png",detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",provider:"Historic.Place",type:"xyz"});
      }
      if (/deutschland|germany|eisenbahn/.test(local)) {
        appendSuggestion({name:"Deutschland Eisenbahnkarte 1856",year:1856,region:query,sourceUrl:"https://tiles.historic.place/region/Reisekarte_Deutschland_1856/{z}/{x}/{y}.png",detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",provider:"Historic.Place",type:"xyz"});
      }
      status.textContent=count?count+" Karten im integrierten Katalog. Zusätzliche MapWarper-Treffer werden gesucht …":"Suche georeferenzierte MapWarper-Karten …";
      try {
        var endpoint="https://mapwarper.net/api/v1/maps.json?show_warped=1&per_page=35&query="+encodeURIComponent(query);
        var response=await fetch(endpoint,{headers:{"Accept":"application/json"}});
        if (!response.ok) throw new Error("HTTP "+response.status);
        var data=await response.json(), rows=Array.isArray(data.data)?data.data:[];
        rows.forEach(function(record) {
          var a=record.attributes||{}, links=record.links||{};
          var url=safeHttp(links.tiles);
          if (!url||!["{z}","{x}","{y}"].every(function(v){return url.includes(v);})) return;
          var name=String(a.title||"Historische Karte").slice(0,220);
          var match=String(a.date_depicted||a.issue_year||name).match(/(?:1[0-9]{3}|20[0-9]{2})/);
          appendSuggestion({name:name,year:match?Number(match[0]):null,region:query,sourceUrl:url,detailUrl:"https://mapwarper.net/maps/"+encodeURIComponent(record.id),provider:"MapWarper",type:"xyz"});
          remote++;
        });
        status.textContent=count+" Kartenangebote insgesamt; "+remote+" MapWarper-Einträge ausgewertet (erste Ergebnisseite).";
        if (!count) status.textContent="Keine übernehmbaren XYZ-Karten gefunden. Probiere einen anderen Suchbegriff.";
      } catch(e) {
        status.textContent=(count?count+" Karten aus dem integrierten Katalog verfügbar. ":"")+"Live-Suche bei MapWarper aktuell nicht möglich ("+e.message+"). Die Karten können weiterhin manuell hinzugefügt werden.";
      }
    });
    el("mgrExport").addEventListener("click",function () {
      persist();
      var blob=new Blob([localStorage.getItem(KEY)||"{}"],{type:"application/json"});
      var url=URL.createObjectURL(blob), link=node("a");link.href=url;link.download="historischer-kartenatlas-sicherung.json";link.click();
      setTimeout(function () {URL.revokeObjectURL(url);},1000);
    });
    el("mgrImport").addEventListener("change",async function (event) {
      var file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 1000000) throw new Error("Sicherungsdatei ist zu groß.");
        var data=JSON.parse(await file.text());
        if (!data || data.version !== 2 || !Array.isArray(data.custom) || !Array.isArray(data.regions)) throw new Error("Keine gültige Atlas-2-Sicherung.");
        if (!window.confirm("Die jetzige lokale Bibliothek wird durch die Sicherung ersetzt. Fortfahren?")) return;
        localStorage.setItem(KEY, JSON.stringify(data));location.reload();
      } catch(e) { api.setNotice("Import fehlgeschlagen: "+e.message,6500); }
    });
    return {open:open,editMap:editMap,beginNewMap:beginNewMap,removeMap:removeMap};
  }
  window.AtlasManager = {mount:mount};
}());
