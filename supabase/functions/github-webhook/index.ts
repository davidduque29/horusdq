import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const secret = Deno.env.get("GITHUB_WEBHOOK_SECRET") ?? "";
const encoder = new TextEncoder();
const json = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
async function verified(body:Uint8Array,signature:string):Promise<boolean>{
 if(!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature))return false;
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,body));
 const expected=Uint8Array.from(signature.slice(7).match(/.{2}/g)!.map(x=>parseInt(x,16)));
 let diff=0;for(let i=0;i<digest.length;i++)diff |= digest[i]^expected[i];
 return diff===0;
}
async function queue(projectId:string,kind:"deployment_success"|"failure",eventKey:string,title:string,body:string,url:string){
 const {data:project,error:projectErr}=await supabase.from("projects").select("owner_id").eq("id",projectId).single();
 if(projectErr || !project)return;
 const {data:members}=await supabase.from("project_members").select("user_id").eq("project_id",projectId);
 const recipients=[...new Set([project.owner_id,...(members||[]).map(m=>m.user_id)])];
 for(const userId of recipients){
  const {data:pref}=await supabase.from("notification_preferences").select("*").eq("project_id",projectId).eq("user_id",userId).maybeSingle();
  if(pref && !(kind==="failure"?pref.failure:pref.success))continue;
  const entries=[];
  if(pref?.email_enabled!==false)entries.push({project_id:projectId,recipient_id:userId,event_key:eventKey,kind,channel:"email",target_key:"email",title,body,source_url:url});
  if(pref?.push_enabled!==false){
   const {data:subs}=await supabase.from("push_subscriptions").select("endpoint_hash").eq("user_id",userId).eq("active",true);
   for(const sub of subs??[])entries.push({project_id:projectId,recipient_id:userId,event_key:eventKey,kind,channel:"push",target_key:sub.endpoint_hash,title,body,source_url:url});
  }
  if(entries.length){const {error}=await supabase.from("notification_outbox").upsert(entries,{onConflict:"event_key,recipient_id,channel,target_key",ignoreDuplicates:true});if(error)throw error;}
 }
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const len=Number(req.headers.get("content-length")||0);if(len>256000)return json({error:"too_large"},413);
 const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>256000)return json({error:"too_large"},413);
 if(!await verified(raw,req.headers.get("x-hub-signature-256")??""))return json({error:"bad_signature"},401);
 const event=req.headers.get("x-github-event")??"";
 if(!["workflow_run","deployment_status"].includes(event))return json({ignored:true});
 const delivery=req.headers.get("x-github-delivery")??"";
 if(!/^[a-f0-9-]{36}$/i.test(delivery))return json({error:"delivery_id_required"},400);
 let payload:Record<string,any>;try{payload=JSON.parse(new TextDecoder().decode(raw))}catch{return json({error:"bad_json"},400)}
 const full=String(payload.repository?.full_name||"");
 const [owner,name]=full.split("/");
 if(!owner||!name)return json({error:"repo_missing"},400);
 const {data:integration,error:lookupError}=await supabase.from("project_integrations").select("project_id").eq("repo_owner",owner).eq("repo_name",name).eq("enabled",true).maybeSingle();
 if(lookupError)return json({error:"integration_lookup_failed"},500);
 if(!integration)return json({ignored:"unregistered_repository"});
 const projectId=integration.project_id;
 const {error:deliveryError}=await supabase.from("webhook_deliveries").insert({delivery_id:delivery,project_id:projectId,event_type:event});
 if(deliveryError?.code==="23505")return json({duplicate:true});
 if(deliveryError)return json({error:"delivery_failed"},500);
 try{
  if(event==="workflow_run"){
   const run=payload.workflow_run;if(!run?.id)return json({ignored:"no_run"});
   const {error}=await supabase.from("workflow_runs").upsert({project_id:projectId,provider_run_id:run.id,workflow_name:String(run.name||"Workflow"),branch:run.head_branch,status:String(run.status||"unknown"),conclusion:run.conclusion,source_url:String(run.html_url||""),updated_at:new Date().toISOString()},{onConflict:"project_id,provider_run_id"});
   if(error)throw error;
   if(run.status==="completed" && ["failure","timed_out","action_required"].includes(run.conclusion)){
    await queue(projectId,"failure",full+":run:"+run.id,"Pipeline fallido · "+name,String(run.name||"Workflow")+" terminó con "+run.conclusion,String(run.html_url||""));
   }
  }else{
   const deployment=payload.deployment,status=payload.deployment_status;
   if(!deployment?.id || !status?.state)return json({ignored:"incomplete_deployment"});
   const state=String(status.state);
   const {error}=await supabase.from("deployment_events").upsert({project_id:projectId,deployment_id:deployment.id,state,environment:deployment.environment??null,source_url:String(status.target_url||status.log_url||"")},{onConflict:"project_id,deployment_id,state",ignoreDuplicates:true});
   if(error)throw error;
   if(state==="success" || state==="failure" || state==="error"){
    await queue(projectId,state==="success"?"deployment_success":"failure",full+":deployment:"+deployment.id+":"+state,
     state==="success"?"Despliegue confirmado · "+name:"Despliegue fallido · "+name,
     "Entorno: "+String(deployment.environment||"sin especificar")+" · Estado: "+state,
     String(status.target_url||status.log_url||""));
   }
  }
  return json({accepted:true});
 }catch(err){console.error("Webhook processing failed",err);await supabase.from("webhook_deliveries").delete().eq("delivery_id",delivery);return json({error:"processing_failed"},500)}
});
