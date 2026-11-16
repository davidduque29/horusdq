import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.95.0";
const db=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"");
const result=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json"}});
function authorize(req:Request){const a=Deno.env.get("HORUSDQ_WORKER_SECRET"),b=req.headers.get("x-worker-secret");if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function safe(raw:string){try{const u=new URL(raw);const hosts=(Deno.env.get("HORUSDQ_HEALTH_HOSTS")||"").toLowerCase().split(",").map(x=>x.trim());return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")&&hosts.includes(u.hostname.toLowerCase())}catch{return false}}
async function notify(projectId:string,kind:"outage"|"recovery",eventKey:string,title:string,body:string,url:string){
 const {data:project}=await db.from("projects").select("owner_id").eq("id",projectId).single();if(!project)return;
 const {data:members}=await db.from("project_members").select("user_id").eq("project_id",projectId);
 for(const userId of [...new Set([project.owner_id,...(members||[]).map(m=>m.user_id)])]){
  const {data:pref}=await db.from("notification_preferences").select("*").eq("project_id",projectId).eq("user_id",userId).maybeSingle();
  if(pref && !(kind==="outage"?pref.outage:pref.recovery))continue;
  const entries=[];
  if(pref?.email_enabled!==false)entries.push({project_id:projectId,recipient_id:userId,event_key:eventKey,kind,channel:"email",target_key:"email",title,body,source_url:url});
  if(pref?.push_enabled!==false){const {data:subs}=await db.from("push_subscriptions").select("endpoint_hash").eq("user_id",userId).eq("active",true);for(const sub of subs||[])entries.push({project_id:projectId,recipient_id:userId,event_key:eventKey,kind,channel:"push",target_key:sub.endpoint_hash,title,body,source_url:url});}
  if(entries.length)await db.from("notification_outbox").upsert(entries,{onConflict:"event_key,recipient_id,channel,target_key",ignoreDuplicates:true});
 }
}
Deno.serve(async req=>{
 if(req.method!=="POST")return result({error:"method_not_allowed"},405);
 if(!authorize(req))return result({error:"unauthorized"},401);
 const {data:services,error}=await db.from("monitored_services").select("id,project_id,name,url").eq("enabled",true).limit(100);
 if(error)return result({error:"lookup_failed"},500);
 let checked=0;const errors:string[]=[];
 for(const service of services||[]){
  if(!safe(service.url)){errors.push(service.name+":host_not_allowlisted");continue}
  let healthy=false,statusCode:number|null=null;const started=performance.now();
  try{const res=await fetch(service.url,{redirect:"manual",signal:AbortSignal.timeout(6000),headers:{"Cache-Control":"no-cache"}});statusCode=res.status;healthy=res.status>=200&&res.status<300;}catch{healthy=false}
  const {error:insertError}=await db.from("health_results").insert({service_id:service.id,healthy,status_code:statusCode,latency_ms:Math.round(performance.now()-started)});
  if(insertError){errors.push(service.name+":persist_error");continue}checked++;
  const {data:history}=await db.from("health_results").select("healthy").eq("service_id",service.id).order("checked_at",{ascending:false}).limit(3);
  const {data:incident}=await db.from("incidents").select("id").eq("service_id",service.id).eq("state","open").maybeSingle();
  if(!incident&&history?.length===3&&history.every(h=>h.healthy===false)){
   const {data:opened,error:e}=await db.from("incidents").insert({service_id:service.id}).select("id").single();
   if(!e&&opened)await notify(service.project_id,"outage",service.id+":outage:"+opened.id,"Servicio caído · "+service.name,"Tres comprobaciones consecutivas fallaron.",service.url);
  }
  if(incident&&history?.length>=2&&history[0].healthy&&history[1].healthy){
   const {error:e}=await db.from("incidents").update({state:"resolved",resolved_at:new Date().toISOString()}).eq("id",incident.id);
   if(!e)await notify(service.project_id,"recovery",service.id+":recovery:"+incident.id,"Servicio recuperado · "+service.name,"Dos comprobaciones consecutivas fueron exitosas.",service.url);
  }
 }
 return result({checked,errors});
});