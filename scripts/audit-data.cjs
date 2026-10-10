const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');
const dotenv=require(path.join(root,'server/node_modules/dotenv'));const {PrismaClient}=require(path.join(root,'server/node_modules/@prisma/client'));
const env=dotenv.parse(fs.readFileSync(path.join(root,'server/.env')));
if(new URL(env.DATABASE_URL).pathname!=='/nix_ecommerce_dev') throw Error('Audit is restricted to the test copy');
const source=dotenv.parse(fs.readFileSync(process.env.SOURCE_ENV||'D:/Antigravity/NIX Order manage/server/.env'));
const target=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}}),original=new PrismaClient({datasources:{db:{url:source.DATABASE_URL}}});
(async()=>{
 const tables=await original.$queryRaw`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`;
 const counts=[],media=new Set(),external=new Set();
 for(const {name} of tables){if(!/^[A-Za-z0-9_]+$/.test(name))continue;
   const a=await original.$queryRawUnsafe('SELECT COUNT(*) AS n FROM `'+name+'`'),b=await target.$queryRawUnsafe('SELECT COUNT(*) AS n FROM `'+name+'`');
   counts.push({table:name,source:Number(a[0].n),copy:Number(b[0].n)});
   const rows=await target.$queryRawUnsafe('SELECT * FROM `'+name+'`');
   const raw=JSON.stringify(rows,(_k,v)=>typeof v==='bigint'?v.toString():v);
   for(const match of raw.matchAll(/(?:https?:[^"\s<>\\]+)?\/uploads\/media\/([^"\s<>\\?#]+)/g)){media.add(decodeURIComponent(match[1]));if(match[0].startsWith('http'))external.add(match[0].split('/uploads/')[0]);}
 }
 const missing=[...media].filter(file=>!fs.existsSync(path.join(root,'server/uploads/media',file))&&!fs.existsSync(path.join(root,'storefront/public/uploads/media',file)));
 const pages=await target.storePage.findMany({where:{OR:[{slug:'admin'},{slug:'flow-admin'},{slug:'assets'},{slug:'flow-assets'}]},select:{id:true,slug:true}});
 const report={generatedAt:new Date().toISOString(),database:'nix_ecommerce_dev',counts,missingMedia:missing,absoluteMediaOrigins:[...external],reservedSlugCollisions:pages};
 fs.mkdirSync(path.join(root,'.local'),{recursive:true});fs.writeFileSync(path.join(root,'.local/data-audit.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({tables:counts.length,countMismatches:counts.filter(c=>c.source!==c.copy),mediaReferences:media.size,missingMedia:missing.length,reservedSlugCollisions:pages.length}));
})().finally(async()=>{await target.$disconnect();await original.$disconnect();});
