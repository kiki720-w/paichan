import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const modules = new Map();
const appDir = fileURLToPath(new URL('../app/', import.meta.url));

export function loadUi(name) {
  return load(resolve(appDir, name + '.tsx'));
}

function load(file) {
  if (modules.has(file)) return modules.get(file);
  const {outputText} = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  const exports = {};
  new Function('require', 'exports', outputText)(name => {
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(file), name);
    return load(existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts');
  }, exports);
  modules.set(file, exports);
  return exports;
}
