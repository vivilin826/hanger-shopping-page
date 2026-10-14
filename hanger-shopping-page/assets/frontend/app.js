'use strict';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const SHOP=window.SHOP_CONFIG;
const PRODUCTS=SHOP.products.map(p=>({...p,originalName:p.originalName||p.name,english:p.english||'',sideGenerated:true}));
const SUSPENSION=SHOP.suspension.map(s=>({...s,hanger:140,hangerHeight:60,hangerHookY:35,frontIntegrated:true}));
const HANGING_GEOMETRY=SUSPENSION.map(s=>s.side);
const hangingBottom=spec=>Math.max(spec.front.top+spec.front.displayHeight,spec.side.top+spec.side.displayHeight);
const sceneHeight=Math.max(480,...SUSPENSION.map(hangingBottom));
const swayAngle=index=>1+(index%3)*.2;
const swayRoom=index=>(hangingBottom(SUSPENSION[index])-25)*Math.sin(swayAngle(index)*Math.PI/180);
const edgeSpan=Math.max(HANGING_GEOMETRY[0].leftExtent+swayRoom(0),HANGING_GEOMETRY.at(-1).rightExtent+swayRoom(PRODUCTS.length-1));
const pairSpan=Math.max(1,...HANGING_GEOMETRY.slice(0,-1).map((pose,index)=>pose.rightExtent+HANGING_GEOMETRY[index+1].leftExtent+swayRoom(index)+swayRoom(index+1)));
const $ = selector => document.querySelector(selector);
const collection = $('#collection-view');
const detail = $('#detail-view');
const detailStage = $('#detail-stage');
const detailProduct = $('#detail-product');
const rack = $('#garment-rack');
const scene = $('#rack-scene');
const footer = $('#site-footer');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const DISPLAY = PRODUCTS.map((_,index)=>index);
const models = [];
const rackItems = [];
const animations = new Set();
let activeIndex = 0;
let activeView = 'front';
let detailOpen = false;
let mode = 'rack';
let hoverIndex = null;
let focusIndex = null;
let suppressFocus = false;
let selectedInquiry = 0;
let homeScale = 1;
let detailScale = 1;
let slotSpacing = 96;
let motionEpoch = 0;
let pointerStart = null;

// 第二版：衣架先转正，衣身带扭转惯性慢半拍跟随。
// 挂钩摆角只用于邻衣联动；选中款不再施加整件左右摇摆。
const garmentDynamics=[];
let reactionFrame=0;
let reactionTime=0;
let lastRackChoice=null;
const rackPhysics=new RackPhysics();
let clothRenderer=null;
let rackGesture=null;
let rackPreviewIndex=null;
let ignoreHoverUntil=0;
let lastInputTime=0;
let quietTime=0;
let dragClickUntil=0;
function physicsContext(time){
  return {time,scale:homeScale,width:scene.clientWidth,gesture:rackGesture,
    base:PRODUCTS.map((_,i)=>scene.clientWidth/2+(i-(PRODUCTS.length-1)/2)*slotSpacing),
    inRack:i=>models[i].parentElement===rackItems[i],
    measure:(i,state)=>clothRenderer?.measure(i,homeScale)||{
      left:Math.max(HANGING_GEOMETRY[i].leftExtent*homeScale,Math.abs(Math.sin(state.angle*Math.PI/180))*SUSPENSION[i].height*homeScale+20),
      right:Math.max(HANGING_GEOMETRY[i].rightExtent*homeScale,Math.abs(Math.sin(state.angle*Math.PI/180))*SUSPENSION[i].height*homeScale+20)
    }};
}
function springStep(state,key,velocity,target,stiffness,damping,dt){
  state[velocity]+=((target-state[key])*stiffness-state[velocity]*damping)*dt;
  state[key]+=state[velocity]*dt;
  if(Math.abs(state[key]-target)<.008&&Math.abs(state[velocity])<.025){state[key]=target;state[velocity]=0;}
}
function drawReaction(index){
  const state=garmentDynamics[index];
  rackItems[index].style.setProperty('--shift',`${state.x.toFixed(3)}px`);
  state.pivot.style.transform=`rotate(${state.angle.toFixed(3)}deg)`;
  // 两个独立转角：木衣架的回正已完成时，衣身仍保留角度与速度。
  models[index].style.setProperty('--suspension-yaw',`${state.hangerYaw.toFixed(3)}deg`);
  models[index].style.setProperty('--cloth-yaw',`${state.clothYaw.toFixed(3)}deg`);
  const lag=Math.max(-16,Math.min(16,state.clothYaw-state.hangerYaw));
  models[index].style.setProperty('--cloth-torsion',`${(lag*.55).toFixed(3)}deg`);
  const shear=state.targetYaw===0?lag*-.025:0;
  models[index].style.setProperty('--cloth-shear',`${shear.toFixed(3)}deg`);
}
function settleReactions(){
  cancelAnimationFrame(reactionFrame);reactionFrame=0;reactionTime=0;
  garmentDynamics.forEach((state,index)=>{
    state.x=state.target;state.vx=state.angle=state.av=0;
    state.hangerYaw=state.hangerTarget;state.hangerVelocity=0;
    state.clothYaw=state.targetYaw;state.clothVelocity=0;state.clothStart=0;
    drawReaction(index);
  });
  rackPhysics.sleep(garmentDynamics);
  rackPhysics.resolve(garmentDynamics,physicsContext(performance.now()));
  garmentDynamics.forEach((_,i)=>drawReaction(i));
  clothRenderer?.render(collection,mode,rackPreviewIndex??activeIndex);
}
function tickReactions(time){
  if(motionPreference.matches){settleReactions();return;}
  const dt=reactionTime?Math.min((time-reactionTime)/1000,.1):1/60;
  reactionTime=time;
  const steps=Math.max(1,Math.ceil(dt*120)),step=dt/steps;
  for(let n=0;n<steps;n++)rackPhysics.step(garmentDynamics,step,physicsContext(time-dt*1000+(n+1)*step*1000));
  garmentDynamics.forEach((_,i)=>drawReaction(i));
  clothRenderer?.render(collection,mode,rackPreviewIndex??activeIndex);
  const energy=rackPhysics.energy(garmentDynamics);
  quietTime=energy<.16?quietTime+dt:0;
  const travelling=!['rack','detail'].includes(mode);
  if(!rackGesture?.dragged&&!travelling&&(quietTime>.35||time-lastInputTime>4200)){
    rackPhysics.sleep(garmentDynamics);
    rackPhysics.resolve(garmentDynamics,physicsContext(time));
    garmentDynamics.forEach((_,i)=>drawReaction(i));
    clothRenderer?.render(collection,mode,rackPreviewIndex??activeIndex);
    reactionFrame=0;reactionTime=0;return;
  }
  reactionFrame=requestAnimationFrame(tickReactions);
}
function wakeReactions(){
  lastInputTime=performance.now();quietTime=0;
  if(motionPreference.matches){settleReactions();return;}
  if(!reactionFrame){reactionTime=0;reactionFrame=requestAnimationFrame(tickReactions);}
}
function straightenGarment(index,direction=1){
  if(motionPreference.matches)return;
  const state=garmentDynamics[index],now=performance.now();
  // 拖拽原架预览或轻点详情时施加拨正力，随后小幅回摆。
  if(state.hangerYaw>8)state.hangerVelocity=Math.min(state.hangerVelocity,-220);
  state.clothStart=now+80;
  state.clickRockAt=now+260;
  state.clickRockVelocity=direction*16;
  wakeReactions();
}
function nudgeNeighbours(){
  // 邻居由接触约束和碰撞冲量带动，不再按预设顺序播放摆动。
  wakeReactions();
}

function announce(message){ $('#live-status').textContent = message; }
function applySuspension(model,index){
  const spec = SUSPENSION[index];
  model.style.setProperty('--hanger-width',`${spec.hanger}px`);
  model.style.setProperty('--hanger-height',`${spec.hangerHeight}px`);
  model.style.setProperty('--hanger-top',`${25-spec.hanger*(spec.hangerHookY||35)/420}px`);
  // 侧面照片统一以前襟朝右陈列；正面照片保留原始图案方向。
  model.style.setProperty('--hanger-yaw',`${-spec.yaw}deg`);
  model.style.setProperty('--hanger-tilt',`${-(spec.tilt||0)}deg`);
  model.classList.toggle('clip-suspension',!!spec.clip);
  model.classList.toggle('integrated-side',!!PRODUCTS[index].sideGenerated);
  model.classList.toggle('integrated-front',!!spec.frontIntegrated);
  if(PRODUCTS[index].sideGenerated)model.style.setProperty('--hanger-yaw','78deg');
  model.classList.toggle('projected-side',!PRODUCTS[index].side);
  if(!PRODUCTS[index].side)model.style.setProperty('--hanger-yaw','74deg');
  for(const view of ['front','side']){
    const pose = spec[view];
    const height = pose.displayHeight||spec.height;
    const width = height*pose.width/pose.height;
    model.style.setProperty(`--${view}-height`,`${height}px`);
    model.style.setProperty(`--${view}-width`,`${width}px`);
    model.style.setProperty(`--${view}-top`,`${pose.top}px`);
    model.style.setProperty(`--${view}-offset`,`${(.5-pose.anchor)*width}px`);
    model.style.setProperty(`--${view}-origin`,`${pose.anchor*100}% ${25-pose.top}px`);
  }
}
function setView(model,view){
  const previous=model.dataset.view;
  model.classList.toggle('is-front',view==='front');
  model.dataset.view = view;
  const state=garmentDynamics[Number(model.dataset.product)];
  if(state&&previous!==view){
    state.hangerTarget=view==='front'?0:78;
    state.targetYaw=view==='front'?0:76;
    state.clothStart=performance.now()+(view==='front'?110:0);
    if(view==='side'){state.clickRockAt=0;state.clickRockVelocity=0;state.rockUntil=0;}
    wakeReactions();
  }
}
function setStaticDetailView(index,view){
  const model=models[index],state=garmentDynamics[index];
  setView(model,view);
  state.detailStatic=true;
  state.x=state.target=state.vx=state.angle=state.av=0;
  state.hangerYaw=state.hangerTarget;state.hangerVelocity=0;
  state.clothYaw=state.targetYaw;state.clothVelocity=0;state.clothStart=0;
  state.clickRockAt=state.clickRockVelocity=state.rockUntil=0;
  state.mix=view==='front'?1:0;
  rackPhysics.prepare(state);
  state.fabric.forEach(row=>{row.angle=row.av=row.yv=0;row.yaw=state.targetYaw;});
  drawReaction(index);
}
function positionModel(model,host,scale,isHome=false){
  model.style.left = `${host.clientWidth/2-140*scale}px`;
  model.style.top = `${isHome?25*(1-scale):0}px`;
  model.style.transform = `scale(${scale})`;
}
function returnModel(index){
  const model = models[index];
  garmentDynamics[index].detailStatic=false;
  rackItems[index].prepend(model);
  setView(model,'side');
  positionModel(model,rackItems[index],homeScale,true);
}
function restoreOtherModels(keepIndex){
  models.forEach((model,index)=>{if(index!==keepIndex)returnModel(index);});
}
function updateLayout(){
  const viewport=$('#rack-viewport');
  const mobile=window.innerWidth<=700;
  const verticalScale=Math.min(1.02,Math.max(.38,(viewport.clientHeight-36)/sceneHeight));
  const intervals=PRODUCTS.length-1;
  const edgePadding=18;
  const airGap=14;
  const horizontalScale=(viewport.clientWidth*.9-edgePadding*2-intervals*airGap)/(intervals*pairSpan+edgeSpan*2);
  homeScale=mobile?verticalScale:Math.min(verticalScale,Math.max(.28,horizontalScale));
  const comfortableWidth=intervals*(pairSpan*homeScale+airGap)+2*(edgeSpan*homeScale+edgePadding);
  const sceneWidth=mobile?Math.max(viewport.clientWidth*.9,comfortableWidth):viewport.clientWidth*.9;
  const gutter=Math.max(20,(viewport.clientWidth-sceneWidth)/2);
  scene.style.width=`${sceneWidth}px`;
  scene.style.marginLeft=`${gutter}px`;
  scene.style.marginRight=`${gutter}px`;
  slotSpacing=PRODUCTS.length===1?Math.min(280*homeScale,scene.clientWidth):(scene.clientWidth-2*(edgeSpan*homeScale+edgePadding))/(PRODUCTS.length-1);
  rackItems.forEach((item,index)=>{
    item.style.left = `${scene.clientWidth/2+(index-(PRODUCTS.length-1)/2)*slotSpacing}px`;
    item.style.setProperty('--hit-width',`${slotSpacing}px`);
    item.style.height = `${hangingBottom(SUSPENSION[index])*homeScale+36}px`;
    item.style.setProperty('--label-top',`${hangingBottom(SUSPENSION[index])*homeScale+13}px`);
    if(models[index].parentElement===item)positionModel(models[index],item,homeScale,true);
  });
  if(!detail.hidden)detailScale = Math.min(1.18,Math.max(.3,(detailStage.clientHeight-12)/sceneHeight),window.innerWidth/320);
  if(detailOpen && mode==='detail')positionModel(models[activeIndex],detailProduct,detailScale);
  updateRackFocus();
  wakeReactions();
}
function updateRackFocus(){
  const chosen=mode==='rack'?(rackGesture?.dragged&&rackGesture.index!==null?rackGesture.index:(hoverIndex??focusIndex)):
    (['opening','detail','switching'].includes(mode)?activeIndex:null);
  const viewing=mode==='rack'?rackPreviewIndex:(['opening','detail','switching'].includes(mode)?activeIndex:null);
  const changed=viewing!==lastRackChoice;
  rackItems.forEach((item,index)=>{
    const selected=index===chosen;
    const distance=viewing===null?0:Math.abs(index-viewing);
    const spread=viewing===null||index===viewing?0:Math.sign(index-viewing)*Math.min(58,slotSpacing*.58)/(1+(distance-1)*.42);
    garmentDynamics[index].target=spread;
    const preview=mode==='rack'&&index===rackPreviewIndex;
    const pose=SUSPENSION[index].front;
    const frontWidth=(pose.displayHeight||SUSPENSION[index].height)*pose.width/pose.height*homeScale;
    item.style.setProperty('--active-width',`${preview?Math.max(slotSpacing,frontWidth+12):slotSpacing}px`);
    item.classList.toggle('is-selected',(selected||preview)&&mode==='rack');
    if(models[index].parentElement===item)setView(models[index],preview?'front':'side');
  });
  if(changed&&viewing!==null)nudgeNeighbours(viewing);
  lastRackChoice=viewing;
  // 悬停和键盘焦点只显示品名，保持侧挂并且不唤醒受力模拟。
  if(changed||mode!=='rack'||rackGesture?.dragged)wakeReactions();
}
function clearRackPreview(){
  if(rackPreviewIndex===null)return;
  rackPreviewIndex=null;hoverIndex=null;focusIndex=null;
  updateRackFocus();
  announce('已恢复侧挂全景。');
}
DISPLAY.forEach((index,i)=>{
  const product = PRODUCTS[index];
  const item = document.createElement('button');
  item.className = 'rack-item';
  item.dataset.product = index;
  item.style.setProperty('--layer',String(i+1));
  item.setAttribute('aria-label',`${escapeHTML(product.name)}，查看详情`);
  const model = document.createElement('span');
  model.className = 'garment-model';
  model.dataset.product = index;
  model.setAttribute('aria-hidden','true');
  model.style.setProperty('--breeze',`${6.6+(i%4)*.55+(SUSPENSION[index].height>350?.8:0)}s`);
  model.style.setProperty('--sway',`${swayAngle(i)}deg`);
  model.style.setProperty('--delay',`${-i*1.37}s`);
  model.innerHTML = `<span class="garment-reaction"><span class="garment-pose"><span class="garment-turn"><img class="hanger" src="assets/${SUSPENSION[index].hangerAsset||(SUSPENSION[index].clip?'clip-hanger':'hanger')}.svg" alt="" draggable="false"><img class="garment-image garment-side" src="${product.side||product.front}" alt="" draggable="false"><img class="garment-image garment-front" src="${product.front}" alt="" draggable="false"></span></span></span>`;
  applySuspension(model,index);
  const label = document.createElement('span');
  label.className = 'product-tag';
  label.innerHTML = `${escapeHTML(product.name)}<small>${escapeHTML(product.english)}</small>`;
  item.append(model,label);
  item.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&mode==='rack'&&!rackGesture?.dragged&&performance.now()>ignoreHoverUntil){hoverIndex=index;updateRackFocus();}});
  item.addEventListener('pointerleave',()=>{if(hoverIndex===index&&!rackGesture?.dragged){hoverIndex=null;updateRackFocus();}});
  item.addEventListener('focus',()=>{if(!suppressFocus&&item.matches(':focus-visible')){focusIndex=index;updateRackFocus();}});
  item.addEventListener('blur',()=>{if(focusIndex===index){focusIndex=null;updateRackFocus();}});
  item.addEventListener('click',e=>{if(performance.now()<dragClickUntil){e.preventDefault();return;}openDetail(index);});
  rack.appendChild(item);
  rackItems.push(item);
  models.push(model);
  garmentDynamics.push({x:0,vx:0,target:0,angle:0,av:0,
    weight:SUSPENSION[index].height>350?.86:1,
    hangerYaw:78,hangerVelocity:0,hangerTarget:78,
    clothYaw:76,clothVelocity:0,targetYaw:76,clothStart:0,
    pivot:model.querySelector('.garment-reaction')});
  for(const view of ['front','side']){if(product[view]){const image=new Image();image.src=product[view];}}
});

// 一套网格材质渲染器，沿肩部→衣摆分六段跟随；无需GLB或额外服装模型。
try {clothRenderer=new RackClothRenderer(models,SUSPENSION,garmentDynamics,rackItems,$('#rack-viewport'),wakeReactions);}
catch(error){console.warn('布料网格不可用，保留静态服装图片。',error);}
const rackViewport=$('#rack-viewport');
rackViewport.addEventListener('pointerdown',e=>{
  if(mode!=='rack'||e.button>0||!e.isPrimary)return;
  const button=e.target.closest('.rack-item');
  rackGesture={id:e.pointerId,index:button?Number(button.dataset.product):null,start:e.clientX,startY:e.clientY,last:e.clientX,
    lastTime:performance.now(),velocity:0,dx:0,dragged:false,pan:!button&&innerWidth<=700,startScroll:rackViewport.scrollLeft,origins:garmentDynamics.map(s=>s.x)};
  rackViewport.setPointerCapture(e.pointerId);
});
rackViewport.addEventListener('pointermove',e=>{
  const g=rackGesture;if(!g||g.id!==e.pointerId)return;
  const now=performance.now(),elapsed=Math.max(8,now-g.lastTime),delta=e.clientX-g.last;
  g.velocity=g.velocity*.45+delta/elapsed*1000*.55;g.last=e.clientX;g.lastTime=now;
  const distance=g.index===null?Math.abs(e.clientX-g.start):Math.hypot(e.clientX-g.start,e.clientY-g.startY);
  if(!g.dragged&&distance>6){
    g.dragged=true;collection.classList.add('is-dragging');
    if(g.index!==null)rackPreviewIndex=g.index;
    updateRackFocus();
    if(g.index!==null){
      straightenGarment(g.index,e.clientX<g.start?-1:1);
      announce(`${PRODUCTS[g.index].name}，在衣架上拨正预览；轻点可查看详情。`);
    }
  }
  if(!g.dragged)return;
  e.preventDefault();g.dx=g.pan?0:e.clientX-g.start;
  if(g.pan){rackViewport.scrollLeft=g.startScroll-(e.clientX-g.start);garmentDynamics.forEach(s=>{s.av-=delta*.045;});}

  if(motionPreference.matches){
    garmentDynamics.forEach((s,i)=>{if(g.index===null||g.index===i)s.x=g.origins[i]+g.dx;});
    rackPhysics.resolve(garmentDynamics,physicsContext(now));
    garmentDynamics.forEach((_,i)=>drawReaction(i));clothRenderer?.render(collection,mode,rackPreviewIndex??activeIndex);
  }else wakeReactions();
});
function releaseRackGesture(cancelled=false){
  const g=rackGesture;if(!g)return;rackGesture=null;collection.classList.remove('is-dragging');
  if(!g.dragged){
    if(!cancelled&&g.index!==null){dragClickUntil=performance.now()+100;openDetail(g.index);}
    else if(!cancelled)clearRackPreview();
    return;
  }
  dragClickUntil=performance.now()+450;ignoreHoverUntil=performance.now()+450;
  if(cancelled&&rackPreviewIndex===g.index)rackPreviewIndex=null;
  if(!cancelled&&!motionPreference.matches){
    const stale=performance.now()-g.lastTime>100;
    const velocity=stale?0:Math.max(-950,Math.min(950,g.velocity));
    garmentDynamics.forEach((s,i)=>{
      if(g.index===null||g.index===i){s.vx=Math.max(-1000,Math.min(1000,s.vx+velocity*.6));s.av-=velocity*.009/Math.max(.3,homeScale);}
    });
  }
  hoverIndex=null;focusIndex=null;updateRackFocus();
  announce(rackPreviewIndex===null?'已松手，衣架与衣物随余力停稳。':'已松手，保留原架正面预览；轻点衣服查看详情，点空白处恢复侧挂。');
}
rackViewport.addEventListener('pointerup',()=>releaseRackGesture());
rackViewport.addEventListener('pointercancel',()=>releaseRackGesture(true));
rackViewport.addEventListener('lostpointercapture',()=>releaseRackGesture(true));
rackViewport.addEventListener('scroll',()=>clothRenderer?.render(collection,mode,rackPreviewIndex??activeIndex),{passive:true});

// 同一个服装节点从衣架移到前景，返回时再放回自己的槽位。
// 所有新动作取消上一段动画，异步完成回调用 epoch 防止覆盖新状态。
function cancelMotion(){
  motionEpoch++;
  animations.forEach(animation=>animation.cancel());
  animations.clear();
  return motionEpoch;
}
function animate(model,keyframes,duration=560){
  if(motionPreference.matches)return null;
  const animation=model.animate(keyframes,{duration,easing:'cubic-bezier(.22,.72,.24,1)',fill:'both'});
  animations.add(animation);
  return animation;
}
async function settle(list){
  await Promise.allSettled(list.filter(Boolean).map(animation=>animation.finished));
}
function release(list){
  list.filter(Boolean).forEach(animation=>{animation.cancel();animations.delete(animation);});
}
function renderProduct(){
  const product=PRODUCTS[activeIndex];
  $('#detail-name').textContent=product.name;
  $('#detail-english').textContent=[product.english,product.priceText].filter(Boolean).join(' · ');
  $('#detail-number').innerHTML=`${String(activeIndex+1).padStart(2,'0')} <i>/</i> ${String(PRODUCTS.length).padStart(2,'0')}`;
  ['front','side'].forEach(view=>{
    $(`#${view}-view`).classList.toggle('active',activeView===view);
    $(`#${view}-view`).setAttribute('aria-pressed',String(activeView===view));
  });
  $('#side-view').disabled=!product.side;
  $('#side-view').innerHTML=product.sideGenerated?'侧挂 <small>HANGING</small>':(product.side?'侧面 <small>SIDE</small>':'侧面待补');
  setStaticDetailView(activeIndex,activeView);
  announce(`第 ${activeIndex+1} 款，共 ${PRODUCTS.length} 款。${escapeHTML(product.name)}，${activeView==='front'?'正面':'自然侧挂'}`);
}
async function openDetail(index){
  if(mode!=='rack')return;
  const epoch=cancelMotion();
  const model=models[index];
  const from=model.getBoundingClientRect();
  activeIndex=index;
  rackPreviewIndex=null;
  activeView='front';
  detailOpen=true;
  mode='opening';
  nudgeNeighbours(index,1.1);
  detail.hidden=false;
  detail.setAttribute('aria-hidden','false');
  detail.classList.remove('is-leaving');
  $('#detail-footer-mount').appendChild(footer);
  detailProduct.appendChild(model);
  updateLayout();
  positionModel(model,detailProduct,detailScale);
  const to=model.getBoundingClientRect();
  const flight=animate(model,[
    {transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/280})`},
    {transform:`translate(0,0) scale(${detailScale})`}
  ]);
  renderProduct();
  hoverIndex=null;
  focusIndex=null;
  updateRackFocus();
  document.body.classList.add('detail-open');
  collection.inert=true;
  collection.setAttribute('aria-hidden','true');
  $('.site-header').inert=true;
  $('#detail-name').focus({preventScroll:true});
  await settle([flight]);
  if(epoch!==motionEpoch)return;
  release([flight]);
  mode='detail';
}
function homeRect(index){
  const bounds=scene.getBoundingClientRect();
  return {left:bounds.left+scene.clientWidth/2+(index-(PRODUCTS.length-1)/2)*slotSpacing-140*homeScale,top:bounds.top+25*(1-homeScale)};
}
function revealHomeSlot(index){
  const viewport=$('#rack-viewport');
  const bounds=viewport.getBoundingClientRect();
  const center=homeRect(index).left+140*homeScale;
  if(center<bounds.left+80||center>bounds.right-80)viewport.scrollLeft+=center-bounds.left-bounds.width/2;
}
async function closeDetail(){
  if(!detailOpen||mode==='closing')return;
  const model=models[activeIndex];
  const from=model.getBoundingClientRect();
  const epoch=cancelMotion();
  restoreOtherModels(activeIndex);
  mode='closing';
  garmentDynamics[activeIndex].detailStatic=false;
  detailOpen=false;
  hoverIndex=null;
  focusIndex=null;
  updateRackFocus();
  revealHomeSlot(activeIndex);
  positionModel(model,detailProduct,detailScale);
  const base=model.getBoundingClientRect();
  const to=homeRect(activeIndex);
  detail.classList.add('is-leaving');
  document.body.classList.remove('detail-open');
  setView(model,'side');
  const flight=animate(model,[
    {transform:`translate(${from.left-base.left}px,${from.top-base.top}px) scale(${from.width/280})`,opacity:1},
    {transform:`translate(${to.left-base.left}px,${to.top-base.top}px) scale(${homeScale})`,opacity:1}
  ]);
  await settle([flight]);
  if(epoch!==motionEpoch)return;
  returnModel(activeIndex);
  release([flight]);
  detail.hidden=true;
  detail.setAttribute('aria-hidden','true');
  detail.classList.remove('is-leaving');
  $('#footer-mount').appendChild(footer);
  collection.inert=false;
  collection.removeAttribute('aria-hidden');
  $('.site-header').inert=false;
  mode='rack';
  suppressFocus=true;
  rackItems[activeIndex].focus({preventScroll:true});
  suppressFocus=false;
  announce(`已返回衣架全景。${PRODUCTS[activeIndex].name}`);
}
async function switchProduct(index,direction){
  if(mode!=='detail'&&mode!=='switching')return;
  index=(index+PRODUCTS.length)%PRODUCTS.length;
  if(index===activeIndex)return;
  const previousIndex=activeIndex;
  const previous=models[previousIndex];
  const from=previous.getBoundingClientRect();
  const epoch=cancelMotion();
  restoreOtherModels(previousIndex);
  mode='switching';
  direction=direction??(index>activeIndex?1:-1);
  activeIndex=index;
  activeView='front';
  const current=models[index];
  detailProduct.appendChild(current);
  positionModel(previous,detailProduct,detailScale);
  positionModel(current,detailProduct,detailScale);
  const base=previous.getBoundingClientRect();
  renderProduct();
  updateRackFocus();
  const outgoing=animate(previous,[
    {transform:`translate(${from.left-base.left}px,${from.top-base.top}px) scale(${from.width/280})`,opacity:1},
    {transform:`translate(${-direction*60}px,0) scale(${detailScale*.98})`,opacity:0}
  ],300);
  const incoming=animate(current,[
    {transform:`translate(${direction*60}px,0) scale(${detailScale*.98})`,opacity:0},
    {transform:`translate(0,0) scale(${detailScale})`,opacity:1}
  ],380);
  await settle([outgoing,incoming]);
  if(epoch!==motionEpoch)return;
  returnModel(previousIndex);
  release([outgoing,incoming]);
  mode='detail';
}
function switchView(view){
  if(!detailOpen||mode==='opening'||mode==='closing'||activeView===view)return;
  if(view==='side'&&!PRODUCTS[activeIndex].side)return;
  activeView=view;
  renderProduct();
}
$('#previous-product').addEventListener('click',()=>switchProduct(activeIndex-1,-1));
$('#next-product').addEventListener('click',()=>switchProduct(activeIndex+1,1));
$('#front-view').addEventListener('click',()=>switchView('front'));
$('#side-view').addEventListener('click',()=>switchView('side'));
$('#detail-close-button').addEventListener('click',closeDetail);
$('.brand').addEventListener('click',e=>{e.preventDefault();closeDetail();});

// 全景横向滑动衣架，轻点进入；详情横滑切款，纵向触摸交给浏览器。
detailStage.addEventListener('pointerdown',e=>{
  if(e.target.closest('button')||e.button>0||!e.isPrimary)return;
  pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId};
  detailStage.setPointerCapture(e.pointerId);
});
detailStage.addEventListener('pointerup',e=>{
  if(!pointerStart||e.pointerId!==pointerStart.id)return;
  const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;
  pointerStart=null;
  if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3)switchProduct(activeIndex+(dx<0?1:-1),dx<0?1:-1);
});
detailStage.addEventListener('pointercancel',()=>pointerStart=null);
detailStage.addEventListener('lostpointercapture',()=>pointerStart=null);
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'&&mode==='rack'&&rackPreviewIndex!==null){e.preventDefault();clearRackPreview();return;}
  if(!detailOpen)return;
  if(e.key==='ArrowLeft'){e.preventDefault();switchProduct(activeIndex-1,-1);}
  if(e.key==='ArrowRight'){e.preventDefault();switchProduct(activeIndex+1,1);}
  if(e.key==='Escape'){e.preventDefault();closeDetail();}
  if(e.key==='Tab'){
    const controls=[...detail.querySelectorAll('button:not([disabled])')].filter(button=>button.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('#detail-name'))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});

PRODUCTS.forEach((product,index)=>{
  const item=document.createElement('button');
  item.className='availability-item';
  item.dataset.index=index;
  item.setAttribute('aria-pressed','false');
  item.innerHTML=`<img src="${product.front}" alt=""><span><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML([product.english,product.priceText].filter(Boolean).join(' · '))}</small></span><i class="selection-circle" aria-hidden="true"></i>`;
  item.addEventListener('click',()=>selectInquiry(index));
  $('#availability-list').appendChild(item);
});
const INFO={
 about:{eyebrow:'ABOUT / 关于',title:SHOP.brand.name,html:'<p>'+escapeHTML(SHOP.brand.about||SHOP.brand.slogan||'慢慢挑选喜欢的那一件。')+'</p>'},
 contact:{eyebrow:'CONTACT / 联系',title:'咨询这件服装',html:'<p>'+escapeHTML(SHOP.brand.contact||'联系方式暂未提供，可先复制款式信息。')+'</p>'}
};
function openInfo(key){const data=INFO[key];$('#dialog-eyebrow').textContent=data.eyebrow;$('#dialog-title').textContent=data.title;$('#dialog-content').innerHTML=data.html;$('#info-dialog').showModal();}
$('#about-button').addEventListener('click',()=>openInfo('about'));
$('#contact-button').addEventListener('click',()=>openInfo('contact'));
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();});
});
function selectInquiry(index){
  selectedInquiry=index;
  document.querySelectorAll('.availability-item').forEach((item,i)=>{item.classList.toggle('active',i===index);item.setAttribute('aria-pressed',String(i===index));});
  $('#availability-status').textContent=`已选择：${PRODUCTS[index].name}`;
  $('.inquiry-fallback')?.remove();
  $('#copy-inquiry').innerHTML='复制询款信息 <span aria-hidden="true">↗</span>';
}
$('#availability-button').addEventListener('click',()=>{if(SHOP.brand.storeUrl){window.open(SHOP.brand.storeUrl,'_blank','noopener,noreferrer');return;}selectInquiry(detailOpen?activeIndex:(rackPreviewIndex??selectedInquiry));$('#availability-dialog').showModal();});
$('#copy-inquiry').addEventListener('click',async()=>{
  const product=PRODUCTS[selectedInquiry];
  const text=`你好，我想咨询「${product.name}」\n款式：${product.originalName}\n请问目前有哪些尺码及库存？谢谢。`;
  try{
    if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    $('#copy-inquiry').textContent='已复制 ✓';
    $('#availability-status').textContent='询款信息已复制，可以发送给店主。';
  }catch{
    $('.inquiry-fallback')?.remove();
    const field=document.createElement('textarea');field.className='inquiry-fallback';field.setAttribute('aria-label','询款信息，长按或全选复制');field.readOnly=true;field.value=text;$('#copy-inquiry').after(field);field.focus();field.select();$('#availability-status').textContent='请全选并复制上方询款信息。';
  }
});


let resizeFrame;
window.addEventListener('resize',()=>{
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{
    if(mode==='opening'||mode==='switching'){
      cancelMotion();
      restoreOtherModels(activeIndex);
      mode='detail';
    }else if(mode==='closing'){
      // 关闭中的目标坐标随视口变化重算。
      mode='detail';
      detailOpen=true;
      updateLayout();
      closeDetail();
      return;
    }
    updateLayout();
  });
});
motionPreference.addEventListener('change',()=>{
  if(motionPreference.matches)settleReactions();
  if(mode==='opening'||mode==='switching'){
    cancelMotion();restoreOtherModels(activeIndex);mode='detail';updateLayout();
  }
});
updateLayout();

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){cancelAnimationFrame(reactionFrame);reactionFrame=0;reactionTime=0;}
  else wakeReactions();
});

window.addEventListener('scroll',()=>clothRenderer?.render(collection,mode,rackPreviewIndex??activeIndex),{passive:true});

// 用户展示信息只用文本写入，价格缺省隐藏，单款隐藏切款箭头。
document.title=SHOP.brand.name+' · 衣架购物';
$('.brand-word').textContent=SHOP.brand.name;
$('.brand-caption').textContent=SHOP.brand.slogan||'';
$('.brand').setAttribute('aria-label',SHOP.brand.name+'，返回衣架全景');
$('#collection-title').textContent=SHOP.brand.name+' · '+PRODUCTS.length+'款服装';
$('#rack-scene').setAttribute('aria-label',PRODUCTS.length+'款服装，拖拽预览，轻点详情');
$('#detail-number').innerHTML='01 <i>/</i> '+String(PRODUCTS.length).padStart(2,'0');
$('.footer-side').textContent=PRODUCTS.length+' PIECE'+(PRODUCTS.length>1?'S':'');
$('#availability-button').textContent=SHOP.brand.ctaLabel||'查看款式';
if(PRODUCTS.length===1){$('#previous-product').hidden=true;$('#next-product').hidden=true;}
