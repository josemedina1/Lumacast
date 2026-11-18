// Icono vectorial rasterizado localmente; ICO con PNG de 256 px.
const fs=require('node:fs');const zlib=require('node:zlib');const path=require('node:path');
const size=256;const rows=Buffer.alloc((size*4+1)*size);
const segment=(x,y,ax,ay,bx,by)=>{const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay));};
function color(x,y){
 const dx=Math.max(7-x,0,x-41),dy=Math.max(7-y,0,y-41);if(Math.hypot(dx,dy)>7)return [0,0,0,0];
 const lines=[[12,21,12,15],[12,15,36,15],[36,15,36,31],[36,31,25,31]];
 const d=Math.min(...lines.map(l=>segment(x,y,...l)));
 const r=Math.hypot(x-12,y-36);const arc=x>=12&&y<=36&&(Math.abs(r-12)<1.25||Math.abs(r-6)<1.25);
 if(d<1.25||arc||r<1.7)return [165,222,255,255];
 return [Math.round(21+y*.12),Math.round(42+y*.14),Math.round(61+y*.18),255];
}
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const c=[0,0,0,0];for(const oy of [.25,.75])for(const ox of [.25,.75]){const v=color((x+ox)*48/size,(y+oy)*48/size);for(let i=0;i<4;i++)c[i]+=v[i]/4;}for(let i=0;i<4;i++)rows[y*(size*4+1)+1+x*4+i]=Math.round(c[i]);}
function chunk(type,data){const t=Buffer.from(type);const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(zlib.crc32(Buffer.concat([t,data])),8+data.length);return b;}
const h=Buffer.alloc(13);h.writeUInt32BE(size);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
fs.writeFileSync(path.join(__dirname,'../src/icon.ico'),Buffer.concat([ico,png]));
