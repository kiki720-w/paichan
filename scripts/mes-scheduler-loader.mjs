import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=process.env.MES_CATALOG_APP_ROOT||fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(join(root,'package.json'));
const ts=require('typescript');
const modules=new Map();

export function loadSchedulerModule(name){return load(resolve(root,'app',name));}

function load(base){
 const file=existsSync(base+'.tsx')?base+'.tsx':base+'.ts';
 if(modules.has(file))return modules.get(file);
 const output={};
 const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 new Function('require','exports',outputText)(name=>name.startsWith('.')?load(resolve(dirname(file),name)):require(name),output);
 modules.set(file,output);
 return output;
}
