import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import webpush from "npm:web-push@3.6.7";
const db=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"");
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});
const allowed=(req:Request)=>{const a=Deno.env.get("HORUSDQ_WORKER_SECRET"),b=req.headers.get("x-worker-secret");if(!a||!b||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
type Job={id:string;recipient_id:string;channel:"email"|"push";target_key:string;title:string;body:string;source_url:string|null;attempts:number};
async function send(j:Job){
 if(j.channel==="email"){
  const key=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("RESEND_FROM_EMAIL");
  if(!key||!from)throw Error("Email channel not configured");
  const {data,error}=await db.auth.admin.getUserById(j.recipient_id);if(error||!data.user?.email)throw Error("Recipient unavailable");
  const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"content-type":"application/json","Idempotency-Key":j.id},body:JSON.stringify({from,to:[data.user.email],subject:j.title,text:j.body+(j.source_url?"\n"+j.source_url:"")})});
  if(!res.ok)throw Error("Resend HTTP "+res.status);return "resend:accepted";
 }
 const {data,error}=await db.from("push_subscriptions").select("subscription").eq("user_id",j.recipient_id).eq("endpoint_hash",j.target_key).eq("active",true).maybeSingle();
 if(error||!data)throw Error("Push subscription not available");
 const pub=Deno.env.get("VAPID_PUBLIC_KEY"),priv=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT");
 if(!pub||!priv||!subject)throw Error("VAPID not configured");
 webpush.setVapidDetails(subject,pub,priv);
 try{await webpush.sendNotification(data.subscription,JSON.stringify({title:j.title,body:j.body,url:j.source_url||"/horusdq/"}),{TTL:3600});}
 catch(e){const status=(e as {statusCode?:number})?.statusCode;if(status===404||status===410)await db.from("push_subscriptions").update({active:false}).eq("endpoint_hash",j.target_key).eq("user_id",j.recipient_id);throw e;}
 return "push:accepted";
}
Deno.serve(async req=>{
 if(req.method!=="POST")return response({error:"method_not_allowed"},405);
 if(!allowed(req))return response({error:"unauthorized"},401);
 const {data,error}=await db.rpc("claim_notification_batch",{batch_limit:20});
 if(error)return response({error:"claim_failed"},500);
 let sent=0,retry=0;
 for(const j of data as Job[]||[]){
  try{
   const state=await send(j);
   const {error:saveError}=await db.from("notification_outbox").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",j.id);
   if(saveError)throw saveError;
   await db.from("notification_deliveries").insert({outbox_id:j.id,provider_status:state});sent++;
  }catch(e){
   const message=e instanceof Error?e.message:String(e);
   const exhausted=j.attempts>=5;
   await db.from("notification_outbox").update({status:exhausted?"failed":"retry",next_attempt_at:new Date(Date.now()+Math.min(3600,Math.pow(2,j.attempts)*30)*1000).toISOString(),last_error:message.slice(0,240)}).eq("id",j.id);
   await db.from("notification_deliveries").insert({outbox_id:j.id,provider_status:"failed",error_text:message.slice(0,240)});retry++;
  }
 }
 return response({sent,retry});
});