(function(root){
  const {read,write,FRAMES,RATE}=root.LumaAudioPackets;
  async function setup(capture){const context=new AudioContext({sampleRate:RATE,latencyHint:'interactive'});try{await context.audioWorklet.addModule('audio-worklet.js');await context.resume();const node=new AudioWorkletNode(context,'luma-audio',{numberOfInputs:capture?1:0,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{capture}});node.connect(context.destination);return{context,node};}catch(error){await context.close();throw error;}}
  class Sender{
    constructor({track,api,onError}){Object.assign(this,{track,api,onError});this.closed=false;this.seq=0;this.inFlight=0;this.muted=false;}
    async start(){const io=await setup(true);Object.assign(this,io);if(this.closed){await io.context.close();return;}this.source=this.context.createMediaStreamSource(new MediaStream([this.track]));this.codec=0;
      if(typeof AudioEncoder!=='undefined'&&typeof AudioData!=='undefined'){const config={codec:'opus',sampleRate:RATE,numberOfChannels:2,bitrate:96000};if((await AudioEncoder.isConfigSupported(config).catch(()=>({supported:false}))).supported){if(this.closed)return;this.encoder=new AudioEncoder({output:chunk=>{if(this.closed||this.muted)return;const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);this.send(1,Math.round(chunk.timestamp/20000),data);},error:error=>{if(!this.closed)this.onError(error);}});this.encoder.configure(config);this.codec=1;}}
      if(this.closed)return;this.node.port.onmessage=({data})=>{if(this.closed||this.muted||this.inFlight>=3)return;const samples=data.samples,seq=++this.seq;if(this.encoder){if(this.encoder.encodeQueueSize>=3)return;const audio=new AudioData({format:'f32-planar',sampleRate:RATE,numberOfFrames:FRAMES,numberOfChannels:2,timestamp:seq*20000,data:samples});try{this.encoder.encode(audio);}finally{audio.close();}}else{const pcm=new Int16Array(1920);for(let i=0;i<1920;i++)pcm[i]=Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767)));this.send(0,seq,new Uint8Array(pcm.buffer));}};
      this.source.connect(this.node);
    }
    send(codec,seq,data){if(this.closed||this.muted||this.inFlight>=3)return;this.inFlight++;void this.api.audio(write(codec,seq,data)).catch(error=>{if(!this.closed)this.onError(error);}).finally(()=>this.inFlight--);}
    close(){this.closed=true;if(this.node){this.node.port.onmessage=null;this.node.disconnect();}this.source?.disconnect();if(this.encoder?.state!=='closed')this.encoder?.close();if(this.context?.state!=='closed')void this.context?.close();}
  }
  class Receiver{
    constructor({onError}){this.onError=onError;this.closed=false;this.queued=0;this.frames=0;this.ready=setup(false).then(io=>{Object.assign(this,io);if(this.closed){this.node.disconnect();void this.context.close();}});this.queue=Promise.resolve();this.ready.catch(error=>{if(!this.closed)this.onError(error);});}
    receive(packet){if(this.closed||this.queued>=4)return;this.queued++;this.queue=this.queue.then(async()=>{await this.ready;if(this.closed)return;const meta=read(packet);if(meta.codec===0){const pcm=new Int16Array(meta.data.slice().buffer),samples=new Float32Array(1920);for(let i=0;i<1920;i++)samples[i]=pcm[i]/32768;this.play(samples);return;}
      if(!this.decoder){if(typeof AudioDecoder==='undefined')throw Error('Este equipo no puede decodificar audio Opus.');this.decoder=new AudioDecoder({output:audio=>{try{if(this.closed)return;const samples=new Float32Array(1920);for(let c=0;c<2;c++)audio.copyTo(samples.subarray(c*960,(c+1)*960),{planeIndex:Math.min(c,audio.numberOfChannels-1),format:'f32-planar',frameCount:Math.min(960,audio.numberOfFrames)});this.play(samples);}finally{audio.close();}},error:error=>{if(!this.closed)this.onError(error);}});this.decoder.configure({codec:'opus',sampleRate:RATE,numberOfChannels:2});}
      if(this.decoder.decodeQueueSize<4)this.decoder.decode(new EncodedAudioChunk({type:'key',timestamp:meta.seq*20000,data:meta.data}));
    }).catch(error=>{if(!this.closed)this.onError(error);}).finally(()=>this.queued--);}
    play(samples){if(this.closed)return;this.frames++;this.node.port.postMessage({samples},[samples.buffer]);}
    close(){this.closed=true;if(this.decoder?.state!=='closed')this.decoder?.close();this.node?.disconnect();if(this.context?.state!=='closed')void this.context?.close();}
  }
  root.LumaAudio={Sender,Receiver};
})(globalThis);
