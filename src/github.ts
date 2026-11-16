export type State = 'success'|'failure'|'running'|'cancelled'|'unknown';
export type Repo={owner:string;repo:string;label:string};
export type Run={id:number;name:string;status:string;conclusion:string|null;created_at:string;updated_at:string;head_branch:string;html_url:string};
export type Snapshot={repo:Repo;runs:Run[];error?:string;at?:string};
export const starter:Repo[]=[{owner:'davidduque29',repo:'orbit-tasks',label:'Orbit Tasks'},{owner:'davidduque29',repo:'korpelyt',label:'Korpelyt'},{owner:'davidduque29',repo:'trackvikol',label:'TrackVikol'},{owner:'davidduque29',repo:'horusdq',label:'HorusDQ'}];
export function runState(run?:Run):State{if(!run)return 'unknown';if(run.status!=='completed')return 'running';if(run.conclusion==='success')return 'success';if(run.conclusion==='failure')return 'failure';if(run.conclusion==='cancelled')return 'cancelled';return 'unknown'}
export function timeAgo(value:string,now=Date.now()){const seconds=Math.max(0,Math.round((now-new Date(value).getTime())/1000));if(!Number.isFinite(seconds))return 'Fecha desconocida';if(seconds<60)return 'Ahora';if(seconds<3600)return 'Hace '+Math.floor(seconds/60)+' min';if(seconds<86400)return 'Hace '+Math.floor(seconds/3600)+' h';return 'Hace '+Math.floor(seconds/86400)+' d'}
export async function loadRepo(repo:Repo,signal?:AbortSignal):Promise<Snapshot>{
  try{const url='https://api.github.com/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo)+'/actions/runs?per_page=12';
    const res=await fetch(url,{headers:{Accept:'application/vnd.github+json'},signal});
    if(!res.ok)return {repo,runs:[],error:res.status===404?'No disponible públicamente (privado o inexistente)':res.status===403?'Límite de API o acceso restringido':'GitHub respondió '+res.status};
    const data=await res.json() as {workflow_runs?:Run[]};return {repo,runs:data.workflow_runs||[],at:new Date().toISOString()};
  }catch(err){if(signal?.aborted)throw err;return {repo,runs:[],error:'Error de conexión con GitHub'}}
}