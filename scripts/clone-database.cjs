// Copies source data into a NEW local test database. Never overwrites a database.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),dotenv=require(path.join(root,'server/node_modules/dotenv'));
const source=dotenv.parse(fs.readFileSync(process.env.SOURCE_ENV || 'D:/Antigravity/NIX Order manage/server/.env'));
const url=new URL(source.DATABASE_URL),db=decodeURIComponent(url.pathname.slice(1)),target='nix_ecommerce_dev';
if (!['127.0.0.1','localhost'].includes(url.hostname) || db===target || !/^[a-zA-Z0-9_]+$/.test(db)) throw Error('Only a distinct local source database is supported');
const bin=process.env.MYSQL_BIN || 'C:/xampp/mysql/bin',dir=path.join(root,'.local'); fs.mkdirSync(dir,{recursive:true});
const credentials=path.join(dir,'clone.cnf'),dump=path.join(dir,'source.sql');
const quote=v=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')+'"';
fs.writeFileSync(credentials,`[client]\nhost=${quote(url.hostname)}\nport=${url.port||3306}\nuser=${quote(decodeURIComponent(url.username))}\npassword=${quote(decodeURIComponent(url.password))}\n`,{mode:0o600});
const executable=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
const adminArgs=['-h',url.hostname,'-P',url.port||'3306','-u',process.env.MYSQL_ADMIN_USER||'root'];
const adminEnv={...process.env,...(process.env.MYSQL_ADMIN_PASSWORD ? {MYSQL_PWD:process.env.MYSQL_ADMIN_PASSWORD}: {})};
function mysql(sql) {return cp.execFileSync(executable('mysql'),[...adminArgs,'--batch','--skip-column-names'],{input:sql,encoding:'utf8',env:adminEnv,stdio:['pipe','pipe','pipe']});}
try {
  if(mysql(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${target}'`).trim()) throw Error('Target database already exists; refusing to overwrite it');
  const out=fs.openSync(dump,'w');
  try {cp.execFileSync(executable('mysqldump'),[`--defaults-extra-file=${credentials}`,'--single-transaction','--skip-lock-tables','--default-character-set=utf8mb4',db],{stdio:['ignore',out,'pipe']});} finally {fs.closeSync(out);}
  mysql(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const input=fs.openSync(dump,'r');
  try {cp.execFileSync(executable('mysql'),[...adminArgs,'--default-character-set=utf8mb4',target],{env:adminEnv,stdio:[input,'ignore','pipe']});} finally {fs.closeSync(input);}
  const dbPassword=crypto.randomBytes(32).toString('hex');
  mysql(`CREATE USER 'nix_ecommerce_dev'@'127.0.0.1' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON \`${target}\`.* TO 'nix_ecommerce_dev'@'127.0.0.1';`);
  url.username='nix_ecommerce_dev'; url.password=dbPassword;
  url.pathname='/'+target;
  url.searchParams.set('connection_limit','5');
  url.searchParams.set('pool_timeout','10');
  url.searchParams.set('connect_timeout','5');
  const env={...source,DATABASE_URL:url.toString(),NODE_ENV:'development',PORT:'3000',API_HOST:'127.0.0.1',PUBLIC_ORIGIN:'http://localhost:3000',CLIENT_URL:'http://localhost:3000,http://127.0.0.1:3000',BUILDER_STOREFRONT_ORIGIN:'http://localhost:3000',STOREFRONT_URL:'http://localhost:3000',PUBLIC_API_URL:'http://localhost:3000',INTEGRATIONS_ENABLED:'false',DATA_ENCRYPTION_KEY:source.DATA_ENCRYPTION_KEY||source.JWT_SECRET||'development-only-change-me-nix-2026',JWT_SECRET:crypto.randomBytes(48).toString('hex')};
  fs.writeFileSync(path.join(root,'server/.env'),Object.entries(env).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});
  console.log('Database copied to nix_ecommerce_dev; isolated server/.env created. External integrations disabled.');
} catch(error) {console.error(error.message?.startsWith('Target') ? error.message : `Database clone failed (${error.code || error.status || 'unknown'}). Source data was not modified.`); if(error.stderr) console.error(String(error.stderr).replace(/password[^\n]*/gi,'password [redacted]')); process.exitCode=1;}
finally {for(const p of [credentials,dump]) if(fs.existsSync(p)) fs.unlinkSync(p);}
