import {env} from 'cloudflare:workers';

const enc=new TextEncoder();
const bytesToHex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hexToBytes=(hex:string)=>new Uint8Array(hex.match(/.{1,2}/g)?.map(x=>parseInt(x,16))||[]);

async function derive(password:string,salt:Uint8Array){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:120000},key,256);
 return bytesToHex(new Uint8Array(bits));
}

export async function ensurePasswordTable(){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS account_password (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}

export async function verifyPassword(username:string,password:string,fallback?:string){
 await ensurePasswordTable();
 const row=await env.DB.prepare(`SELECT password_hash,salt FROM account_password WHERE username=?`).bind(username).first<{password_hash:string;salt:string}>();
 if(!row)return Boolean(fallback&&password===fallback);
 const actual=await derive(password,hexToBytes(row.salt));
 return actual===row.password_hash;
}

export async function savePassword(username:string,password:string){
 await ensurePasswordTable();
 const salt=crypto.getRandomValues(new Uint8Array(16)),hash=await derive(password,salt);
 await env.DB.prepare(`INSERT INTO account_password(username,password_hash,salt,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,updated_at=CURRENT_TIMESTAMP`).bind(username,hash,bytesToHex(salt)).run();
}
