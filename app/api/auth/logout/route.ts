import {sessionCookie} from '../access';

export function POST(req:Request){return Response.json({ok:true},{headers:{'set-cookie':sessionCookie('',req,0)}})}
