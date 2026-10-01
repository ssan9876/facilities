import {readFileSync} from 'node:fs';

export const installedVersion=JSON.parse(readFileSync(new URL('./package.json',import.meta.url))).version;
export function compareVersions(a,b) {
  if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b)) throw new Error('Invalid stable version.');
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
  return 0;
}
export function setupReleases(app,env) {
  const repository=env.RELEASE_REPOSITORY||'ssan9876/go-fmx-clone';
  let cache;
  app.get('/api/releases',async(req,res)=>{
    if(req.user.role!=='admin')return res.status(403).json({error:'An administrator must check releases.'});
    if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))return res.status(503).json({error:'Release repository is invalid.'});
    if(cache&&Date.now()-cache.at<60000)return res.json(cache.body);
    try {
      const response=await fetch(`https://api.github.com/repos/${repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'Facilities-release-check'},signal:AbortSignal.timeout(8000),redirect:'error'});
      const base={installed:installedVersion,repository,updateCommand:'sudo /opt/facilities/bin/facilities-update --latest'};
      if(response.status===404)return res.json({...base,latest:null,available:false});
      if(!response.ok)throw new Error('GitHub release check failed.');
      const release=await response.json(),version=release.tag_name?.replace(/^v/,'');
      const available=!release.prerelease&&!release.draft&&compareVersions(version,installedVersion)>0;
      const body={...base,latest:version,available,url:`https://github.com/${repository}/releases/tag/v${version}`,checkedAt:new Date().toISOString()};
      cache={at:Date.now(),body};res.json(body);
    }catch{res.status(503).json({error:'Could not check GitHub releases. Try again shortly.'});}
  });
}
