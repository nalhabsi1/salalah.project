// ========== CONFIG ==========
const CENTER = [54.1, 17.02];   // Salalah area (lng, lat)
const ZOOM   = 11;

// Vibrant but light-friendly colors per GROUP key (from manifest.json)
const COLORS = {
  Health:'#ef4444', Utilities:'#2563eb', PublicSafety:'#9333ea', PublicFacilities:'#14b8a6',
  Education:'#f59e0b', RoadTransportation:'#6b7280', LandCover:'#22c55e', Hydrology:'#0ea5e9',
  Geology:'#b45309', Shopping:'#8b5cf6', FoodFacilities:'#fb923c', Financial:'#334155',
  Automotive:'#10b981', TouristSites:'#f97316', UrbanPlanning:'#06b6d4', Other:'#94a3b8'
};
const colorFor = g => COLORS[g] || COLORS.Other;

// ========== BASEMAP (Mapbox if token provided, else free fallback) ==========
const mbStyle = s => `https://api.mapbox.com/styles/v1/mapbox/${s}?access_token=${window.MAPBOX_TOKEN}`;
const fallbackStyle = 'https://demotiles.maplibre.org/style.json';
const mainStyle = window.MAPBOX_TOKEN ? mbStyle('streets-v12') : fallbackStyle; // light streets for progress tracking
const miniStyle = window.MAPBOX_TOKEN ? mbStyle('light-v11')   : fallbackStyle;

// Main map
const map = new maplibregl.Map({ container:'map', style: mainStyle, center: CENTER, zoom: ZOOM, pitch: 0, bearing: 0 });
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Mini overview
const miniMap = new maplibregl.Map({ container:'miniMap', style: miniStyle, center: CENTER, zoom: 11, interactive:false });

// ========== STATE ==========
let manifest = {};                   // {Group: [file.geojson, ...]}
const active = new Map();            // file -> {source, layers[], count, group}
let donut, bar;

// ========== UTILITIES ==========
function humanName(file){
  // "Utilities_OTC.geojson" -> "OTC"
  const base = file.replace(/\.geojson$/i,'');
  const parts = base.split('_');
  const tail = parts.length>1 ? parts.slice(1).join('_') : base;
  return tail.replace(/_/g,' ');
}

function detectGeom(gj){
  for(const f of gj.features||[]){
    const t = f.geometry?.type || '';
    if (t.includes('Point')) return 'point';
    if (t.includes('Line')) return 'line';
    if (t.includes('Polygon')) return 'polygon';
  }
  return 'point';
}

async function fetchJSON(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

// ========== CHIPS ==========
function buildChips(){
  const bar = document.getElementById('chipBar');
  bar.innerHTML = '';
  Object.entries(manifest).forEach(([group, files])=>{
    files.forEach(file=>{
      const chip = document.createElement('label');
      chip.className = 'chip';
      chip.style.borderColor = colorFor(group);
      chip.innerHTML = `<input type="checkbox" checked><span>${humanName(file)}</span>`;
      const cb = chip.querySelector('input');
      cb.onchange = () => cb.checked ? addFile(file, group) : removeFile(file);
      bar.appendChild(chip);

      // start ON: toggle twice to ensure addFile runs
      cb.checked = false; cb.onchange();
      cb.checked = true;  cb.onchange();
    });
  });
  updateKPIs();
}

document.getElementById('fitAll').onclick = () => fitToData();
document.getElementById('resetPitch').onclick = () => map.setPitch(0);

// ========== LOAD MANIFEST ==========
async function loadManifest(){
  try{
    return await fetchJSON('manifest.json');
  }catch(e){
    // minimal fallback example
    return {
      Utilities:["Utilities_LightPoles.geojson","Utilities_Manholes.geojson","Utilities_OTC.geojson"],
      Health:["Health_Hospitals.geojson","Health_Clinics.geojson"]
    };
  }
}

// ========== LAYER MANAGEMENT ==========
async function addFile(file, group){
  if(active.has(file)) return;
  const data = await fetchJSON(`Data/${file}`);
  const type = detectGeom(data);
  const sourceId = `src_${file}`;
  const color = colorFor(group);

  // cluster points
  const cluster = type==='point';
  map.addSource(sourceId, { type:'geojson', data, ...(cluster ? {cluster:true, clusterRadius:36} : {}) });

  const ids = [];
  if(type==='point'){
    ids.push(`cl_${file}`);
    map.addLayer({
      id:`cl_${file}`, type:'circle', source:sourceId, filter:['has','point_count'],
      paint:{'circle-radius':['interpolate',['linear'],['get','point_count'],5,12,100,26],
             'circle-color':color, 'circle-stroke-color':'#fff','circle-stroke-width':1}
    });
    ids.push(`pt_${file}`);
    map.addLayer({
      id:`pt_${file}`, type:'circle', source:sourceId, filter:['!', ['has','point_count']],
      paint:{'circle-radius':5, 'circle-color':color, 'circle-stroke-color':'#fff', 'circle-stroke-width':1}
    });
  }else if(type==='line'){
    ids.push(`ln_${file}`);
    map.addLayer({ id:`ln_${file}`, type:'line', source:sourceId, paint:{'line-color':color,'line-width':2}});
  }else{
    ids.push(`pl_${file}`,`pl_o_${file}`);
    map.addLayer({ id:`pl_${file}`, type:'fill', source:sourceId, paint:{'fill-color':color,'fill-opacity':0.35}});
    map.addLayer({ id:`pl_o_${file}`, type:'line', source:sourceId, paint:{'line-color':color,'line-width':1}});
  }

  // popup
  map.on('click', ids[ids.length-1], (e)=>{
    const p = e.features?.[0]?.properties || {};
    const html = Object.entries(p).slice(0,10).map(([k,v])=>`<div><b>${k}</b>: ${v}</div>`).join('') || '<i>No attributes</i>';
    new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  active.set(file, {source:sourceId, layers:ids, count:(data.features||[]).length, group});
  updateKPIs(); updateCharts(); fitToData();
}

function removeFile(file){
  const rec = active.get(file); if(!rec) return;
  rec.layers.forEach(id=>map.getLayer(id) && map.removeLayer(id));
  map.getSource(rec.source) && map.removeSource(rec.source);
  active.delete(file);
  updateKPIs(); updateCharts();
}

function fitToData(){
  const bounds = new maplibregl.LngLatBounds();
  let has=false;
  active.forEach(rec=>{
    const d = map.getSource(rec.source)?._data || {};
    (d.features||[]).forEach(f=>{
      const g=f.geometry; if(!g) return;
      const coords = g.type.includes('Point') ? [g.coordinates] :
                     g.type.includes('Line') ? g.coordinates.flat(1) :
                     g.coordinates.flat(2);
      coords.forEach(c=>{bounds.extend(c); has=true;});
    });
  });
  if(has) map.fitBounds(bounds,{padding:40, duration:600});
}

// ========== MINI OVERVIEW (optional Areas.geojson) ==========
async function loadAreas(){
  try{
    const gj = await fetchJSON('Data/Areas.geojson');
    miniMap.addSource('areas',{type:'geojson',data:gj});
    miniMap.addLayer({id:'areas-fill',type:'fill',source:'areas',paint:{'fill-color':'#93c5fd','fill-opacity':0.35}});
    miniMap.addLayer({id:'areas-line',type:'line',source:'areas',paint:{'line-color':'#60a5fa','line-width':1}});
  }catch(e){/* ok if missing */}
}

// ========== KPIs & CHARTS ==========
function updateKPIs(){
  const total = [...active.values()].reduce((s,a)=>s+a.count,0);
  const layersOn = active.size;
  const layersAll = Object.values(manifest).reduce((s,arr)=>s+arr.length,0);
  const pct = layersAll? Math.round(layersOn/layersAll*100) : 0;
  document.getElementById('kpiTotal').textContent = total.toLocaleString();
  document.getElementById('kpiLayers').textContent = layersAll.toLocaleString();
  document.getElementById('kpiPct').textContent = `${pct}%`;
}

function initCharts(){
  donut = new Chart(document.getElementById('donut'),{
    type:'doughnut',
    data:{labels:[],datasets:[{data:[],backgroundColor:[],borderWidth:0}]},
    options:{plugins:{legend:{position:'bottom'}}}
  });
  bar = new Chart(document.getElementById('bar'),{
    type:'bar',
    data:{labels:[],datasets:[{label:'Features',data:[],backgroundColor:[]}]},
    options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}
  });
}

function updateCharts(){
  // donut: counts by GROUP for active layers
  const byGroup = {};
  active.forEach(({count,group})=>{byGroup[group]=(byGroup[group]||0)+count;});
  const labels = Object.keys(byGroup);
  donut.data.labels = labels;
  donut.data.datasets[0].data = labels.map(l=>byGroup[l]);
  donut.data.datasets[0].backgroundColor = labels.map(l=>colorFor(l));
  donut.update();

  // bar: top 12 active layers
  const rows = [...active.entries()].map(([file,rec])=>({
    name: humanName(file), count: rec.count, color: colorFor(rec.group)
  })).sort((a,b)=>b.count-a.count).slice(0,12);
  bar.data.labels = rows.map(r=>r.name);
  bar.data.datasets[0].data = rows.map(r=>r.count);
  bar.data.datasets[0].backgroundColor = rows.map(r=>r.color);
  bar.update();
}

// ========== BOOT ==========
(async function(){
  manifest = await loadManifest();
  initCharts();
  buildChips();
  loadAreas();
})();
