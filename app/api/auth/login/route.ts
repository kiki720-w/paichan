import {env} from 'cloudflare:workers';

export async function POST(req:Request){
 try{
  const {username,password}=await req.json() as {username?:string,password?:string};
  const config=env as unknown as Record<string,string|undefined>;
  if(!config.APP_USERNAME||!config.APP_PASSWORD||!config.APP_SESSION_TOKEN)return Response.json({error:'登录尚未配置'},{status:503});
  if(username!==config.APP_USERNAME||password!==config.APP_PASSWORD)return Response.json({error:'账号或密码错误'},{status:401});
  return Response.json({ok:true},{headers:{'set-cookie':`xuheng_session=${encodeURIComponent(config.APP_SESSION_TOKEN)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`}});
 }catch{return Response.json({error:'登录请求无效'},{status:400})}
}
