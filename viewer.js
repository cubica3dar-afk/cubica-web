import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";

const card = document.getElementById("slicer-viewer-card");
const holder = document.getElementById("slicer-viewer3d");
const loading = document.getElementById("slicer-viewer-loading");
const errorBox = document.getElementById("slicer-viewer-error");
const info = document.getElementById("slicer-viewer-info");
const resetBtn = document.getElementById("slicer-reset-view");

const BED_SIZE = 250;
const PLATE_SPACING = 295;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f2);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10000);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
holder.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(140, -100, 220);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 1.3);
fill.position.set(-100, 120, 100);
scene.add(fill);

const bedRoot = new THREE.Group();
scene.add(bedRoot);

let modelRoot = null;
let lastFit = null;
let editableMaterials = [];
let renderUnits = [];
let clusters = [];
let basePositions = new Map();
let selectedPlateView = 0;
let expectedPlateCount = 0;

function resize() {
  const w = holder.clientWidth || 640;
  const h = holder.clientHeight || 420;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(holder);
resize();

function clearBeds(){
  while(bedRoot.children.length){
    const child=bedRoot.children.pop();
    child.traverse?.(o=>{o.geometry?.dispose?.(); if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose?.())}});
  }
}

function addBed(x=0,y=0){
  const g=new THREE.Group();
  const grid=new THREE.GridHelper(BED_SIZE,10,0xbdbdb8,0xdadad5);
  grid.rotation.x=Math.PI/2;
  grid.position.set(x,y,-0.03);
  g.add(grid);
  const border=new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(BED_SIZE,BED_SIZE,0.5)),
    new THREE.LineBasicMaterial({color:0x92928d})
  );
  border.position.set(x,y,-0.25);
  g.add(border);
  bedRoot.add(g);
}

function clearModel() {
  if (modelRoot) {
    scene.remove(modelRoot);
    modelRoot.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
  }
  modelRoot = null;
  editableMaterials = [];
  renderUnits = [];
  clusters = [];
  basePositions.clear();
  clearBeds();
}

function normalizeMaterialVisibility(root) {
  root.traverse(obj => {
    if (obj.isMesh) {
      if (!obj.material) {
        obj.material = new THREE.MeshStandardMaterial({
          color: 0xd77b37, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide
        });
      } else {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          m.side = THREE.DoubleSide;
          if ("roughness" in m) m.roughness = 0.62;
          m.needsUpdate = true;
        });
      }
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
}

function collectEditableMaterials(root) {
  const seen = new Set();
  editableMaterials = [];
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.filter(Boolean).forEach(mat => {
      if (seen.has(mat)) return;
      seen.add(mat);
      if (!mat.color) mat.color = new THREE.Color(0xd77b37);
      editableMaterials.push(mat);
    });
  });
  if (!editableMaterials.length && root.isMesh && root.material) editableMaterials=[root.material];
  const colors = editableMaterials.map(m => '#'+m.color.getHexString().toUpperCase());
  window.dispatchEvent(new CustomEvent('cubica:model-colors-ready', {detail:{colors}}));
}

function applyViewerColors(colors) {
  if (!editableMaterials.length) return;
  colors.forEach((c,i)=>{
    const mat=editableMaterials[i]; if(!mat || !mat.color) return;
    try { mat.color.set(c); mat.needsUpdate=true; } catch {}
  });
  if (editableMaterials.length===1 && colors[0]) {
    editableMaterials[0].color.set(colors[0]); editableMaterials[0].needsUpdate=true;
  }
}

function hasMeshDescendant(obj){
  let found=false;
  obj.traverse(o=>{if(o.isMesh) found=true});
  return found;
}

function prepareRenderUnits(root){
  if(root.isMesh) return [root];
  let units=(root.children||[]).filter(hasMeshDescendant);
  // Some 3MF loaders wrap everything in one group. Fall back to individual meshes.
  if(units.length<=1){
    units=[];
    root.traverse(o=>{if(o.isMesh) units.push(o)});
  }
  // Flatten to modelRoot while preserving world transforms, making plate translations predictable.
  units=[...new Set(units)];
  units.forEach(u=>{
    if(u!==root && u.parent!==root){
      try{ root.attach(u); }catch{}
    }
  });
  return units.length?units:[root];
}

function unitCenter(unit){
  const box=new THREE.Box3().setFromObject(unit);
  return box.getCenter(new THREE.Vector3());
}

function clusterUnits(units, expectedCount=0){
  if(units.length<=1) return [units.slice()];
  const centers=units.map(unitCenter);
  const parent=units.map((_,i)=>i);
  const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const unite=(a,b)=>{a=find(a);b=find(b);if(a!==b) parent[b]=a};
  for(let i=0;i<units.length;i++){
    for(let j=i+1;j<units.length;j++){
      const dx=Math.abs(centers[i].x-centers[j].x);
      const dy=Math.abs(centers[i].y-centers[j].y);
      if(dx < 260 && dy < 260) unite(i,j);
    }
  }
  const groups=new Map();
  units.forEach((u,i)=>{const r=find(i); if(!groups.has(r)) groups.set(r,[]); groups.get(r).push(u)});
  let list=[...groups.values()];

  // If the 3MF metadata reports a plate count, use it to guide the visual grouping.
  // This avoids showing a separate "plate" for every object when one plate contains
  // several objects spaced far apart.
  if(expectedCount>0 && expectedCount<=units.length && list.length!==expectedCount){
    const k=expectedCount;
    const points=centers.map((c,i)=>({x:c.x,y:c.y,i}));
    const seeds=[];
    const first=points.reduce((a,b)=>(a.x+a.y)<=(b.x+b.y)?a:b);
    seeds.push({x:first.x,y:first.y});
    while(seeds.length<k){
      let best=points[0], bestD=-1;
      points.forEach(pt=>{
        const d=Math.min(...seeds.map(c=>(pt.x-c.x)**2+(pt.y-c.y)**2));
        if(d>bestD){bestD=d;best=pt;}
      });
      seeds.push({x:best.x,y:best.y});
    }
    let assignment=new Array(points.length).fill(0);
    for(let iter=0;iter<12;iter++){
      points.forEach((pt,idx)=>{
        let bi=0,bd=Infinity;
        seeds.forEach((c,ci)=>{const d=(pt.x-c.x)**2+(pt.y-c.y)**2;if(d<bd){bd=d;bi=ci;}});
        assignment[idx]=bi;
      });
      for(let ci=0;ci<k;ci++){
        const pts=points.filter((_,idx)=>assignment[idx]===ci);
        if(pts.length){seeds[ci]={x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length};}
      }
    }
    list=Array.from({length:k},(_,ci)=>units.filter((_,idx)=>assignment[idx]===ci)).filter(g=>g.length);
  }

  list.sort((a,b)=>{
    const ca=clusterBox(a).getCenter(new THREE.Vector3());
    const cb=clusterBox(b).getCenter(new THREE.Vector3());
    return cb.y-ca.y || ca.x-cb.x;
  });
  return list;
}

function clusterBox(units){
  const box=new THREE.Box3();
  units.forEach(u=>box.union(new THREE.Box3().setFromObject(u)));
  return box;
}

function restoreUnits(){
  renderUnits.forEach(u=>{
    const p=basePositions.get(u); if(p) u.position.copy(p);
    u.visible=true;
  });
  modelRoot?.updateMatrixWorld(true);
}

function translateCluster(units,targetX,targetY){
  modelRoot?.updateMatrixWorld(true);
  const box=clusterBox(units);
  const center=box.getCenter(new THREE.Vector3());
  const offset=new THREE.Vector3(targetX-center.x,targetY-center.y,-box.min.z);
  units.forEach(u=>u.position.add(offset));
  modelRoot?.updateMatrixWorld(true);
}

function visibleBox(){
  const box=new THREE.Box3();
  renderUnits.filter(u=>u.visible).forEach(u=>box.union(new THREE.Box3().setFromObject(u)));
  if(box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3(250,250,10));
  return box;
}

function fitVisible(extraLabel=''){
  const box=visibleBox();
  const size=box.getSize(new THREE.Vector3());
  const center=box.getCenter(new THREE.Vector3());
  const maxDim=Math.max(size.x,size.y,size.z,80);
  controls.target.copy(center);
  const distance=maxDim*1.45;
  camera.position.set(center.x+distance*0.85,center.y-distance*1.05,Math.max(center.z+distance*0.8, distance*0.65));
  camera.near=Math.max(0.1,distance/1000);
  camera.far=Math.max(2500,distance*20);
  camera.updateProjectionMatrix();
  controls.update();
  lastFit=()=>{
    controls.target.copy(center);
    camera.position.set(center.x+distance*0.85,center.y-distance*1.05,Math.max(center.z+distance*0.8,distance*0.65));
    controls.update();
  };
  info.textContent=`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm${extraLabel?' · '+extraLabel:''} · arrastrá para rotar · rueda para zoom`;
}

function applyPlateView(plate=0){
  selectedPlateView=Number(plate)||0;
  if(!modelRoot || !clusters.length) return;
  restoreUnits();
  clearBeds();

  if(selectedPlateView>0 && selectedPlateView<=clusters.length){
    clusters.forEach((cluster,i)=>cluster.forEach(u=>u.visible=(i===selectedPlateView-1)));
    const chosen=clusters[selectedPlateView-1];
    translateCluster(chosen,0,0);
    addBed(0,0);
    fitVisible(`Bandeja ${selectedPlateView} de ${clusters.length}`);
    return;
  }

  const count=clusters.length;
  const cols=Math.ceil(Math.sqrt(count));
  const rows=Math.ceil(count/cols);
  clusters.forEach((cluster,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    const x=(col-(cols-1)/2)*PLATE_SPACING;
    const y=((rows-1)/2-row)*PLATE_SPACING;
    translateCluster(cluster,x,y);
    addBed(x,y);
  });
  fitVisible(count>1?`Proyecto completo · ${count} bandejas`:'Bandeja 1');
}

async function loadFile(file) {
  card.classList.remove("hidden");
  loading.classList.remove("hidden");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
  info.textContent = "Cargando modelo…";
  clearModel();

  try {
    const ext = file.name.toLowerCase().split(".").pop();
    const buffer = await file.arrayBuffer();

    if (ext === "stl") {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      modelRoot = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xd77b37, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide
        })
      );
    } else if (ext === "3mf") {
      modelRoot = new ThreeMFLoader().parse(buffer);
      normalizeMaterialVisibility(modelRoot);
    } else {
      throw new Error("La vista 3D solo admite STL y 3MF.");
    }

    scene.add(modelRoot);
    modelRoot.updateMatrixWorld(true);
    collectEditableMaterials(modelRoot);
    renderUnits=prepareRenderUnits(modelRoot);
    modelRoot.updateMatrixWorld(true);
    basePositions=new Map(renderUnits.map(u=>[u,u.position.clone()]));
    clusters=clusterUnits(renderUnits, expectedPlateCount);
    window.dispatchEvent(new CustomEvent('cubica:viewer-plates-ready',{detail:{count:clusters.length}}));
    applyPlateView(selectedPlateView);
  } catch (err) {
    console.error(err);
    errorBox.textContent =
      "No pude mostrar la vista 3D de este archivo. El análisis de slicing puede seguir funcionando igualmente. " +
      (err?.message || "");
    errorBox.classList.remove("hidden");
    info.textContent = "Vista 3D no disponible";
  } finally {
    loading.classList.add("hidden");
  }
}

window.addEventListener("cubica:file-selected", e => {
  selectedPlateView=0;
  if (e.detail?.file) loadFile(e.detail.file);
});
window.addEventListener("cubica:viewer-colors", e => applyViewerColors(e.detail?.colors || []));
window.addEventListener("cubica:plate-view", e => {
  expectedPlateCount=Number(e.detail?.count)||expectedPlateCount||0;
  if(modelRoot && renderUnits.length){
    restoreUnits();
    clusters=clusterUnits(renderUnits, expectedPlateCount);
  }
  applyPlateView(e.detail?.plate || 0);
});

resetBtn.addEventListener("click", () => lastFit?.());

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
