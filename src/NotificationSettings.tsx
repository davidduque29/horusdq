import {useCallback,useEffect,useState} from 'react';
import {createClient,type User} from '@supabase/supabase-js';
import {Bell,CheckCircle2, Github, LogOut, Plus, ShieldCheck, Smartphone, AlertTriangle} from 'lucide-react';

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
const vapid=import.meta.env.VITE_VAPID_PUBLIC_KEY as string|undefined;
const client=url&&key?createClient(url,key):null;
type Project={id:string;name:string;owner_id:string};
type Pref={success:boolean;failure:boolean;started:boolean;outage:boolean;recovery:boolean;push_enabled:boolean;email_enabled:boolean};
const defaults:Pref={success:true,failure:true,started:false,outage:true,recovery:true,push_enabled:true,email_enabled:true};
function publicKeyBytes(base64:string):Uint8Array{
 const normalized=base64.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function endpointHash(endpoint:string){
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint)));
 return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
}
export function NotificationSettings(){
 const [user,setUser]=useState<User|null>(null);
 const [projects,setProjects]=useState<Project[]>([]);
 const [selected,setSelected]=useState('');
 const [preferences,setPreferences]=useState<Pref>(defaults);
 const [newName,setNewName]=useState('');
 const [busy,setBusy]=useState(false);
 const [info,setInfo]=useState('');
 const [pushReady,setPushReady]=useState(false);
 const refresh=useCallback(async()=>{
  if(!client)return;
  const {data:{user}}=await client.auth.getUser();setUser(user);
  if(!user){setProjects([]);setSelected('');return}
  const {data,error}=await client.from('projects').select('id,name,owner_id').order('created_at',{ascending:false});
  if(error){setInfo('Error al cargar proyectos: '+error.message);return}
  const list=(data??[]) as Project[];setProjects(list);setSelected(current=>list.some(p=>p.id===current)?current:(list[0]?.id||''));
 },[]);
 useEffect(()=>{void refresh();if(!client)return;const {data:{subscription}}=client.auth.onAuthStateChange(()=>{void refresh()});return()=>subscription.unsubscribe()},[refresh]);
 useEffect(()=>{if(!client||!selected||!user)return;void(async()=>{const {data,error}=await client.from('notification_preferences').select('*').eq('project_id',selected).eq('user_id',user.id).maybeSingle();if(error)setInfo(error.message);setPreferences(data?{...defaults,...data}:defaults)})()},[selected,user?.id]);
 if(!client)return <section className="panel notify-panel"><h2><Bell size={19}/> Alertas y cuenta</h2><p>El módulo ya está preparado en el código. Falta conectar un proyecto Supabase exclusivo para HorusDQ y configurar GitHub OAuth, Push y Resend.</p><div className="setup-tag"><AlertTriangle size={17}/> Integración pendiente de configuración</div></section>;
 async function login(){setBusy(true);const {error}=await client!.auth.signInWithOAuth({provider:'github',options:{redirectTo:location.origin+'/horusdq/'}});if(error){setInfo(error.message);setBusy(false)}}
 async function addProject(e:React.FormEvent){e.preventDefault();if(!user||newName.trim().length<2)return;setBusy(true);const {error}=await client!.from('projects').insert({name:newName.trim(),owner_id:user.id});setBusy(false);if(error)setInfo(error.message);else{setNewName('');await refresh()}}
 async function save(patch:Partial<Pref>){if(!user||!selected)return;const next={...preferences,...patch};setPreferences(next);const {error}=await client!.from('notification_preferences').upsert({project_id:selected,user_id:user.id,...next},{onConflict:'project_id,user_id'});setInfo(error?'No se pudo guardar: '+error.message:'Preferencias guardadas')}
 async function enablePush(){
  if(!user||!vapid){setInfo('Falta configurar VAPID_PUBLIC_KEY');return}
  if(!('serviceWorker'in navigator)||!('PushManager'in window)){setInfo('El navegador no admite Web Push');return}
  setBusy(true);
  try{
   const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Permiso de notificaciones no concedido');
   const reg=await navigator.serviceWorker.register('/horusdq/sw.js',{scope:'/horusdq/'});
   const existing=await reg.pushManager.getSubscription();
   const subscription=existing??await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKeyBytes(vapid) as BufferSource});
   const json=subscription.toJSON();const {error}=await client!.from('push_subscriptions').upsert({user_id:user.id,endpoint_hash:await endpointHash(subscription.endpoint),subscription:json,active:true,label:navigator.userAgent.slice(0,100)},{onConflict:'endpoint_hash'});
   if(error)throw error;
   setPushReady(true);setInfo('Dispositivo registrado para Web Push');
  }catch(e){setInfo(e instanceof Error?e.message:'No fue posible activar Push')}finally{setBusy(false)}
 }
 return <section className="panel notify-panel">
  <h2><Bell size={19}/> Alertas y cuenta</h2>
  {!user?<><p>Conecta tu cuenta de GitHub para administrar proyectos, recibir alertas e identificar tus dispositivos.</p><button className="primary" disabled={busy} onClick={()=>void login()}><Github size={17}/> Continuar con GitHub</button></>:
   <><div className="account-strip"><ShieldCheck size={18}/><span>Conectado como <b>{user.email||'Usuario GitHub'}</b></span><button className="secondary" onClick={()=>void client!.auth.signOut()}><LogOut size={15}/> Salir</button></div>
    <form className="notify-add" onSubmit={e=>void addProject(e)}><label htmlFor="project-name">Nuevo proyecto privado en HorusDQ</label><div className="notify-input"><input id="project-name" value={newName} minLength={2} maxLength={80} placeholder="Nombre del proyecto" onChange={e=>setNewName(e.target.value)}/><button className="secondary" type="submit" disabled={busy||newName.trim().length<2}><Plus size={16}/> Crear</button></div></form>
    {projects.length>0?<><label htmlFor="notify-project">Preferencias del proyecto</label><select id="notify-project" value={selected} onChange={e=>setSelected(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="notify-options">
     {([['success','Despliegue confirmado'],['failure','Fallos de pipelines y despliegues'],['started','Inicio de ejecuciones'],['outage','Servicio caído'],['recovery','Servicio recuperado'],['push_enabled','Aviso Push'],['email_enabled','Aviso por correo']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={preferences[key]} onChange={e=>void save({[key]:e.target.checked})}/>{label}</label>)}
     </div><button className="secondary" onClick={()=>void enablePush()} disabled={busy}><Smartphone size={17}/>{pushReady?'Dispositivo registrado':'Activar Push en este dispositivo'}</button></>:<p>Crea tu primer proyecto para configurar los avisos.</p>}
    </>
  }
  {info&&<p className="notify-message" role="status"><CheckCircle2 size={16}/>{info}</p>}
 </section>;
}
