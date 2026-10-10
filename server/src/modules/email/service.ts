import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dns from 'dns/promises';
import net from 'net';
import prisma from '../../prisma';
import { Prisma } from '@prisma/client';
import { config } from '../../config';
import { revealSecret } from '../../utils/security';
import { defaultTemplates, renderEmail, EmailTemplate } from './templates';

export async function getEmailSettings(db: Prisma.TransactionClient = prisma) {
  return db.emailSettings.upsert({ where:{id:'default'},update:{},create:{id:'default',templates:JSON.stringify(defaultTemplates)} });
}
export async function emailTransport(settings: Awaited<ReturnType<typeof getEmailSettings>>) {
  if (!config.integrationsEnabled) throw Object.assign(new Error('Email sending is disabled in this environment'),{status:409});
  const blocked = new net.BlockList();
  for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['224.0.0.0',4]] as const) blocked.addSubnet(address,prefix,'ipv4');
  blocked.addAddress('::1','ipv6'); blocked.addAddress('::','ipv6'); blocked.addSubnet('fc00::',7,'ipv6'); blocked.addSubnet('fe80::',10,'ipv6');
  const addresses=await dns.lookup(settings.host,{all:true});
  if (!addresses.length || addresses.some(a=>a.address.startsWith('::ffff:') || blocked.check(a.address,a.family===6?'ipv6':'ipv4'))) throw Object.assign(new Error('SMTP host must resolve to a public address'),{status:400});
  return nodemailer.createTransport({host:addresses[0].address,port:settings.port,secure:settings.secure,requireTLS:!settings.secure,
    tls:{servername:settings.host,rejectUnauthorized:true},auth:settings.username?{user:settings.username,pass:revealSecret(settings.password)}:undefined,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
}
export async function queueOrderEmail(orderId:string,event:string,resendId='',db: Prisma.TransactionClient = prisma) {
  const settings=await getEmailSettings(db); if(!settings.enabled) return;
  const templates={...defaultTemplates,...JSON.parse(settings.templates)} as Record<string,EmailTemplate>;
  const template=templates[event]; if(!template?.enabled) return;
  const order=await db.order.findUnique({where:{id:orderId},include:{items:true}}); if(!order || order.trashedAt) return;
  const store=await db.storefrontSettings.findUnique({where:{id:'default'},select:{storeName:true}});
  const rendered=renderEmail(template,order,store?.storeName||settings.fromName,config.publicOrigin);
  const recipients=[...(order.customerEmail?[{email:order.customerEmail,kind:'customer'}]:[]),...(event==='ORDER_PLACED'?settings.adminRecipients.split(',').map(email=>({email:email.trim(),kind:'admin'})):[])].filter(r=>r.email);
  for (const recipient of recipients) {
    const rawKey=`${order.id}:${event}:${recipient.kind}:${recipient.email.toLowerCase()}${resendId?':'+resendId:''}`;
    const dedupeKey=crypto.createHash("sha256").update(rawKey).digest("hex");
    await db.emailDelivery.upsert({where:{dedupeKey},update:{},create:{dedupeKey,orderId,event,recipient:recipient.email,...rendered,status:config.integrationsEnabled?'QUEUED':'PREVIEW'}});
  }
}
let running=false;
export async function processEmailQueue() {
  if(running || !config.integrationsEnabled) return;
  running=true;
  try {
    const settings=await getEmailSettings(); if(!settings.enabled) return;
    // SMTP acceptance cannot be atomically committed with the DB. A stale send is
    // marked UNKNOWN for operator review, never automatically duplicated.
    await prisma.emailDelivery.updateMany({where:{status:'SENDING',claimedAt:{lt:new Date(Date.now()-120000)}},data:{status:'UNKNOWN',error:'Delivery outcome unknown; review before resending'}});
    const jobs=await prisma.emailDelivery.findMany({where:{status:'QUEUED'},orderBy:{createdAt:'asc'},take:10});
    for(const job of jobs) {
      if (job.orderId && !await prisma.order.findFirst({where:{id:job.orderId,trashedAt:null},select:{id:true}})) {
        await prisma.emailDelivery.updateMany({where:{id:job.id,status:'QUEUED'},data:{status:'CANCELLED',error:'Order no longer available'}}); continue;
      }
      const claimed=await prisma.emailDelivery.updateMany({where:{id:job.id,status:'QUEUED'},data:{status:'SENDING',claimedAt:new Date()}}); if(!claimed.count) continue;
      try {
        const transport=await emailTransport(settings);
        const info=await transport.sendMail({from:{name:settings.fromName,address:settings.fromEmail},replyTo:settings.replyTo||undefined,to:job.recipient,subject:job.subject,html:job.html,text:job.text,messageId:`<${job.id}@${new URL(config.publicOrigin).hostname}>`});
        if(!info.accepted?.length) throw Error('Recipient not accepted');
        await prisma.emailDelivery.update({where:{id:job.id},data:{status:'SENT',sentAt:new Date(),error:null}});
      } catch {await prisma.emailDelivery.update({where:{id:job.id},data:{status:'FAILED',error:'SMTP delivery failed. Verify SMTP settings and review before resending.'}});}
    }
  } finally {running=false;}
}
export function startEmailWorker() {const timer=setInterval(()=>{void processEmailQueue().catch(()=>console.error('Email queue unavailable'));},5000);timer.unref();return timer;}
