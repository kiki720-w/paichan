import {env} from 'cloudflare:workers';

export type Factory='xian'|'xingping';
export type Session={role:'main'|'factory';factory?:Factory;displayName:string};

const cookieValue=(req:Request)=>{const cookie=req.headers.get('cookie')||'';return decodeURIComponent(cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('xuheng_session='))?.slice('xuheng_session='.length)||'')};

export function getSession(req:Request):Session|null{
 const config=env as unknown as Record<string,string|undefined>,token=cookieValue(req);
 if(config.APP_SESSION_TOKEN&&token===config.APP_SESSION_TOKEN)return{role:'main',displayName:'总负责人'};
 if(config.XIAN_SESSION_TOKEN&&token===config.XIAN_SESSION_TOKEN)return{role:'factory',factory:'xian',displayName:'西安工厂负责人'};
 if(config.XINGPING_SESSION_TOKEN&&token===config.XINGPING_SESSION_TOKEN)return{role:'factory',factory:'xingping',displayName:'兴平工厂负责人'};
 return null;
}

export function resolveFactory(req:Request,session:Session):Factory{
 if(session.role==='factory')return session.factory!;
 return new URL(req.url).searchParams.get('factory')==='xian'?'xian':'xingping';
}

export function sessionCookie(token:string){return `xuheng_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`}
