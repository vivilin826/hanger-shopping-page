(function(root){
  'use strict';
  const RAD=Math.PI/180,ROWS=24,COLS=6;
  class RackClothRenderer{
    constructor(models,specs,states,rack,viewport,onReady){
      this.models=models;this.specs=specs;this.states=states;this.rack=rack;this.viewport=viewport;this.items=[];
      this.canvas=document.createElement('canvas');this.canvas.className='cloth-scene';this.canvas.setAttribute('aria-hidden','true');
      const gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true});
      if(!gl){this.available=false;return;}this.gl=gl;
      const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const program=gl.createProgram();
      gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 a_position;attribute vec2 a_uv;attribute float a_shade;uniform vec2 u_resolution;varying vec2 v_uv;varying float v_shade;void main(){gl_Position=vec4(a_position/u_resolution*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);v_uv=a_uv;v_shade=a_shade;}'));
      gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D u_image;uniform float u_alpha;varying vec2 v_uv;varying float v_shade;void main(){vec4 c=texture2D(u_image,v_uv);gl_FragColor=vec4(c.rgb*v_shade,c.a)*u_alpha;}'));
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      this.program=program;gl.useProgram(program);
      this.position=gl.getAttribLocation(program,'a_position');this.uv=gl.getAttribLocation(program,'a_uv');this.shade=gl.getAttribLocation(program,'a_shade');
      this.resolution=gl.getUniformLocation(program,'u_resolution');this.alpha=gl.getUniformLocation(program,'u_alpha');
      this.buffer=gl.createBuffer();this.indices=gl.createBuffer();
      const indices=[];
      for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const a=y*(COLS+1)+x,b=a+COLS+1;indices.push(a,b,a+1,a+1,b,b+1);}
      this.indexData=new Uint16Array(indices);this.vertexData=new Float32Array((ROWS+1)*(COLS+1)*5);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,this.indexData,gl.STATIC_DRAW);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      document.body.append(this.canvas);this.available=true;
      models.forEach((model,i)=>{
        const entry={};this.items.push(entry);
        for(const [key,selector] of [['front','.garment-front'],['side','.garment-side'],['hanger','.hanger']]){
          const image=model.querySelector(selector);
          const upload=()=>{
            if(!image.naturalWidth)return;
            const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
            const points=[];
            if(key!=='hanger'){
              const c=document.createElement('canvas');c.width=96;c.height=160;const cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(image,0,0,96,160);
              const alpha=cx.getImageData(0,0,96,160).data;
              for(let row=0;row<=ROWS;row++){
                const y=Math.min(159,Math.round(row/ROWS*159));let lo=96,hi=-1;
                for(let yy=Math.max(0,y-3);yy<=Math.min(159,y+3);yy++)for(let x=0;x<96;x++)if(alpha[(yy*96+x)*4+3]>10){lo=Math.min(lo,x);hi=Math.max(hi,x);}
                if(hi>=lo)points.push([lo/96,row/ROWS],[(hi+1)/96,row/ROWS]);
              }
            }
            entry[key]={texture,points,ratio:image.naturalHeight/image.naturalWidth};
            if(this.items.every(it=>it.front&&it.side&&it.hanger))document.body.classList.add('mesh-ready');
            onReady();
          };
          if(image.complete)upload();else image.addEventListener('load',upload,{once:true});
        }
      });
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.available=false;document.body.classList.remove('mesh-ready');});
      this.canvas.addEventListener('webglcontextrestored',()=>{location.reload();});
    }
    row(s,v){
      if(!s.fabric)return {angle:s.angle,yaw:s.clothYaw};
      const p=Math.max(0,Math.min(5,v*5)),a=Math.floor(p),b=Math.min(5,a+1),t=p-a;
      return {angle:s.fabric[a].angle*(1-t)+s.fabric[b].angle*t,yaw:s.fabric[a].yaw*(1-t)+s.fabric[b].yaw*t};
    }
    point(i,key,u,v){
      const spec=this.specs[i],s=this.states[i];let width,height,top,anchor;
      if(key==='hanger'){width=spec.hanger;height=spec.hangerHeight||width*(this.items[i].hanger?.ratio||.43);top=25-width*(spec.hangerHookY||35)/420;anchor=.5;}
      else{const pose=spec[key];height=pose.displayHeight||spec.height;width=height*pose.width/pose.height;top=pose.top;anchor=pose.anchor;}
      // 正面悬挂图包含衣架：金属钩和木肩保持刚性，布料从支撑点以下逐渐自由。
      const pin=key==='side'?.19:key==='front'?(spec.front.clothStartV??.025):1;
      let free=key==='hanger'?0:Math.max(0,Math.min(1,(v-pin)/(1-pin)));
      free=free*free*(3-2*free);
      const fabric=this.row(s,free),angle=(s.angle*(1-free)+fabric.angle*free)*RAD;
      const x=(u-anchor)*width;
      if(key==='hanger'){
        const yaw=s.hangerYaw*RAD,z=-x*Math.sin(yaw),perspective=1400/(1400+z);
        const xx=x*Math.cos(yaw)*perspective,yy=top+v*height-25;
        return {x:140+xx*Math.cos(angle)-yy*Math.sin(angle),y:25+xx*Math.sin(angle)+yy*Math.cos(angle),shade:1};
      }
      // 照片已经提供正面/侧挂造型，不再把整张照片按绝对转角挤窄。
      // 只显示肩部与各段衣身之间的小幅相对扭转，形变集中在两边和衣摆。
      const shoulder=s.hangerYaw+(s.targetYaw-s.hangerTarget);
      const lag=Math.max(-16,Math.min(16,fabric.yaw-shoulder));
      const rigidTurn=key==='front'&&spec.frontIntegrated?
        Math.max(-70,Math.min(70,s.hangerYaw-s.hangerTarget))*Math.pow(1-free,3):0;
      const torsion=lag/16*free,yaw=(lag*free+rigidTurn)*RAD;
      const z=-x*Math.sin(yaw),perspective=1800/(1800+z);
      const sidePhase=Math.sin((u-anchor)*Math.PI);
      const trail=width*.028*torsion*free;
      const edgeCurl=width*.026*torsion*sidePhase;
      const xx=x*Math.cos(yaw)*perspective+trail;
      const yy=top+v*height-25+edgeCurl;
      return {x:140+xx*Math.cos(angle)-yy*Math.sin(angle),y:25+xx*Math.sin(angle)+yy*Math.cos(angle),shade:1-Math.min(.045,Math.abs(torsion)*.03)*(0.45+sidePhase*.35)};
    }
    measure(i,scale){
      const item=this.items[i],s=this.states[i];let lo=0,hi=0;
      if(!item?.side||!item.front)return null;
      for(const key of ['side','front']){
        if(key==='front'&&s.mix<.025||key==='side'&&s.mix>.975)continue;
        item[key].points.forEach(([u,v])=>{const p=this.point(i,key,u,v).x-140;lo=Math.min(lo,p);hi=Math.max(hi,p);});
      }
      if(s.mix>.05&&!this.specs[i].frontIntegrated)for(const u of [0,1]){const p=this.point(i,'hanger',u,.55).x-140;lo=Math.min(lo,p);hi=Math.max(hi,p);}
      return {left:-lo*scale+2,right:hi*scale+2};
    }
    drawItem(i,key,box,alpha){
      const item=this.items[i][key];if(!item||alpha<.003)return;
      const scale=box.width/280,gl=this.gl;let n=0;
      for(let row=0;row<=ROWS;row++)for(let col=0;col<=COLS;col++){
        const u=col/COLS,v=row/ROWS,p=this.point(i,key,u,v);
        this.vertexData[n++]=box.left+p.x*scale;this.vertexData[n++]=box.top+p.y*scale;
        this.vertexData[n++]=u;this.vertexData[n++]=v;this.vertexData[n++]=p.shade;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertexData,gl.DYNAMIC_DRAW);
      for(const [loc,size,offset] of [[this.position,2,0],[this.uv,2,8],[this.shade,1,16]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,20,offset);}
      gl.bindTexture(gl.TEXTURE_2D,item.texture);gl.uniform1f(this.alpha,alpha);gl.drawElements(gl.TRIANGLES,this.indexData.length,gl.UNSIGNED_SHORT,0);
    }
    render(collection,mode,activeIndex){
      if(!this.available)return;
      const gl=this.gl,dpr=Math.min(devicePixelRatio||1,2),width=innerWidth,height=innerHeight;
      if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)){this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);}
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);gl.uniform2f(this.resolution,width,height);
      this.canvas.style.zIndex=mode==='rack'?'4':'11';
      const fade=Number(getComputedStyle(collection).opacity),vp=this.viewport.getBoundingClientRect();
      const order=this.models.map((_,i)=>i).sort((a,b)=>{
        const da=this.models[a].parentElement!==this.rack[a],db=this.models[b].parentElement!==this.rack[b];
        return Number(da)-Number(db)||(a===activeIndex?1:0)-(b===activeIndex?1:0)||a-b;
      });
      for(const i of order){
        const model=this.models[i],onRack=model.parentElement===this.rack[i],box=model.getBoundingClientRect(),s=this.states[i];
        const alpha=(onRack?fade:1)*Number(getComputedStyle(model).opacity);if(box.width===0||alpha<.003)continue;
        if(onRack){gl.enable(gl.SCISSOR_TEST);gl.scissor(0,Math.max(0,Math.floor((height-vp.bottom)*dpr)),this.canvas.width,Math.min(this.canvas.height,Math.ceil(vp.height*dpr)));}else gl.disable(gl.SCISSOR_TEST);
        if(!this.specs[i].frontIntegrated&&!this.specs[i].clip)this.drawItem(i,'hanger',box,alpha*s.mix);
        this.drawItem(i,'side',box,alpha*(1-s.mix));this.drawItem(i,'front',box,alpha*s.mix);
        if(!this.specs[i].frontIntegrated&&this.specs[i].clip)this.drawItem(i,'hanger',box,alpha*s.mix);
      }
      gl.disable(gl.SCISSOR_TEST);
    }
  }
  root.RackClothRenderer=RackClothRenderer;
})(window);
