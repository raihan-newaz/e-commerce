import {Response} from 'express';
import prisma from '../../prisma';
export async function replayCheckout(key:string,hash:string,res:Response) {
  const attempt=await prisma.checkoutAttempt.findUnique({where:{key}}); if(!attempt)return false;
  res.setHeader('Cache-Control','no-store');
  if(attempt.payloadHash!==hash){res.status(409).json({success:false,message:'Idempotency conflict: checkout data changed'});return true;}
  if(attempt.response){res.status(200).json(JSON.parse(attempt.response));return true;}
  const order=attempt.orderId?await prisma.order.findUnique({where:{id:attempt.orderId}}):null;
  if(!order){res.status(409).json({success:false,message:'Checkout is still processing. Retry with the same key.'});return true;}
  if(order.status==='CANCELLED'){res.status(409).json({success:false,message:'This payment attempt was cancelled. Start a new checkout attempt.'});return true;}
  const payment=order.paymentMethod==='UDDOKTAPAY'?await prisma.paymentAttempt.findFirst({where:{orderId:order.id},orderBy:{createdAt:'desc'}}):null;
  if(order.paymentMethod==='UDDOKTAPAY'&&!payment?.paymentUrl){res.status(409).json({success:false,message:'Payment initiation outcome is pending. Contact support with your order number.',orderNumber:order.orderNumber});return true;}
  res.status(200).json({success:true,message:'Your order has been placed',order:{orderNumber:order.orderNumber,status:order.status,subtotal:order.subtotal,deliveryCharge:order.deliveryCharge,grandTotal:order.grandTotal,paymentMethod:order.paymentMethod},...(payment?.paymentUrl?{paymentUrl:payment.paymentUrl}:{})});return true;
}
