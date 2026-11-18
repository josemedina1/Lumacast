(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LumaAudioPackets=factory();})(globalThis,()=>{
  const MAGIC=0x41554d4c, HEADER=12, FRAMES=960, RATE=48000;
  function isAudio(data){return data?.byteLength>=4&&new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(0,true)===MAGIC;}
  function read(data){if(!(data instanceof Uint8Array)||data.length<HEADER||data.length>16384||!isAudio(data))throw Error('Paquete de audio inválido.');const v=new DataView(data.buffer,data.byteOffset,data.byteLength),codec=v.getUint8(4),seq=v.getUint32(8,true);if(v.getUint8(5)!==2||v.getUint16(6,true)!==FRAMES||codec>1||(codec===0&&data.length!==HEADER+FRAMES*4)||data.length===HEADER)throw Error('Formato de audio inválido.');return{codec,seq,data:data.subarray(HEADER)};}
  function write(codec,seq,data){const out=new Uint8Array(HEADER+data.byteLength),v=new DataView(out.buffer);v.setUint32(0,MAGIC,true);v.setUint8(4,codec);v.setUint8(5,2);v.setUint16(6,FRAMES,true);v.setUint32(8,seq,true);out.set(data,HEADER);read(out);return out;}
  return{read,write,isAudio,FRAMES,RATE};
});
