import {getSession} from '../access';
export function GET(req:Request){const session=getSession(req);return Response.json(session?{authenticated:true,...session}:{authenticated:false})}
