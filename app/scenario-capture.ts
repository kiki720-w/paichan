import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import ocrWorker from 'tesseract.js/dist/worker.min.js?url';
import ocrCore from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

type Recognition={text:string;confidence:number|null};

async function localOcr(images:(File|HTMLCanvasElement)[],onProgress:(message:string)=>void):Promise<Recognition>{
 const {createWorker,OEM}=await import('tesseract.js');
 const worker=await new Promise<Awaited<ReturnType<typeof createWorker>>>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('本地识别组件加载超时。')),30000);
  void createWorker('chi_sim+eng',OEM.LSTM_ONLY,{
   workerPath:ocrWorker,corePath:ocrCore,langPath:new URL('/scenario-ocr',window.location.origin).href,
   workerBlobURL:false,cacheMethod:'none',
   errorHandler:()=>{clearTimeout(timeout);reject(Error('本地识别组件无法加载。'));},
   logger:message=>{
    if(message.status==='recognizing text')onProgress(`识别文字 ${Math.round(message.progress*100)}%`);
   },
  }).then(value=>{clearTimeout(timeout);resolve(value);},error=>{clearTimeout(timeout);reject(error);});
 });
 try{
  const results=[];
  for(const image of images){const {data}=await worker.recognize(image);results.push(data);}
  const confidence=results.length?Math.min(...results.map(item=>item.confidence)):null;
  return {text:results.map(item=>item.text).join('\n'),confidence};
 }finally{await worker.terminate();}
}

export async function captureScenarioDocument(file:File,onProgress:(message:string)=>void):Promise<Recognition>{
 onProgress('正在读取附件');
 if(!/\.pdf$/i.test(file.name))return localOcr([file],onProgress);
 const pdf=await import('pdfjs-dist');
 pdf.GlobalWorkerOptions.workerSrc=pdfWorker;
 const loading=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())});
 const canvases:HTMLCanvasElement[]=[];
 try{
  const document=await loading.promise;
  if(document.numPages>8)throw Error('请提交不超过 8 页的情景附件。');
  const extracted:string[]=[];
  for(let index=1;index<=document.numPages;index++){
   const page=await document.getPage(index);
   const content=await page.getTextContent();
   const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
   if(text){extracted.push(text);continue;}
   const raw=page.getViewport({scale:1});
   const viewport=page.getViewport({scale:Math.min(2,2200/Math.max(raw.width,raw.height))});
   const canvas=window.document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   await page.render({canvas,viewport}).promise;
   canvases.push(canvas);
  }
  const scanned=canvases.length?await localOcr(canvases,onProgress):null;
  return {text:[...extracted,...(scanned?[scanned.text]:[])].join('\n'),confidence:scanned?.confidence??null};
 }finally{
  for(const canvas of canvases){canvas.width=0;canvas.height=0;}
  await loading.destroy();
 }
}
