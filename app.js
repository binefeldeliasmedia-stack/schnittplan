/* Schnittplan — spricht direkt mit Google Tasks und Google Kalender.
   Kein eigener Server, keine Zwischenspeicherung von Daten.
   Der Zugangsschluessel lebt nur im Arbeitsspeicher dieses Geraets. */

const CLIENT_ID = "537192931148-phm6tdk42t47cg5alilqtvp9sl0qom7t.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar";
const DATENLISTE = "Schnittplan-Daten";      // versteckte Liste fuer die Stundenkonten
const DATENTASK  = "stunden";

const TAGE = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const MONATE = ["Januar","Februar","März","April","Mai","Juni","Juli",
                "August","September","Oktober","November","Dezember"];

let token = null, tokenClient = null;
let listeId = null, datenListeId = null, datenTaskId = null;
let aufgaben = [], termine = [], daten = {projekte:[], eintraege:[]};
let bearbeitet = null;

/* ---------------- Hilfen ---------------- */
const $ = s => document.querySelector(s);
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const heute = () => iso(new Date());
const zahl = n => (Math.round(n*10)/10).toString().replace(".", ",");
const kurz = s => s ? s.slice(8,10)+"."+s.slice(5,7)+"." : "";
const escape = s => String(s??"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function melde(text, dauer = 5000){
  const m = $("#melder");
  if(!text){ m.classList.remove("an"); return; }
  m.textContent = text; m.classList.add("an");
  clearTimeout(melde._t);
  melde._t = setTimeout(()=>m.classList.remove("an"), dauer);
}

/* ---------------- Anmeldung ---------------- */
function startAnmeldung(){
  if(CLIENT_ID.startsWith("HIER_")){
    $("#tor-fehler").textContent = "Die App ist noch nicht mit Google verbunden.";
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (antwort)=>{
      if(antwort.error){ $("#tor-fehler").textContent = "Anmeldung abgebrochen."; return; }
      token = antwort.access_token;
      localStorage.setItem("schonmal", "ja");
      $("#tor").hidden = true;
      $("#app").hidden = false;
      ladeAlles();
    }
  });
  tokenClient.requestAccessToken({prompt: localStorage.getItem("schonmal") ? "" : "consent"});
}

$("#anmelden").addEventListener("click", startAnmeldung);
$("#abmelden").addEventListener("click", ()=>{
  if(token && window.google) google.accounts.oauth2.revoke(token, ()=>{});
  token = null; localStorage.removeItem("schonmal");
  location.reload();
});

/* Wer schon einmal zugestimmt hat, wird still wieder angemeldet. */
window.addEventListener("load", ()=>{
  const warten = setInterval(()=>{
    if(!window.google || !google.accounts) return;
    clearInterval(warten);
    if(localStorage.getItem("schonmal")) startAnmeldung();
  }, 120);
  setTimeout(()=>clearInterval(warten), 8000);
});

/* ---------------- Google-Aufrufe ---------------- */
async function api(url, optionen = {}){
  const antwort = await fetch(url, {
    ...optionen,
    headers: {Authorization: "Bearer "+token, "Content-Type":"application/json", ...(optionen.headers||{})}
  });
  if(antwort.status === 401){
    token = null;
    $("#app").hidden = true; $("#tor").hidden = false;
    $("#tor-fehler").textContent = "Die Anmeldung ist abgelaufen. Bitte neu anmelden.";
    throw new Error("abgelaufen");
  }
  if(!antwort.ok){
    const t = await antwort.text();
    throw new Error(`${antwort.status}: ${t.slice(0,140)}`);
  }
  return antwort.status === 204 ? {} : antwort.json();
}
const T = "https://tasks.googleapis.com/tasks/v1";
const C = "https://www.googleapis.com/calendar/v3";

/* ---------------- Laden ---------------- */
async function ladeAlles(){
  const knopf = $("#neu-laden");
  knopf.classList.add("dreht");
  try{
    const listen = (await api(`${T}/users/@me/lists`)).items || [];
    listeId = (listen.find(l => l.title !== DATENLISTE) || listen[0] || {}).id;
    let dl = listen.find(l => l.title === DATENLISTE);
    if(!dl) dl = await api(`${T}/users/@me/lists`, {method:"POST", body:JSON.stringify({title:DATENLISTE})});
    datenListeId = dl.id;

    const [tsk, dtsk, evs] = await Promise.all([
      api(`${T}/lists/${listeId}/tasks?showCompleted=true&showHidden=true&maxResults=100`),
      api(`${T}/lists/${datenListeId}/tasks?showCompleted=true&showHidden=true&maxResults=20`),
      ladeTermine()
    ]);

    aufgaben = (tsk.items || [])
      .map(t => ({id:t.id, titel:t.title||"", notiz:t.notes||"",
                  faellig:(t.due||"").slice(0,10), fertig:t.status === "completed"}))
      .filter(t => t.titel.trim())
      .sort((a,b)=> (a.fertig-b.fertig) || (a.faellig||"9999").localeCompare(b.faellig||"9999"));

    const dt = (dtsk.items || []).find(t => t.title === DATENTASK);
    if(dt){
      datenTaskId = dt.id;
      try{ daten = JSON.parse(dt.notes || "{}"); }catch{ daten = {}; }
    }else{
      const neu = await api(`${T}/lists/${datenListeId}/tasks`,
        {method:"POST", body:JSON.stringify({title:DATENTASK, notes:"{}"})});
      datenTaskId = neu.id; daten = {};
    }
    daten.projekte = daten.projekte || [];
    daten.eintraege = daten.eintraege || [];
    termine = evs;
    zeichneAlles();
    melde("");
  }catch(e){
    if(e.message !== "abgelaufen") melde("Konnte nicht laden: " + e.message);
  }finally{
    knopf.classList.remove("dreht");
  }
}

async function ladeTermine(){
  const von = new Date(); von.setDate(von.getDate()-2);
  const bis = new Date(); bis.setDate(bis.getDate()+35);
  const p = new URLSearchParams({
    timeMin: von.toISOString(), timeMax: bis.toISOString(),
    singleEvents:"true", orderBy:"startTime", maxResults:"250"});
  const r = await api(`${C}/calendars/primary/events?${p}`);
  return (r.items||[]).map(e=>{
    const s = e.start||{}, t = e.end||{};
    const ganztags = !!s.date;
    return {
      id:e.id, titel:e.summary||"(ohne Titel)", ganztags,
      datum: ganztags ? s.date : (s.dateTime||"").slice(0,10),
      von: ganztags ? null : (s.dateTime||"").slice(11,16),
      bis: ganztags ? null : (t.dateTime||"").slice(11,16)
    };
  });
}

async function speichereDaten(){
  if(!datenTaskId) return;
  await api(`${T}/lists/${datenListeId}/tasks/${datenTaskId}`,
    {method:"PATCH", body:JSON.stringify({notes: JSON.stringify(daten)})});
}

/* ---------------- Zeichnen ---------------- */
function artVon(titel){
  const t = titel.toLowerCase();
  if(t.startsWith("schnitt")) return "schnitt";
  if(t.startsWith("kettner")) return "kunde";
  return "";
}

function zeichneHeute(){
  const d = new Date();
  $("#heute-tag").textContent = `${TAGE[d.getDay()]} · ${d.getDate()}. ${MONATE[d.getMonth()].slice(0,3)}`;
  const stunde = d.getHours();
  const gruss = stunde < 11 ? "Guten Morgen, Elias." : stunde < 18 ? "Hallo Elias." : "Guten Abend, Elias.";
  const offen = aufgaben.filter(a=>!a.fertig && a.faellig && a.faellig <= heute()).length;
  $("#gruss").innerHTML = escape(gruss) + (offen
    ? ` <em>${offen === 1 ? "Eine Sache ist fällig." : offen+" Sachen sind fällig."}</em>`
    : " <em>Nichts überfällig.</em>");

  const ht = termine.filter(e => e.datum === heute());
  const z = $("#heute-termine"); z.innerHTML = "";
  if(!ht.length) z.innerHTML = `<p class="leerhinweis">Heute steht nichts im Kalender.</p>`;
  for(const e of ht){
    const div = document.createElement("div");
    div.className = "block" + (artVon(e.titel) === "kunde" ? " kundenblock" : "");
    div.innerHTML = `<span class="uhr">${e.ganztags ? "ganztags" : escape(e.von+"–"+e.bis)}</span>
      <span class="titel">${escape(e.titel)}</span>`;
    z.appendChild(div);
  }

  const f = $("#heute-faellig"); f.innerHTML = "";
  const faellig = aufgaben.filter(a=>!a.fertig && a.faellig && a.faellig <= heute());
  if(!faellig.length) f.innerHTML = `<p class="leerhinweis">Nichts fällig. Guter Tag.</p>`;
  for(const a of faellig){
    const div = document.createElement("div");
    div.className = "pflicht";
    div.innerHTML = `<span class="wann">${a.faellig < heute() ? "Überfällig" : "Heute"}</span>
      <span class="titel">${escape(a.titel)}</span>`;
    f.appendChild(div);
  }
}

function projektKarte(p){
  const eintraege = daten.eintraege.filter(e => e.projekt === p.id);
  const geleistet = eintraege.reduce((a,e)=>a+(Number(e.wert)||0), 0);
  const anteil = Math.min(100, Math.round(geleistet / Math.max(1,p.geplant) * 100));
  const art = document.createElement("article");
  art.className = "projekt";
  art.innerHTML = `
    <h3 class="paar"><span>${escape(p.name)}</span>
      <button class="weg-klein" type="button" aria-label="Projekt entfernen">×</button></h3>
    <div class="stand"><span><span class="gross">${zahl(geleistet)}</span> von ${p.geplant} Std.</span><span>${anteil}%</span></div>
    <div class="balken"><i style="width:${anteil}%"></i></div>
    <div class="buchen"><span class="hinweis">Heute gearbeitet</span></div>
    <div class="log"></div>`;
  art.querySelector(".weg-klein").addEventListener("click", ()=>entferneProjekt(p.id));
  const b = art.querySelector(".buchen");
  for(const w of [0.5,1,2,4]){
    const k = document.createElement("button");
    k.className="plus"; k.type="button"; k.textContent="+"+zahl(w);
    k.addEventListener("click", ()=>buche(p.id, w));
    b.appendChild(k);
  }
  if(eintraege.length){
    const z = document.createElement("button");
    z.className="zurueck"; z.type="button"; z.textContent="zurücknehmen";
    z.addEventListener("click", ()=>widerrufe(p.id));
    b.appendChild(z);
  }
  const log = art.querySelector(".log");
  for(const e of eintraege.slice(-3).reverse()){
    const d = document.createElement("div");
    d.innerHTML = `<span>${kurz(e.datum)}</span><span>+${zahl(e.wert)} Std.</span>`;
    log.appendChild(d);
  }
  return art;
}

function zeichneProjekte(){
  for(const ziel of ["#projekte-heute","#projekte-arbeit"]){
    const z = $(ziel); z.innerHTML = "";
    for(const p of daten.projekte) z.appendChild(projektKarte(p));
    if(ziel === "#projekte-arbeit" || !daten.projekte.length){
      const n = document.createElement("button");
      n.className = "neuprojekt"; n.type = "button"; n.textContent = "+ Projekt anlegen";
      n.addEventListener("click", oeffneProjektForm);
      z.appendChild(n);
    }
  }
}

function zeichneAufgaben(){
  const z = $("#aufgaben"); z.innerHTML = "";
  if(!aufgaben.length) z.innerHTML = `<p class="leerhinweis">Keine Aufgaben in dieser Liste.</p>`;
  for(const a of aufgaben){
    const dringend = !a.fertig && a.faellig && a.faellig <= heute();
    const r = document.createElement("div");
    r.className = "zeile" + (dringend?" dringend":"") + (a.fertig?" fertig":"");
    r.innerHTML = `<button class="haken" type="button" aria-pressed="${a.fertig}"
        aria-label="${escape(a.titel)} abhaken">✓</button>
      <span class="frist">${a.faellig ? kurz(a.faellig) : "—"}</span>
      <span class="titel">${escape(a.titel)}${a.notiz ? `<span class="notiz">${escape(a.notiz.slice(0,110))}</span>` : ""}</span>`;
    r.querySelector(".haken").addEventListener("click", ()=>hakeAb(a));
    z.appendChild(r);
  }
}

function zeichneKalender(){
  const z = $("#kalender"); z.innerHTML = "";
  const start = new Date(); start.setHours(12,0,0,0);
  const ende = new Date(start); ende.setDate(ende.getDate()+34);
  let box = null, letzte = null;
  for(let d = new Date(start); d <= ende; d.setDate(d.getDate()+1)){
    const tag = iso(d), wt = d.getDay();
    const montag = new Date(d); montag.setDate(d.getDate() - ((wt+6)%7));
    const wk = iso(montag);
    if(wk !== letzte){
      letzte = wk;
      const t = document.createElement("div");
      t.className = "wochentitel";
      t.textContent = "Woche ab " + montag.getDate() + ". " + MONATE[montag.getMonth()];
      z.appendChild(t);
      box = document.createElement("div"); box.className = "woche"; z.appendChild(box);
    }
    const dran = termine.filter(e => e.datum === tag);
    const zeile = document.createElement("div");
    zeile.className = "tagzeile" + (dran.length?"":" frei") + (tag === heute()?" istheute":"");
    zeile.innerHTML = `<div class="tagkopf">${TAGE[wt]}<b>${d.getDate()}</b></div><div class="eintraege"></div>`;
    const e_box = zeile.querySelector(".eintraege");
    if(!dran.length) e_box.innerHTML = `<span class="leer">frei</span>`;
    for(const e of dran){
      const b = document.createElement("button");
      b.type = "button"; b.className = "ev " + artVon(e.titel);
      b.innerHTML = `<span class="zeit">${e.ganztags?"ganztags":escape(e.von+"–"+e.bis)}</span>
        <span>${escape(e.titel)}</span>`;
      b.addEventListener("click", ()=>oeffneTerminForm(e));
      e_box.appendChild(b);
    }
    const p = document.createElement("button");
    p.className = "plustag"; p.type = "button"; p.textContent = "+";
    p.setAttribute("aria-label", tag + ": Termin hinzufügen");
    p.addEventListener("click", ()=>oeffneTerminForm(null, tag));
    zeile.appendChild(p);
    box.appendChild(zeile);
  }
}

function zeichneAlles(){ zeichneHeute(); zeichneProjekte(); zeichneAufgaben(); zeichneKalender(); }

/* ---------------- Schreiben ---------------- */
async function hakeAb(a){
  try{
    await api(`${T}/lists/${listeId}/tasks/${a.id}`, {method:"PATCH",
      body: JSON.stringify(a.fertig ? {status:"needsAction", completed:null} : {status:"completed"})});
    a.fertig = !a.fertig;
    aufgaben.sort((x,y)=> (x.fertig-y.fertig) || (x.faellig||"9999").localeCompare(y.faellig||"9999"));
    zeichneAufgaben(); zeichneHeute();
  }catch(e){ melde("Nicht gespeichert: " + e.message); }
}

$("#aufgabe-anlegen").addEventListener("click", legeAufgabeAn);
$("#neue-aufgabe").addEventListener("keydown", e=>{ if(e.key === "Enter") legeAufgabeAn(); });
async function legeAufgabeAn(){
  const feld = $("#neue-aufgabe");
  const titel = feld.value.trim();
  if(!titel) return;
  feld.value = "";
  try{
    const t = await api(`${T}/lists/${listeId}/tasks`, {method:"POST", body:JSON.stringify({title:titel})});
    aufgaben.unshift({id:t.id, titel, notiz:"", faellig:"", fertig:false});
    zeichneAufgaben();
  }catch(e){ melde("Nicht angelegt: " + e.message); feld.value = titel; }
}

async function buche(pid, wert){
  daten.eintraege.push({projekt:pid, datum:heute(), wert});
  zeichneProjekte();
  try{ await speichereDaten(); }
  catch(e){ melde("Stunden nicht gespeichert: " + e.message); }
}
async function widerrufe(pid){
  for(let i = daten.eintraege.length-1; i >= 0; i--){
    if(daten.eintraege[i].projekt === pid){ daten.eintraege.splice(i,1); break; }
  }
  zeichneProjekte();
  try{ await speichereDaten(); }catch(e){ melde("Nicht gespeichert: " + e.message); }
}
async function entferneProjekt(pid){
  daten.projekte = daten.projekte.filter(p => p.id !== pid);
  daten.eintraege = daten.eintraege.filter(e => e.projekt !== pid);
  zeichneProjekte();
  try{ await speichereDaten(); }catch(e){ melde("Nicht gespeichert: " + e.message); }
}

/* ---------------- Termin-Formular ---------------- */
const schleierT = $("#schleier-termin");
$("#t-ganztags").addEventListener("change", ()=>{ $("#t-zeiten").hidden = $("#t-ganztags").checked; });

function oeffneTerminForm(ev, datum){
  bearbeitet = ev || null;
  $("#t-kopf").textContent = ev ? "Termin ändern" : "Neuer Termin";
  $("#t-titel").value = ev ? ev.titel : "";
  $("#t-datum").value = ev ? ev.datum : (datum || heute());
  $("#t-ganztags").checked = !!(ev && ev.ganztags);
  $("#t-von").value = ev && !ev.ganztags ? ev.von : "08:30";
  $("#t-bis").value = ev && !ev.ganztags ? ev.bis : "12:30";
  $("#t-zeiten").hidden = $("#t-ganztags").checked;
  $("#t-loeschen").hidden = !ev;
  schleierT.classList.add("an");
  setTimeout(()=>$("#t-titel").focus(), 40);
}
function schliesseT(){ schleierT.classList.remove("an"); bearbeitet = null; }
$("#t-abbrechen").addEventListener("click", schliesseT);
schleierT.addEventListener("click", e=>{ if(e.target === schleierT) schliesseT(); });

$("#t-speichern").addEventListener("click", async ()=>{
  const titel = $("#t-titel").value.trim();
  if(!titel){ $("#t-titel").focus(); return; }
  const datum = $("#t-datum").value, ganz = $("#t-ganztags").checked;
  const koerper = {summary: titel};
  if(ganz){
    const n = new Date(datum+"T12:00:00"); n.setDate(n.getDate()+1);
    koerper.start = {date: datum}; koerper.end = {date: iso(n)};
  }else{
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
    koerper.start = {dateTime: `${datum}T${$("#t-von").value}:00`, timeZone: tz};
    koerper.end   = {dateTime: `${datum}T${$("#t-bis").value}:00`, timeZone: tz};
  }
  const knopf = $("#t-speichern"); knopf.disabled = true;
  try{
    if(bearbeitet) await api(`${C}/calendars/primary/events/${bearbeitet.id}`,
      {method:"PATCH", body:JSON.stringify(koerper)});
    else await api(`${C}/calendars/primary/events`, {method:"POST", body:JSON.stringify(koerper)});
    schliesseT();
    termine = await ladeTermine();
    zeichneKalender(); zeichneHeute();
  }catch(e){ melde("Termin nicht gespeichert: " + e.message); }
  finally{ knopf.disabled = false; }
});

$("#t-loeschen").addEventListener("click", async ()=>{
  if(!bearbeitet) return;
  const id = bearbeitet.id;
  schliesseT();
  try{
    await api(`${C}/calendars/primary/events/${id}`, {method:"DELETE"});
    termine = termine.filter(e => e.id !== id);
    zeichneKalender(); zeichneHeute();
  }catch(e){ melde("Nicht gelöscht: " + e.message); }
});

/* ---------------- Projekt-Formular ---------------- */
const schleierP = $("#schleier-projekt");
function oeffneProjektForm(){
  $("#p-name").value = ""; $("#p-geplant").value = "12";
  schleierP.classList.add("an");
  setTimeout(()=>$("#p-name").focus(), 40);
}
$("#p-abbrechen").addEventListener("click", ()=>schleierP.classList.remove("an"));
schleierP.addEventListener("click", e=>{ if(e.target === schleierP) schleierP.classList.remove("an"); });
$("#p-speichern").addEventListener("click", async ()=>{
  const name = $("#p-name").value.trim();
  if(!name){ $("#p-name").focus(); return; }
  daten.projekte.push({
    id: "p" + Date.now().toString(36),
    name,
    geplant: Math.max(1, Number($("#p-geplant").value) || 12)
  });
  schleierP.classList.remove("an");
  zeichneProjekte();
  try{ await speichereDaten(); }catch(e){ melde("Nicht gespeichert: " + e.message); }
});

document.addEventListener("keydown", e=>{
  if(e.key !== "Escape") return;
  schleierT.classList.remove("an"); schleierP.classList.remove("an"); bearbeitet = null;
});

/* ---------------- Reiter, Neu laden ---------------- */
for(const b of document.querySelectorAll(".reiter button")){
  b.addEventListener("click", ()=>{
    for(const x of document.querySelectorAll(".reiter button")) x.setAttribute("aria-selected", x === b);
    for(const s of document.querySelectorAll(".sicht")) s.classList.remove("an");
    $("#sicht-"+b.dataset.sicht).classList.add("an");
    window.scrollTo({top:0});
  });
}
$("#neu-laden").addEventListener("click", ladeAlles);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && token) ladeAlles(); });

if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
