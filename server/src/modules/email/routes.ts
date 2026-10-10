import crypto from 'crypto';
import {Router,Request,Response,NextFunction} from 'express';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import prisma from '../../prisma';
import {authenticateToken,requireRole} from '../../middlewares/auth';
import {keepExistingSecret,maskSecret} from '../../utils/security';
import {config} from '../../config';
import {getEmailSettings,emailTransport,queueOrderEmail} from './service';
import {defaultTemplates,emailEvents,renderEmail} from './templates';
const router=Router();
router.use(authenticateToken,requireRole(['SUPER_ADMIN']),(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
const run=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
const email=z.string().trim().email().max(254);
const template=z.object({enabled:z.boolean(),subject:z.string().trim().min(1).max(200).refine(s=>!/[\r\n]/.test(s)),heading:z.string().max(300),body:z.string().max(10000)}).strict();
const schema=z.object({enabled:z.boolean(),host:z.string().trim().max(253).regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9.-]*$/),port:z.number().int().refine(p=>[25,465,587,2525].includes(p)),secure:z.boolean(),username:z.string().max(254),password:z.string().max(1000).optional(),fromName:z.string().trim().min(1).max(100).refine(s=>!/[\r\n]/.test(s)),fromEmail:email.or(z.literal('')),replyTo:email.or(z.literal('')),adminRecipients:z.string().max(2600).refine(s=>!s || s.split(',').length<=10 && s.split(',').every(v=>email.safeParse(v.trim()).success)),templates:z.record(z.enum(emailEvents),template)}).strict();
router.get('/settings',run(async(_req,res)=>{const settings=await getEmailSettings();res.json({success:true,settings:{...settings,password:maskSecret(settings.password),templates:{...defaultTemplates,...JSON.parse(settings.templates)}},sendingAllowed:config.integrationsEnabled});}));
router.put('/settings',run(async(req,res)=>{const parsed=schema.safeParse(req.body);if(!parsed.success){res.status(400).json({success:false,message:'Check SMTP fields, recipients and templates'});return;}
  const {templates,password,...data}=parsed.data;
  if(data.enabled && (!data.host || !data.fromEmail || data.port===465&&!data.secure || data.port!==465&&data.secure)){res.status(400).json({success:false,message:'Set host, sender email and matching TLS mode (465: SSL; other ports: STARTTLS)'});return;}
  const existing=await getEmailSettings();
  await prisma.emailSettings.update({where:{id:'default'},data:{...data,password:keepExistingSecret(password,existing.password),templates:JSON.stringify(templates)}});
  res.json({success:true});
}));
router.post('/preview',run(async(req,res)=>{const event=z.enum(emailEvents).safeParse(req.body.event);if(!event.success){res.status(400).json({success:false,message:'Choose a valid event'});return;}const settings=await getEmailSettings();const selected={...defaultTemplates,...JSON.parse(settings.templates)}[event.data];res.json({success:true,...renderEmail(selected,{orderNumber:'TEST-1001',customerName:'Customer',status:'PENDING',grandTotal:1260,deliveryCharge:70,items:[{productName:'Example product',quantity:1,totalPrice:1190}]},settings.fromName,config.publicOrigin)});}));
router.post('/test',rateLimit({windowMs:60000,max:3}),run(async(req,res)=>{const recipient=email.safeParse(req.body.recipient);if(!recipient.success){res.status(400).json({success:false,message:'Enter a valid recipient'});return;}const settings=await getEmailSettings();const transport=await emailTransport(settings);try{await transport.sendMail({from:{name:settings.fromName,address:settings.fromEmail},to:recipient.data,subject:'SMTP test — '+settings.fromName,text:'Your Ecommerce SMTP connection is working.'});res.json({success:true});}catch{res.status(502).json({success:false,message:'SMTP test failed. Check host, TLS mode and credentials.'});}}));
router.get('/logs',run(async(_req,res)=>{res.json({success:true,logs:await prisma.emailDelivery.findMany({orderBy:{createdAt:'desc'},take:100,select:{id:true,orderId:true,event:true,recipient:true,subject:true,status:true,error:true,createdAt:true,sentAt:true}})});}));
router.post('/resend',rateLimit({windowMs:60000,max:5}),run(async(req,res)=>{const parsed=z.object({orderId:z.string().uuid(),event:z.enum(emailEvents)}).safeParse(req.body);if(!parsed.success){res.status(400).json({success:false,message:'Choose a valid order and event'});return;}await queueOrderEmail(parsed.data.orderId,parsed.data.event,crypto.randomUUID());res.json({success:true});}));
export default router;
