import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const tasks=['mes-catalog-poll.mjs','mes-catalog-service.mjs'].map(file=>
 spawn(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{stdio:'inherit'}));
let stopping=false;
function stop(code){
 if(stopping)return;
 stopping=true;
 process.exitCode=code;
 for(const task of tasks)if(task.exitCode===null)task.kill();
}
for(const task of tasks){task.on('exit',()=>stop(1));task.on('error',()=>stop(1));}
process.on('SIGTERM',()=>stop(0));
process.on('SIGINT',()=>stop(0));
