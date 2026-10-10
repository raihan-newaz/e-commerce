const {spawnSync}=require('child_process');const path=require('path');
const root=path.resolve(__dirname,'..');const npm=process.platform==='win32'?'npm.cmd':'npm';
for(const dir of ['server','client','storefront']){
 const result=spawnSync(npm,['ci','--no-audit','--no-fund'],{cwd:path.join(root,dir),stdio:'inherit',shell:process.platform==='win32'});
 if(result.status)process.exit(result.status||1);
}
const result=spawnSync(npm,['exec','prisma','generate'],{cwd:path.join(root,'server'),stdio:'inherit',shell:process.platform==='win32'});process.exit(result.status||0);
