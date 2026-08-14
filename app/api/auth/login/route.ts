import {env} from 'cloudflare:workers';
import {sessionCookie} from '../access';
import {verifyPassword} from '../passwords';

export async function POST(req:Request){
 try{
  const {username,password}=await req.json() as {username?:string,password?:string};
  const config=env as unknown as Record<string,string|undefined>;
  const accounts=[
   {username:config.APP_USERNAME,password:config.APP_PASSWORD,token:config.APP_SESSION_TOKEN},
   {username:config.XIAN_USERNAME,password:config.XIAN_PASSWORD,token:config.XIAN_SESSION_TOKEN},
   {username:config.XINGPING_USERNAME,password:config.XINGPING_PASSWORD,token:config.XINGPING_SESSION_TOKEN},
  ];
  const account=accounts.find(x=>x.username&&x.password&&x.token&&username===x.username);
  if(!account||!password||!await verifyPassword(account.username!,password,account.password))return Response.json({error:'账号或密码错误'},{status:401});
  return Response.json({ok:true},{headers:{'set-cookie':sessionCookie(account.token!)}});
 }catch{return Response.json({error:'登录请求无效'},{status:400})}
}
