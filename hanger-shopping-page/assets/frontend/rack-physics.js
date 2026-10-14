(function(root){
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function spring(s,key,velocity,target,k,c,dt){
    s[velocity]+=((target-s[key])*k-s[velocity]*c)*dt;
    s[key]+=s[velocity]*dt;
  }
  class RackPhysics{
    constructor(){this.contacts=0;this.lastMotion=0;this.stillTime=0;}
    prepare(s){
      if(!s.fabric)s.fabric=Array.from({length:6},()=>({angle:0,av:0,yaw:s.clothYaw,yv:0}));
      if(s.mix===undefined)s.mix=s.targetYaw===0?1:0;
    }
    step(states,dt,ctx){
      states.forEach((s,i)=>{
        this.prepare(s);
        if(s.detailStatic)return;
        const held=ctx.gesture?.dragged&&(ctx.gesture.index===i||ctx.gesture.index===null);
        const target=held?ctx.gesture.origins[i]+ctx.gesture.dx:s.target;
        spring(s,'x','vx',target,held?640:66,held?42:12.8,dt);
        s.vx=clamp(s.vx,-1000,1000);
        const lean=clamp(-s.vx/Math.max(.25,ctx.scale)*.007,-4.5,4.5);
        if(s.clickRockAt&&ctx.time>=s.clickRockAt){
          s.av+=s.clickRockVelocity||0;s.clickRockAt=0;s.clickRockVelocity=0;s.rockUntil=ctx.time+1500;
        }
        const clickRock=ctx.time<(s.rockUntil||0);
        spring(s,'angle','av',lean,clickRock?30:34,clickRock?5.6:8.6,dt);
        s.angle=clamp(s.angle,-5.2,5.2);s.av=clamp(s.av,-35,35);
        spring(s,'hangerYaw','hangerVelocity',s.hangerTarget,420,40,dt);
        if(ctx.time>=s.clothStart)spring(s,'clothYaw','clothVelocity',s.targetYaw,52*(s.weight||1),9.2,dt);
        s.mix+=(s.targetYaw===0?1-s.mix:-s.mix)*(1-Math.exp(-23*dt));
        s.fabric.forEach((row,j)=>{
          const above=j?s.fabric[j-1]:{angle:s.angle,yaw:s.hangerYaw};
          spring(row,'angle','av',above.angle,145-j*15,16-j*.65,dt);
          const shoulder=s.hangerYaw+(s.targetYaw-s.hangerTarget);
          const yawTarget=j?above.yaw:shoulder*.8+s.clothYaw*.2;
          spring(row,'yaw','yv',yawTarget,190-j*18,21-j*1.1,dt);
          row.angle=clamp(row.angle,-7.2,7.2);
          row.yaw=clamp(row.yaw,-4,80);row.yv=clamp(row.yv,-230,230);
        });
      });
      this.resolve(states,ctx);
    }
    resolve(states,ctx){
      const active=states.map((s,i)=>!ctx.inRack||ctx.inRack(i));
      let bounds=states.map((s,i)=>ctx.measure?ctx.measure(i,s):{left:42,right:52});
      const invMass=i=>ctx.gesture?.dragged&&ctx.gesture.index===i ? .22 : (states[i].weight||1);
      // 双向投影，多次迭代把推力传到整条链；保持原始商品顺序。
      const neighbours=states.map((_,i)=>i).filter(i=>active[i]);
      for(let pass=0;pass<48;pass++){
        for(let q=0;q<neighbours.length-1;q++){
          const k=pass%2?neighbours.length-2-q:q;
          const i=neighbours[k],j=neighbours[k+1];
          if(!active[i]||!active[j])continue;
          const a=states[i],b=states[j];
          const overlap=ctx.base[i]+a.x+bounds[i].right+3-(ctx.base[j]+b.x-bounds[j].left);
          if(overlap<=.001)continue;
          const wa=invMass(i),wb=invMass(j),sum=wa+wb;
          a.x-=overlap*wa/sum;b.x+=overlap*wb/sum;
          const relative=b.vx-a.vx;
          if(relative<0){
            const impulse=-(1.05)*relative/sum;
            a.vx-=impulse*wa;b.vx+=impulse*wb;
            const torque=clamp(impulse*.012/Math.max(.25,ctx.scale),0,7);
            a.av+=torque;b.av-=torque;
            a.fabric?.forEach((row,k)=>row.av+=torque*(k+1)/12);
            b.fabric?.forEach((row,k)=>row.av-=torque*(k+1)/12);
            this.contacts++;
          }
        }
        states.forEach((s,i)=>{
          if(!active[i])return;
          const lo=8+bounds[i].left-ctx.base[i];
          const hi=ctx.width-8-bounds[i].right-ctx.base[i];
          if(s.x<lo){s.x=lo;s.vx=Math.max(0,s.vx)*.12;s.av*=.8;}
          if(s.x>hi){s.x=hi;s.vx=Math.min(0,s.vx)*.12;s.av*=.8;}
        });
      }
      // 边界处的链式推挤使用有界等距回归收尾，避免迭代误差留下穿插。
      const span=()=>neighbours.reduce((sum,i)=>sum+bounds[i].left+bounds[i].right,0)+Math.max(0,neighbours.length-1)*3;
      for(let n=0;n<16&&span()>ctx.width-16;n++){
        neighbours.forEach(i=>{states[i].angle*=.8;states[i].av*=.8;states[i].fabric?.forEach(f=>{f.angle*=.8;f.av*=.8;});});
        bounds=states.map((s,i)=>ctx.measure?ctx.measure(i,s):bounds[i]);
      }
      if(neighbours.length){
        const prefix=[0],blocks=[];
        for(let k=1;k<neighbours.length;k++)prefix[k]=prefix[k-1]+bounds[neighbours[k-1]].right+bounds[neighbours[k]].left+3;
        neighbours.forEach((i,k)=>{
          const weight=1/invMass(i),value=ctx.base[i]+states[i].x-prefix[k];
          blocks.push({first:k,last:k,weight,total:value*weight});
          while(blocks.length>1){
            const a=blocks[blocks.length-2],b=blocks[blocks.length-1];
            if(a.total/a.weight<=b.total/b.weight)break;
            a.last=b.last;a.weight+=b.weight;a.total+=b.total;blocks.pop();
          }
        });
        const lower=8+bounds[neighbours[0]].left;
        const upper=ctx.width-8-bounds[neighbours.at(-1)].right-prefix.at(-1);
        blocks.forEach(block=>{
          const value=clamp(block.total/block.weight,lower,Math.max(lower,upper));
          for(let k=block.first;k<=block.last;k++){
            const i=neighbours[k];states[i].x=value+prefix[k]-ctx.base[i];
          }
        });
      }
      states.forEach(s=>{
        s.av=clamp(s.av,-35,35);
        s.fabric?.forEach(f=>{f.av=clamp(f.av,-45,45);});
      });
    }
    energy(states){
      return Math.max(0,...states.map(s=>Math.max(s.clickRockAt?1:0,Math.abs(s.vx)*.1,Math.abs(s.av)*.1,
        Math.abs(s.angle),Math.abs(s.hangerYaw-s.hangerTarget),Math.abs(s.clothYaw-s.targetYaw),
        Math.abs(s.clothVelocity)*.1,...(s.fabric||[]).map(f=>Math.max(Math.abs(f.angle),Math.abs(f.av)*.1,Math.abs(f.yaw-s.targetYaw),Math.abs(f.yv)*.1)))));
    }
    sleep(states){
      states.forEach(s=>{
        s.vx=s.angle=s.av=s.hangerVelocity=s.clothVelocity=0;
        s.clickRockAt=s.clickRockVelocity=s.rockUntil=0;
        s.hangerYaw=s.hangerTarget;s.clothYaw=s.targetYaw;s.mix=s.targetYaw===0?1:0;
        this.prepare(s);s.fabric.forEach(f=>{f.angle=f.av=f.yv=0;f.yaw=s.targetYaw;});
      });
    }
  }
  if(typeof module!=='undefined')module.exports=RackPhysics;
  else root.RackPhysics=RackPhysics;
})(typeof window==='undefined'?globalThis:window);
