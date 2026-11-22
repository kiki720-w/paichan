import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import type {Plugin} from 'vite';

const require=createRequire(import.meta.url);
const models=Object.fromEntries(['chi_sim','eng'].map(language=>[
 `/scenario-ocr/${language}.traineddata.gz`,
 require.resolve(`@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`),
]));

export function scenarioOcrAssets():Plugin{
 return {
  name:'scenario-ocr-assets',
  configureServer(server){
   server.middlewares.use((req,res,next)=>{
    const path=req.url?.split('?')[0];
    const file=path&&Object.hasOwn(models,path)?models[path]:undefined;
    if(!file)return next();
    res.setHeader('Content-Type','application/octet-stream');
    createReadStream(file).on('error',next).pipe(res);
   });
  },
  async generateBundle(){
   if(this.environment.name!=='client')return;
   for(const [url,file] of Object.entries(models)){
    this.emitFile({type:'asset',fileName:url.slice(1),source:await readFile(file)});
   }
  },
 };
}
