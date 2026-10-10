import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const requireServer=createRequire(path.resolve('server/package.json'));
requireServer('dotenv').config({path:path.resolve('server/.env')});
if(new URL(process.env.DATABASE_URL!).pathname!=='/nix_ecommerce_dev') throw Error('Browser tests require the isolated test database');
const {PrismaClient}=requireServer('@prisma/client');const bcrypt=requireServer('bcryptjs');const db=new PrismaClient();
const email=`browser-${randomUUID()}@example.invalid`,password=`Test-${randomUUID()}`;let userId='';
test.beforeAll(async()=>{const user=await db.user.create({data:{email,password:await bcrypt.hash(password,10),name:'Browser verification',role:'SUPER_ADMIN'}});userId=user.id;});
test.afterAll(async()=>{if(userId){await db.auditLog.deleteMany({where:{userId}});await db.user.delete({where:{id:userId}});}await db.$disconnect();});
test('storefront and landing retain layout on desktop and mobile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await expect(page.locator('#root')).not.toBeEmpty();
 await page.goto('/borka-dubai-cherry');await expect(page.locator('#order')).toBeVisible({timeout:30000});
 const orderLink=page.locator('a[href="#order"],a[href="#checkout"],a[href="#order-form"]').first();if(await orderLink.count()){await orderLink.click();await expect.poll(()=>page.locator('#order').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(300);}
 await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.locator('#order')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 const input=page.locator('#order input[autocomplete="name"]');expect(await input.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 expect(errors).toEqual([]);
});
test('admin deep links, login, refresh, email preview and logout use /admin',async({page})=>{
 await page.goto('/admin/orders');await expect(page).toHaveURL(/\/admin\/login$/);
 const login=await page.request.post('/api/auth/login',{data:{email,password},headers:{Origin:'http://localhost:3000'}});expect(login.status()).toBe(200);
 await page.goto('/admin/pages');await expect(page.getByRole('heading',{name:/Pages/i}).first()).toBeVisible();await page.reload();await expect(page).toHaveURL(/\/admin\/pages$/);
 await page.goto('/admin/settings/email');await expect(page.getByRole('heading',{name:'Email notifications'})).toBeVisible();
 await page.getByRole('button',{name:'Save & preview'}).click();await expect(page.locator('iframe[title="Email preview"]')).toBeVisible();
 await page.request.post('/api/auth/logout',{headers:{Origin:'http://localhost:3000'}});await page.goto('/admin/orders');await expect(page).toHaveURL(/\/admin\/login$/);
});

test('landing checkout shows both product names and images on thank-you and refresh',async({page})=>{
 const slug='browser-checkout-'+randomUUID(),phone='017'+String(Date.now()).slice(-8);let link:any;const ids:string[]=[];
 const headers={Origin:'http://localhost:3000'};
 try {
  await page.request.post('/api/auth/login',{data:{email,password},headers});
  for(const name of ['First product','Second product']){const p=await db.product.create({data:{name,sku:randomUUID(),status:'ACTIVE',stockQuantity:10,regularPrice:100,image:'/uploads/media/borka-dubai-cherry.jpg'}});ids.push(p.id);}
  link=(await (await page.request.post('/api/builder/landings',{data:{title:'Browser checkout',slug},headers})).json()).link;
  const url='/api/builder/landings/by-builder/'+link.builderPageId+'/checkout';const c=await (await page.request.get(url)).json();
  expect((await page.request.put(url,{data:{title:c.title,metaTitle:c.metaTitle,metaDescription:c.metaDescription,version:c.version,checkout:{...c.checkout,selection:'MULTI',minProducts:1,maxProducts:2,productIds:ids}},headers})).status()).toBe(200);
  expect((await page.request.post('/api/builder/pages/'+link.builderPageId+'/publish',{data:{baseVersion:1},headers})).status()).toBe(200);
  await page.request.post('/api/auth/logout',{headers});
  await page.goto('/'+slug);await page.locator('.landing-product-choice').filter({hasText:'Second product'}).locator('input').check();
  await page.locator('input[autocomplete="name"]').fill('Browser checkout test');await page.locator('input[autocomplete="tel"]').fill(phone);await page.locator('#order textarea').fill('Test street, Dhaka, Bangladesh');
  await page.locator('#order input[type="email"]').fill('customer@example.invalid');
  await page.locator('#order .landing-submit').click();
  await expect(page).toHaveURL(new RegExp('/'+slug+'/thank-you\\?order='));
  await expect(page.locator('.landing-thankyou-product')).toHaveCount(2);
  await expect(page.locator('.landing-thankyou-product')).toContainText(['First product','Second product']);
  for(const img of await page.locator('.landing-thankyou-product img').all())await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
  await page.reload();await expect(page.locator('.landing-thankyou-product')).toHaveCount(2);
 } finally {
  const orders=await db.order.findMany({where:{customerPhone:phone},select:{id:true}});const orderIds=orders.map((o:any)=>o.id);
  await db.messageLog.deleteMany({where:{orderId:{in:orderIds}}});await db.orderItem.deleteMany({where:{orderId:{in:orderIds}}});await db.order.deleteMany({where:{id:{in:orderIds}}});await db.customer.deleteMany({where:{phone}});
  if(link){await db.builderPage.deleteMany({where:{id:{in:[link.builderPageId,link.thankYouPageId].filter(Boolean)}}});await db.storePage.deleteMany({where:{id:link.storePageId}});}
  await db.stockMovement.deleteMany({where:{productId:{in:ids}}});await db.product.deleteMany({where:{id:{in:ids}}});
 }
});
