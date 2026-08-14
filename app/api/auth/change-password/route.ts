import {env} from 'cloudflare:workers';
import {getSession} from '../access';
import {savePassword,verifyPassword} from '../passwords';

export async function POST(req:Request){
 const session=getSession(req);
 if(!session)return Response.json({error:'登录已失效，请重新登录'},{status:401});
 try{
  const {currentPassword,newPassword}=await req.json() as {currentPassword?:string;newPassword?:string};
  if(!currentPassword||!newPassword)return Response.json({error:'请完整填写当前密码和新密码'},{status:400});
  if(newPassword.length<8||newPassword.length>64)return Response.json({error:'新密码需为8至64位'},{status:400});
  if(newPassword===currentPassword)return Response.json({error:'新密码不能与当前密码相同'},{status:400});
  const config=env as unknown as Record<string,string|undefined>;
  const fallback=session.role==='main'?config.APP_PASSWORD:session.factory==='xian'?config.XIAN_PASSWORD:config.XINGPING_PASSWORD;
  if(!await verifyPassword(session.username,currentPassword,fallback))return Response.json({error:'当前密码不正确'},{status:403});
  await savePassword(session.username,newPassword);
  return Response.json({ok:true},{headers:{'set-cookie':'xuheng_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}});
 }catch{return Response.json({error:'密码修改失败，请稍后重试'},{status:500})}
}
