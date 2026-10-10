// Smoke the image without connecting to a real database or external providers.
const {execFileSync}=require('child_process');const path=require('path');const assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),name='nix-ecommerce-smoke';
const docker=(...args)=>execFileSync('docker',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
(async()=>{
 let created=false;
 try {
  docker('run','-d','--name',name,'--label','nix.test=unified-smoke','--init','--read-only','--tmpfs','/tmp:size=64m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','768m','--cpus','1','--pids-limit','128','-p','127.0.0.1:3012:3000','-v',root+'/server/uploads:/app/server/uploads',
   '-e','PORT=3000','-e','API_HOST=0.0.0.0','-e','PUBLIC_ORIGIN=http://localhost:3012','-e','CLIENT_URL=http://localhost:3012','-e','DATABASE_URL=mysql://smoke:unused@127.0.0.1:9/isolated?connect_timeout=1','-e','JWT_SECRET=synthetic-smoke-secret-only-000000000000000000000000','-e','DATA_ENCRYPTION_KEY=synthetic-smoke-key-only-00000000000000000000000','-e','INTEGRATIONS_ENABLED=false','nix-ecommerce:local');created=true;
  const origin='http://localhost:3012';let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  assert.ok(ready,'container process liveness');
  assert.equal((await fetch(origin+'/api/ready')).status,503,'unavailable DB must be reported');
  for(const url of ['/','/admin/login','/borka-dubai-cherry'])assert.equal((await fetch(origin+url)).status,200,url);
  for(const url of ['/api/missing','/assets/missing.js','/admin/assets/missing.js'])assert.equal((await fetch(origin+url)).status,404,url);
  const info=JSON.parse(docker('inspect',name))[0];assert.equal(info.Config.User,'node');assert.equal(info.HostConfig.ReadonlyRootfs,true);
  assert.equal(docker('exec',name,'node','-e',"const fs=require('fs');console.log(fs.existsSync('/app/server/.env'),fs.existsSync('/app/client/node_modules'),fs.existsSync('/app/server/node_modules/typescript'))"),'false false false');
  console.log('Docker smoke passed: non-root/read-only, route shells, true 404s, DB failure 503, no baked secrets or dev tools.');
 } finally {if(created)docker('rm','-f',name);}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
