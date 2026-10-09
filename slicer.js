(() => {
  const $s = id => document.getElementById(id);
  const els = {
    file: $s('slicer-file'), drop: $s('slicer-drop'), filename: $s('slicer-filename'), profile: $s('slicer-profile'),
    analyze: $s('slicer-analyze'), status: $s('slicer-status'), message: $s('slicer-message'), result: $s('slicer-result'),
    supports: $s('slicer-supports'), supportText: $s('slicer-support-text'), apply: $s('slicer-apply-budget'),
    platePanel: $s('slicer-plate-panel'), plateSelect: $s('slicer-plate-select'), plateBreakdown: $s('slicer-plate-breakdown')
  };
  if (!els.file) return;

  const HAS_SLICER_BACKEND = !!String(window.CUBICA_CONFIG?.slicerApiBase || '').trim();
  const apiUrl = path => window.cubicaSlicerApiUrl ? window.cubicaSlicerApiUrl(path) : path;
  let selectedFile = null;
  let ironingMode = 'none';
  let materialMode = 'PLA';
  let modelColors = ['#F2754E'];
  let lastData = null;
  let projectPlates = [{plate:1,name:'Bandeja 1'}];

  function setMessage(text, error=false){
    els.message.textContent = text;
    els.message.classList.remove('hidden');
    els.message.classList.toggle('error', error);
  }
  function hideMessage(){ els.message.classList.add('hidden'); }
  function updateButton(){ els.analyze.disabled = !HAS_SLICER_BACKEND || !selectedFile || !els.profile.value; }

  async function loadStatus(){
    if(!HAS_SLICER_BACKEND){
      els.status.textContent='● Vista 3D disponible · slicing requiere backend';
      els.status.classList.add('ready');
      els.profile.innerHTML='<option value="github-static">Kobra S1 · backend no configurado</option>';
      els.analyze.title='GitHub Pages no puede ejecutar OrcaSlicer. Configurá slicerApiBase para habilitar el análisis.';
      updateButton();
      return;
    }
    try{
      const r = await fetch(apiUrl('/api/status'));
      const data = await r.json();
      els.status.textContent = data.orca_found ? '● Motor listo' : '○ Falta configurar el motor';
      els.status.classList.toggle('ready', !!data.orca_found);
      els.status.classList.toggle('error', !data.orca_found);
      els.profile.innerHTML = '';
      (data.profiles || []).forEach(p => {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.name || p.id;
        if (p.id === data.default_profile) o.selected = true;
        els.profile.appendChild(o);
      });
      if (!(data.profiles || []).length){
        const o=document.createElement('option'); o.textContent='No hay perfiles'; els.profile.appendChild(o);
      }
      updateButton();
    }catch(err){
      els.status.textContent='Servidor del slicer no disponible'; els.status.classList.add('error');
      setMessage('No se pudo conectar con el backend del slicer.', true);
    }
  }

  function renderPlateSelector(plates){
    projectPlates = (plates && plates.length ? plates : [{plate:1,name:'Bandeja 1'}]);
    if(!els.plateSelect) return;
    const multiple = projectPlates.length > 1;
    els.platePanel?.classList.toggle('hidden', !multiple);
    els.plateSelect.innerHTML = `<option value="0">Proyecto completo (${projectPlates.length} bandejas)</option>` +
      projectPlates.map(p=>`<option value="${p.plate}">${p.name || `Bandeja ${p.plate}`}</option>`).join('');
    els.plateSelect.value = '0';
    window.dispatchEvent(new CustomEvent('cubica:plate-view',{detail:{plate:0,count:projectPlates.length}}));
  }

  async function inspectFile(file){
    const ext=file.name.toLowerCase().split('.').pop();
    if(ext==='stl' || !HAS_SLICER_BACKEND){ renderPlateSelector([{plate:1,name:'Bandeja 1'}]); return; }
    try{
      const form=new FormData(); form.append('file',file);
      const r=await fetch(apiUrl('/api/inspect'),{method:'POST',body:form});
      const data=await r.json();
      if(r.ok && data.ok) renderPlateSelector(data.plates||[]);
      else renderPlateSelector([{plate:1,name:'Bandeja 1'}]);
    }catch{ renderPlateSelector([{plate:1,name:'Bandeja 1'}]); }
  }

  function chooseFile(file){
    if(!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if(!['stl','3mf'].includes(ext)){ setMessage('Solo se admiten archivos STL y 3MF.', true); return; }
    selectedFile = file;
    els.filename.textContent = file.name;
    els.result.classList.add('hidden'); hideMessage(); updateButton();
    window.dispatchEvent(new CustomEvent('cubica:file-selected', {detail:{file}}));
    inspectFile(file);
  }

  els.file.addEventListener('change', ()=>chooseFile(els.file.files[0]));
  ['dragenter','dragover'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove('drag')}));
  els.drop.addEventListener('drop', e=>chooseFile(e.dataTransfer.files[0]));
  els.profile.addEventListener('change', updateButton);
  els.plateSelect?.addEventListener('change',()=>{
    const plate=Number(els.plateSelect.value)||0;
    window.dispatchEvent(new CustomEvent('cubica:plate-view',{detail:{plate,count:projectPlates.length}}));
    els.result.classList.add('hidden');
  });
  els.supports.addEventListener('change', ()=>{
    els.supportText.textContent = els.supports.checked ? 'Activados' : 'Desactivados';
    els.result.classList.add('hidden');
  });
  document.querySelectorAll('[data-slicer-ironing]').forEach(btn=>btn.addEventListener('click',()=>{
    ironingMode = btn.dataset.slicerIroning;
    document.querySelectorAll('[data-slicer-ironing]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); els.result.classList.add('hidden');
  }));

  document.querySelectorAll('[data-slicer-material]').forEach(btn=>btn.addEventListener('click',()=>{
    materialMode = btn.dataset.slicerMaterial;
    document.querySelectorAll('[data-slicer-material]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    els.result.classList.add('hidden');
  }));

  function normalizeHex(color){
    let c=String(color||'').trim();
    if(!c) return '#F2754E';
    if(!c.startsWith('#')) c='#'+c;
    if(/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
    return '#F2754E';
  }
  function renderColorControls(colors){
    modelColors=(colors&&colors.length?colors:['#F2754E']).slice(0,8).map(normalizeHex);
    const box=$s('slicer-color-controls');
    box.innerHTML=modelColors.map((c,i)=>`<label class="slicer-color-picker" title="Color ${i+1}"><input type="color" value="${c}" data-color-index="${i}"><span style="background:${c}"></span><small>${modelColors.length>1?`Color ${i+1}`:'Color'}</small></label>`).join('');
    box.querySelectorAll('input[type=color]').forEach(input=>input.addEventListener('input',()=>{
      const i=Number(input.dataset.colorIndex); modelColors[i]=input.value.toUpperCase();
      input.nextElementSibling.style.background=input.value;
      window.dispatchEvent(new CustomEvent('cubica:viewer-colors',{detail:{colors:modelColors}}));
      els.result.classList.add('hidden');
    }));
  }
  function parseMetricColors(raw){
    return String(raw||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean).map(normalizeHex);
  }
  function renderResultColors(colors){
    const box=$s('slicer-color');
    const list=(colors&&colors.length?colors:['#F2754E']).map(normalizeHex);
    box.innerHTML=list.map((c,i)=>`<span class="slicer-result-swatch" title="Color ${i+1}" style="background:${c}"></span>`).join('');
  }
  window.addEventListener('cubica:model-colors-ready',e=>renderColorControls(e.detail?.colors||[]));
  renderColorControls(modelColors);

  function parseTimeToHours(str){
    if(!str) return 0;
    const days = Number((str.match(/(\d+(?:\.\d+)?)\s*d/i)||[])[1]||0);
    const hours = Number((str.match(/(\d+(?:\.\d+)?)\s*h/i)||[])[1]||0);
    const mins = Number((str.match(/(\d+(?:\.\d+)?)\s*m/i)||[])[1]||0);
    const secs = Number((str.match(/(\d+(?:\.\d+)?)\s*s/i)||[])[1]||0);
    return days*24 + hours + mins/60 + secs/3600;
  }

  function syncBudgetMaterial(material){
    const select=$s('budget-material'); if(!select) return;
    const target=String(material||'').toUpperCase();
    const options=[...select.options];
    const found=options.find(o=>o.textContent.toUpperCase().includes(target));
    if(found) select.selectedIndex=found.index;
  }

  function applyToBudget(data, showToast=true){
    const m = data?.metrics || {};
    const grams = Number(m.filament_grams);
    const hours = parseTimeToHours(m.time);
    if(Number.isFinite(grams) && grams>0) $s('budget-weight').value = grams.toFixed(2);
    if(hours>0) $s('budget-time').value = hours.toFixed(2);
    syncBudgetMaterial(data?.material);
    if(typeof window.calculateBudget === 'function') window.calculateBudget();
    else if(typeof calculateBudget === 'function') calculateBudget();
    if(showToast && typeof toast === 'function') toast('Peso y tiempo del slicer aplicados al presupuesto');
  }

  function showResult(data){
    lastData = data;
    const m=data.metrics||{};
    $s('slicer-result-name').textContent=data.filename||'Modelo';
    $s('slicer-printer').textContent=data.printer||'Anycubic Kobra S1';
    $s('slicer-time').textContent=m.time||'No disponible';
    const labels={silent:'modo silencioso',normal:'modo normal',total:'total',generic:'',combined:'suma de bandejas'};
    $s('slicer-time-mode').textContent=m.time_mode&&labels[m.time_mode]?`Usando ${labels[m.time_mode]}`:'';
    $s('slicer-grams').textContent=m.filament_grams!=null?`${Number(m.filament_grams).toFixed(2)} g`:'No disponible';
    $s('slicer-material').textContent=data.material||m.filament_type||m.filament_name||'No disponible';
    const metricColors=parseMetricColors(m.filament_color);
    renderResultColors(modelColors.length ? modelColors : metricColors);
    $s('slicer-supports-used').textContent=data.supports?'Activados':'Desactivados';
    const ironingLabels={none:'Sin alisado',topmost:'Solo superficie superior',top:'Todas las superficies superiores'};
    $s('slicer-ironing-used').textContent=ironingLabels[data.ironing]||'Sin alisado';
    $s('slicer-time-silent').textContent=m.time_silent||'No disponible';
    const plates=data.plates||[];
    if(els.plateBreakdown){
      if(plates.length>1){
        els.plateBreakdown.classList.remove('hidden');
        els.plateBreakdown.innerHTML=`<div class="slicer-plate-breakdown-head"><strong>Detalle por bandeja</strong><small>El total de arriba suma todas las bandejas analizadas.</small></div><div class="slicer-plate-cards">${plates.map(p=>{const pm=p.metrics||{};return `<div class="slicer-plate-card"><span>Bandeja ${p.plate}</span><strong>${pm.time||'—'}</strong><small>${pm.filament_grams!=null?Number(pm.filament_grams).toFixed(2)+' g':'—'}</small></div>`}).join('')}</div>`;
      } else {
        els.plateBreakdown.classList.add('hidden'); els.plateBreakdown.innerHTML='';
      }
    }
    els.result.classList.remove('hidden');
    applyToBudget(data, true);
  }

  els.analyze.addEventListener('click', async()=>{
    if(!HAS_SLICER_BACKEND){setMessage('GitHub Pages no puede ejecutar OrcaSlicer. La vista 3D funciona, pero el cálculo real necesita un backend externo o un motor WASM en el navegador.',true);return;}
    if(!selectedFile) return;
    els.analyze.disabled=true; els.analyze.textContent='Procesando…';
    setMessage('Ejecutando slicing real. En Raspberry Pi 3 puede tardar bastante más que en una PC.');
    els.result.classList.add('hidden');
    const form=new FormData();
    form.append('file',selectedFile); form.append('profile',els.profile.value);
    form.append('supports',els.supports.checked?'1':'0'); form.append('ironing',ironingMode);
    form.append('material',materialMode); form.append('colors',modelColors.join(';'));
    form.append('plate', els.plateSelect ? els.plateSelect.value : '0');
    try{
      const r=await fetch(apiUrl('/api/analyze'),{method:'POST',body:form});
      const data=await r.json();
      if(!r.ok||!data.ok){
        let msg=data.error||'Error desconocido'; if(data.details) msg+='\n\n'+data.details; setMessage(msg,true); return;
      }
      hideMessage(); showResult(data);
    }catch(err){ setMessage('No se pudo conectar con el backend: '+err.message,true); }
    finally{ els.analyze.textContent='Analizar impresión'; updateButton(); }
  });
  els.apply.addEventListener('click',()=>lastData&&applyToBudget(lastData,true));
  loadStatus();
})();
