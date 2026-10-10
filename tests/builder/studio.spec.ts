import { test as base, expect, type APIRequestContext, type StorageState } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNode } from '../../server/src/modules/builder/core/registry';
import { emptyDocument } from '../../server/src/modules/builder/core/schema';

const serverRequire = createRequire(path.resolve('server/package.json'));
serverRequire('dotenv').config({ path: path.resolve('server/.env') });
const { PrismaClient } = serverRequire('@prisma/client');
const bcrypt = serverRequire('bcryptjs');
const prisma = new PrismaClient();
const suffix = randomUUID(); const email = `studio-${suffix}@builder-test.invalid`; const password = `Test-${randomUUID()}-aA1`;
let userId = ''; const createdIds: string[] = [];
let themeAuthState: StorageState;
let adminAuthState: StorageState;
const test = base.extend({ request: async ({ playwright }, use) => {
  const context = await playwright.request.newContext({baseURL:'http://localhost:3000',storageState:adminAuthState});
  await use(context); await context.dispose();
}});
const origin = { Origin: 'http://localhost:3000' };
test.beforeAll(async ({playwright}) => {
  const user = await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 10), name: 'Studio Test User', role: 'SUPER_ADMIN' } }); userId = user.id;
  const auth=await playwright.request.newContext({baseURL:'http://localhost:3000'});
  const response=await auth.post('/api/auth/login',{data:{email,password},headers:origin});expect(response.status()).toBe(200);
  adminAuthState=await auth.storageState();await auth.dispose();
});
test.afterAll(async () => {
  if (userId) {
    await prisma.builderPage.deleteMany({ where: { createdBy: userId } });
    await prisma.builderTemplate.deleteMany({ where: { createdBy: userId } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
});
async function login(request: APIRequestContext) {
  if ((await request.get('/api/auth/me')).ok()) return;
  const response = await request.post('/api/auth/login', { data: { email, password }, headers: origin }); expect(response.status(), (await response.json()).message).toBe(200);
}
test('real API: persistence, permissions, revision restore and published isolation', async ({ request, playwright }) => {
  await login(request);
  const slug = `studio-test-${suffix}`;
  const create = await request.post('/api/builder/pages', { data: { title: 'API lifecycle', slug }, headers: origin }); expect(create.status()).toBe(201);
  const page = await create.json(); createdIds.push(page.id);
  const doc = page.document; const heading = createNode('heading'); heading.props.text = 'Published text'; doc.rootNodes.push(heading);
  const save = await request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin }); expect(save.status()).toBe(200);
  const stale = await request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin }); expect(stale.status()).toBe(409);
  expect((await request.get(`/b/${slug}`)).status()).toBe(404);
  expect((await request.post(`/api/builder/pages/${page.id}/publish`, { data: { baseVersion: 2 }, headers: origin })).status()).toBe(200);
  const published = await request.get(`/b/${slug}`); expect(await published.text()).toContain('Published text'); expect(await published.text()).toContain('<script src="/api/builder/runtime.js" defer></script>');
  doc.rootNodes[0].props.text = 'Draft only'; doc.slug = `${slug}-new`;
  expect((await request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 3, document: doc }, headers: origin })).status()).toBe(200);
  expect(await (await request.get(`/b/${slug}`)).text()).not.toContain('Draft only');
  expect((await request.get(`/b/${doc.slug}`)).status()).toBe(404);
  const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  expect((await anonymous.get(`/api/builder/pages/${page.id}/preview`)).status()).toBe(401);
  expect((await anonymous.post(`/api/builder/pages/${page.id}/publish`, { data: { baseVersion: 4 } })).status()).toBe(401);
  await anonymous.dispose();
  expect((await request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 4, document: doc }, headers: { Origin: 'https://attacker.invalid' } })).status()).toBe(403);
  const malicious = structuredClone(doc); malicious.rootNodes[0].styles.color = '</style><script>alert(1)</script>';
  expect((await request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 4, document: malicious }, headers: origin })).status()).toBe(400);
  const revisions = await (await request.get(`/api/builder/pages/${page.id}/revisions`)).json();
  const restore = await request.post(`/api/builder/pages/${page.id}/restore`, { data: { baseVersion: 4, revisionId: revisions.revisions.find((revision: { version: number }) => revision.version === 2).id }, headers: origin }); expect(restore.status()).toBe(200);
  expect((await restore.json()).document.rootNodes[0].props.text).toBe('Published text');
  const concurrent = await Promise.all([request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 5, document: doc }, headers: origin }), request.put(`/api/builder/pages/${page.id}/draft`, { data: { baseVersion: 5, document: doc }, headers: origin })]);
  expect(concurrent.map(result => result.status()).sort()).toEqual([200, 409]);
  await prisma.user.update({ where: { id: userId }, data: { role: 'CALL_CENTER_AGENT' } });
  try { expect((await request.get('/api/builder/pages')).status()).toBe(403); } finally { await prisma.user.update({ where: { id: userId }, data: { role: 'SUPER_ADMIN' } }); }
});

test('visual editor: create from unified Pages, inline edit, undo, publish and reload', async ({ page }) => {
  await login(page.request); await page.goto('/admin/pages?create=visual');
  await page.getByLabel('Title', {exact:true}).fill('Studio browser test');
  const slug = 'studio-browser-'+suffix; await page.getByLabel('Public URL').fill(slug);
  await page.getByRole('button', {name:'Create & open Studio'}).click();
  await expect(page).toHaveURL(/\/admin\/builder\/[a-f0-9-]+/);
  const canvas=page.frameLocator('iframe[title="Visual page canvas"]');
  await page.getByRole('button',{name:'Heading',exact:true}).click();
  const heading=canvas.getByRole('heading',{name:'Your heading'}); await heading.dblclick();
  await heading.fill('Built with NIX Studio'); await page.keyboard.press('Tab');
  await page.getByTitle('Page Settings',{exact:true}).click();
  await page.keyboard.press('Control+z'); await expect(canvas.getByRole('heading',{name:'Your heading'})).toBeVisible();
  await page.keyboard.press('Control+Shift+z'); await expect(canvas.getByRole('heading',{name:'Built with NIX Studio'})).toBeVisible();
  const saved=page.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT');await page.keyboard.press('Control+s');expect((await saved).ok()).toBeTruthy();
  await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByRole('button',{name:'Update',exact:true})).toBeVisible();
  await page.reload();await expect(canvas.getByRole('heading',{name:'Built with NIX Studio'})).toBeVisible();
  expect(await (await page.request.get('/b/'+slug)).text()).toContain('Built with NIX Studio');
  await page.screenshot({path:'test-results/studio-editor.png',fullPage:true});
});

test('public responsive visual regression uses the lean renderer', async ({ page }) => {
  await login(page.request);
  const slug = `studio-visual-${suffix}`; const doc = emptyDocument('Visual regression', slug);
  const section = createNode('flex'); section.styles = { display: 'flex', 'flex-direction': 'column', padding: '64px', gap: '20px', 'background-color': '#edf3e8' }; section.responsiveStyles.mobile = { padding: '24px' };
  const heading = createNode('heading'); heading.props.text = 'Space for a new idea.'; heading.props.level = 'h1'; heading.styles = { 'font-size': '56px', margin: '0', 'max-width': '700px' }; heading.responsiveStyles.mobile = { 'font-size': '32px' };
  const paragraph = createNode('paragraph'); paragraph.props.text = 'A responsive page built from a versioned document.';
  const button = createNode('button'); button.props.text = 'Learn more';
  section.children.push(heading, paragraph, button); doc.rootNodes.push(section);
  const created = await (await page.request.post('/api/builder/pages', { data: { title: doc.title, slug }, headers: origin })).json();
  await page.request.put(`/api/builder/pages/${created.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin });
  await page.request.post(`/api/builder/pages/${created.id}/publish`, { data: { baseVersion: 2 }, headers: origin });
  await page.goto(`/b/${slug}`); await expect(page.getByRole('heading')).toHaveCSS('font-size', '56px');
  await expect(page).toHaveScreenshot('public-desktop.png', { animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole('heading')).toHaveCSS('font-size', '32px');
  await expect(page).toHaveScreenshot('public-mobile.png', { animations: 'disabled' });
  await expect(page.locator('script')).toHaveAttribute('src', '/api/builder/runtime.js');
});

test('design resources update multiple elements and component instances persist', async ({ page }) => {
  await login(page.request);
  const slug = `studio-design-${suffix}`; const doc = emptyDocument('Design system test', slug);
  doc.tokens.accent = '#176b53';
  const first = createNode('paragraph'); first.props.text = 'Reusable message'; first.styles.color = 'var(--accent)';
  const second = createNode('paragraph'); second.props.text = 'Updated master'; second.styles.color = 'var(--accent)';
  doc.rootNodes.push(first, second);
  const created = await (await page.request.post('/api/builder/pages', { data: { title: doc.title, slug }, headers: origin })).json();
  expect((await page.request.put(`/api/builder/pages/${created.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin })).ok()).toBeTruthy();
  await page.goto(`/admin/builder/${created.id}`);
  const canvas = page.frameLocator('iframe[title="Visual page canvas"]');
  await page.getByRole('button', { name: 'Site Style', exact: true }).click();
  const token = page.getByLabel('--accent · 2 references', { exact: true }); await token.fill('#a12244'); await token.press('Tab');
  await expect(canvas.getByText('Reusable message', { exact: true })).toHaveCSS('color', 'rgb(161, 34, 68)');
  await expect(canvas.getByText('Updated master', { exact: true })).toHaveCSS('color', 'rgb(161, 34, 68)');
  await canvas.getByText('Reusable message', { exact: true }).click();
  await page.getByLabel('New resource key').fill('message');
  await page.locator('.studio-left').getByText('Component Masters', { exact: true }).click();
  await page.getByRole('button', { name: /Create from selection$/ }).click();
  await page.getByRole('button', { name: 'Insert instance', exact: true }).click();
  await expect(canvas.getByText('Reusable message', { exact: true })).toHaveCount(2);
  await canvas.getByText('Updated master', { exact: true }).click();
  await page.getByRole('button', { name: 'Replace master with selection', exact: true }).click();
  await expect(canvas.getByText('Updated master', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByLabel('Template name').fill('Component test template');
  await page.getByRole('button', { name: 'Save to My Templates' }).click();
  await expect(page.getByText('Component test template', { exact: true })).toBeVisible();
  await page.getByTitle('Page Settings',{exact:true}).click(); await page.keyboard.press('Control+s');
  await expect.poll(async()=>JSON.stringify((await (await page.request.get(`/api/builder/pages/${created.id}`)).json()).document.components)).toContain('Updated master');
  await page.reload(); await expect(canvas.getByText('Updated master', { exact: true })).toHaveCount(3);
});

test('granular access grants are enforced and cannot be changed by designers', async ({ request, playwright }) => {
  await login(request);
  const staff = await prisma.user.create({ data: { email: `viewer-${suffix}@builder-test.invalid`, password: await bcrypt.hash(password, 10), name: 'Studio Permission Test', role: 'CALL_CENTER_AGENT', permissions: JSON.stringify({ 'unrelated.permission': true }) } });
  const designer = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    expect((await designer.post('/api/auth/login', { data: { email: staff.email, password }, headers: origin })).status()).toBe(200);
    expect((await designer.get('/api/builder/pages')).status()).toBe(403);
    const permission = await request.put(`/api/builder/permissions/${staff.id}`, { data: { updatedAt: staff.updatedAt.toISOString(), permissions: { access: true, edit: true, publish: false, templates: false } }, headers: origin }); expect(permission.status()).toBe(200);
    expect((await designer.get('/api/builder/pages')).status()).toBe(200);
    expect((await (await designer.get('/api/auth/me')).json()).user.builderAccess).toBe(true);
    expect((await designer.post(`/api/builder/pages/${randomUUID()}/publish`, { data: { baseVersion: 1 }, headers: origin })).status()).toBe(403);
    expect((await designer.get('/api/builder/permissions')).status()).toBe(403);
    expect((await request.put(`/api/builder/permissions/${staff.id}`, { data: { updatedAt: staff.updatedAt.toISOString(), permissions: { access: false } }, headers: origin })).status()).toBe(409);
    const persisted = await prisma.user.findUnique({ where: { id: staff.id } }); expect(JSON.parse(persisted.permissions)['unrelated.permission']).toBe(true);
  } finally { await designer.dispose(); await prisma.auditLog.deleteMany({ where: { userId: staff.id } }); await prisma.user.delete({ where: { id: staff.id } }); }
});

test('native forms validate, store once, protect submissions and support review/export', async ({ page, request }) => {
  await login(request);
  const slug = `studio-form-${suffix}`; const doc = emptyDocument('Contact us', slug); const form = createNode('form'); form.props.formName = 'Contact request';
  const emailField = form.children[0]; emailField.props = { ...emailField.props, fieldName: 'email', label: 'Email address', inputType: 'email', required: true };
  const messageField = createNode('form-field'); messageField.props = { ...messageField.props, fieldName: 'message', label: 'Message', inputType: 'textarea', required: true };
  const consent = createNode('form-field'); consent.props = { ...consent.props, fieldName: 'consent', label: 'I agree to be contacted', inputType: 'checkbox', required: true };
  form.children.splice(1, 0, messageField, consent); doc.rootNodes.push(form);
  const created = await (await request.post('/api/builder/pages', { data: { title: doc.title, slug }, headers: origin })).json();
  expect((await request.put(`/api/builder/pages/${created.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin })).status()).toBe(200);
  expect((await request.post(`/api/builder/pages/${created.id}/publish`, { data: { baseVersion: 2 }, headers: origin })).status()).toBe(200);
  const publicResponse = await page.goto(`/b/${slug}`); expect(publicResponse?.headers()['cache-control']).toContain('no-store');
  await expect(page.locator('script')).toHaveAttribute('src','/api/builder/runtime.js');
  const token = await page.locator('input[name="_token"]').inputValue(); const action = `/b/${slug}/forms/${form.id}`;
  const invalid = await page.request.post(action, { form: { _token: token, email: 'not-an-email', message: 'hello' }, headers: origin }); expect(invalid.status()).toBe(400);
  expect(await invalid.text()).toContain('Email address');
  const forged = await page.request.post(action, { form: { _token: 'forged', email: 'hello@example.com', message: 'hello', consent: 'on' }, headers: origin }); expect(forged.status()).toBe(403);
  await page.getByLabel('Email address').fill('visitor@example.com'); await page.getByRole('textbox', { name: 'Message', exact: true }).fill('=1+1'); await page.getByLabel('I agree to be contacted').check();
  await page.screenshot({ path: 'test-results/studio-public-form.png', fullPage: true });
  await page.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Response received' })).toBeVisible();
  expect((await page.request.get(`/api/builder/pages/${created.id}/submissions`)).status()).toBe(401);
  const replay = await page.request.post(action, { form: { _token: token, email: 'visitor@example.com', message: '=1+1', consent: 'on' }, headers: origin }); expect(replay.status()).toBe(200);
  const listing = await (await request.get(`/api/builder/pages/${created.id}/submissions`)).json(); expect(listing.submissions).toHaveLength(1);
  const record = listing.submissions[0]; expect(record.values.email).toBe('visitor@example.com');
  const csv = await request.get(`/api/builder/pages/${created.id}/submissions?format=csv`); expect(await csv.text()).toContain("'=1+1");
  expect((await request.patch(`/api/builder/submissions/${record.id}`, { data: { updatedAt: record.updatedAt, status: 'REVIEWED' }, headers: origin })).status()).toBe(200);
  const filtered = await (await request.get(`/api/builder/pages/${created.id}/submissions?status=REVIEWED&search=visitor`)).json(); expect(filtered.submissions).toHaveLength(1);
  await login(page.request); await page.goto(`/admin/builder/${created.id}`); await page.getByRole('button', { name: 'Forms', exact: true }).click();
  await page.getByText('Contact request', { exact: true }).click(); await expect(page.getByText('visitor@example.com', { exact: true })).toBeVisible();
  expect((await request.delete(`/api/builder/submissions/${record.id}`, { headers: origin })).status()).toBe(204);
  expect((await (await request.get(`/api/builder/pages/${created.id}/submissions`)).json()).submissions).toHaveLength(0);
});

test('dynamic loops query only public catalog records and refresh without republishing', async ({ page, request }) => {
  await login(request);
  themeAuthState = await request.storageState();
  const title = `Studio loop ${suffix}`;
  const product = await prisma.product.create({ data: { name: title, sku: `STUDIO-${suffix}`, status: 'ACTIVE', regularPrice: 150, buyPrice: 98765, description: 'Public product description' } });
  const draft = await prisma.product.create({ data: { name: `${title} draft`, sku: `STUDIO-DRAFT-${suffix}`, status: 'DRAFT' } });
  try {
    const slug = `studio-loop-${suffix}`; const doc = emptyDocument('Product listing', slug); const loop = createNode('loop'); loop.props.search = title; doc.rootNodes.push(loop);
    const created = await (await request.post('/api/builder/pages', { data: { title: doc.title, slug }, headers: origin })).json();
    expect((await request.put(`/api/builder/pages/${created.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin })).status()).toBe(200);
    const context = await request.post('/api/builder/render-context', { data: { document: doc }, headers: origin }); expect(context.status()).toBe(200);
    const data = await context.json(); expect(data.loops[loop.id]).toHaveLength(1); expect(data.loops[loop.id][0].title).toBe(title); expect(JSON.stringify(data)).not.toContain('98765');
    expect((await request.post(`/api/builder/pages/${created.id}/publish`, { data: { baseVersion: 2 }, headers: origin })).status()).toBe(200);
    await page.goto(`/b/${slug}`); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', new RegExp(`/product/${product.id}$`));
    await expect(page.getByText(`${title} draft`, { exact: true })).toHaveCount(0);
    await prisma.product.update({ where: { id: product.id }, data: { description: 'Changed catalog description' } }); await page.reload(); await expect(page.getByText('Changed catalog description')).toBeVisible();
    await expect(page.locator('script')).toHaveAttribute('src', '/api/builder/runtime.js');
    await login(page.request); await page.goto(`/admin/builder/${created.id}`); await expect(page.frameLocator('iframe').getByRole('heading', { name: title, exact: true })).toBeVisible();
  } finally { await prisma.product.deleteMany({ where: { id: { in: [product.id, draft.id] } } }); }
});

test('theme rules publish route-specific header and footer with revision protection', async ({ playwright, page }) => {
  const request = await playwright.request.newContext({ baseURL: 'http://localhost:3000', ...(themeAuthState ? { storageState: themeAuthState } : {}) });
  if (!themeAuthState) await login(request);
  const original = await prisma.builderTheme.findUnique({ where: { id: 'default' } });
  const oldVersions = await prisma.builderThemeRevision.findMany({ select: { version: true } });
  const oldVersionSet = new Set(oldVersions.map((item: { version: number }) => item.version));
  const makePage = async (title: string) => {
    const slug = `studio-theme-${title.toLowerCase()}-${suffix}`;
    const doc = emptyDocument(title, slug); const heading = createNode('heading'); heading.props.text = `${title} template`; doc.rootNodes.push(heading);
    if (title === 'Header') doc.rootNodes.push(createNode('nav'));
    const created = await (await request.post('/api/builder/pages', { data: { title, slug }, headers: origin })).json();
    expect((await request.put(`/api/builder/pages/${created.id}/draft`, { data: { baseVersion: 1, document: doc }, headers: origin })).status()).toBe(200);
    expect((await request.post(`/api/builder/pages/${created.id}/publish`, { data: { baseVersion: 2 }, headers: origin })).status()).toBe(200);
    return { id: created.id, slug };
  };
  try {
    const header = await makePage('Header'); const footer = await makePage('Footer'); const body = await makePage('Body');
    const theme = await (await request.get('/api/builder/theme')).json();
    const rules = { schemaVersion: 1, rules: [
      { id: randomUUID(), area: 'header', pageId: header.id, include: [`/b/${body.slug}`], exclude: [], priority: 0 },
      { id: randomUUID(), area: 'footer', pageId: footer.id, include: ['/b/*'], exclude: [`/b/${header.slug}`], priority: 0 },
    ] };
    const saved = await request.put('/api/builder/theme/draft', { data: { baseVersion: theme.version, document: rules }, headers: origin }); expect(saved.status()).toBe(200);
    const newVersion = (await saved.json()).version;
    const preview = await request.get(`/api/builder/theme/preview/${body.id}`); expect(preview.status()).toBe(200);
    const previewHtml = await preview.text(); expect(previewHtml).toContain('Header template'); expect(previewHtml).toContain('Footer template');
    expect(preview.headers()['x-robots-tag']).toContain('noindex');
    expect(await (await request.get(`/b/${body.slug}`)).text()).not.toContain('<header');
    expect((await request.post('/api/builder/theme/publish', { data: { baseVersion: theme.version }, headers: origin })).status()).toBe(409);
    expect((await request.post('/api/builder/theme/publish', { data: { baseVersion: newVersion }, headers: origin })).status()).toBe(200);
    await page.goto(`/b/${body.slug}`);
    await expect(page.locator('header')).toContainText('Header template');
    await expect(page.locator('header nav[aria-label="Primary navigation"] a')).toHaveCount(2);
    await expect(page.locator('main')).toContainText('Body template');
    await expect(page.locator('footer')).toContainText('Footer template');
    await page.goto(`/b/${header.slug}`);
    await expect(page.locator('footer')).toHaveCount(0);
    const revisions = await (await request.get('/api/builder/theme/revisions')).json(); expect(revisions.revisions[0].action).toBe('publish');
  } finally {
    await prisma.builderThemeRevision.deleteMany({ where: { version: { notIn: [...oldVersionSet] } } });
    if (original) await prisma.builderTheme.upsert({ where: { id: 'default' }, create: original, update: original });
    else await prisma.builderTheme.deleteMany({ where: { id: 'default' } });
    await request.dispose();
  }
});


test('Studio landing publishes checkout atomically and keeps draft changes isolated', async ({request,page}) => {
 await login(request);
 const storeIds:string[]=[];
 const product=await prisma.product.create({data:{name:'Landing offer '+suffix,sku:'LANDING-'+suffix,status:'ACTIVE',stockQuantity:20,regularPrice:500}});
 try {
  const slug='studio-offer-'+suffix;
  const response=await request.post('/api/builder/landings',{data:{title:'Studio offer',slug},headers:origin});expect(response.status()).toBe(201);
  const link=(await response.json()).link;storeIds.push(link.storePageId);
  const url='/api/builder/landings/by-builder/'+link.builderPageId+'/checkout';
  const checkout=await (await request.get(url)).json();
  expect((await request.put(url,{data:{title:checkout.title,metaTitle:checkout.metaTitle,metaDescription:checkout.metaDescription,version:checkout.version,checkout:{...checkout.checkout,productIds:[product.id]}},headers:origin})).status()).toBe(200);
  expect((await request.get('/api/builder/public-landings/flow-'+slug)).status()).toBe(404);
  const builder=await (await request.get('/api/builder/pages/'+link.builderPageId)).json();
  const headline=createNode('heading');headline.props.text='Studio-designed offer';builder.document.rootNodes=[headline];
  expect((await request.put('/api/builder/pages/'+link.builderPageId+'/draft',{data:{baseVersion:builder.version,document:builder.document},headers:origin})).status()).toBe(200);
  expect((await request.post('/api/builder/pages/'+link.builderPageId+'/publish',{data:{baseVersion:builder.version+1},headers:origin})).status()).toBe(200);
  await page.goto('/'+slug);await expect(page.getByRole('heading',{name:'Studio-designed offer'})).toBeVisible();await expect(page.locator('#order')).toHaveCount(1);await expect(page.locator('#order')).toContainText(product.name);
  builder.document.rootNodes[0].props.text='Draft headline only';
  expect((await request.put('/api/builder/pages/'+link.builderPageId+'/draft',{data:{baseVersion:builder.version+2,document:builder.document},headers:origin})).status()).toBe(200);
  const live=await (await request.get('/api/builder/public-landings/flow-'+slug)).json();expect(live.html).toContain('Studio-designed offer');expect(live.html).not.toContain('Draft headline only');
  const copied=await request.post('/api/builder/landings/'+link.storePageId+'/duplicate',{data:{title:'Studio offer copy',slug:slug+'-copy'},headers:origin});expect(copied.status()).toBe(201);
  const copy=(await copied.json()).link;storeIds.push(copy.storePageId);expect(copy.storePage.status).toBe('DRAFT');
  expect((await request.get('/api/builder/public-landings/flow-'+slug+'-copy')).status()).toBe(404);
  expect(link.thankYouPageId).toBeTruthy();expect((await request.get('/api/builder/pages/'+link.thankYouPageId)).status()).toBe(200);
  expect((await request.post('/api/builder/pages/'+link.builderPageId+'/unpublish',{data:{baseVersion:builder.version+3},headers:origin})).status()).toBe(200);
  expect((await request.get('/api/builder/public-landings/flow-'+slug)).status()).toBe(404);
 } finally {
  const links=await prisma.builderLanding.findMany({where:{storePageId:{in:storeIds}}});
  await prisma.builderPage.deleteMany({where:{id:{in:links.flatMap((l:any)=>[l.builderPageId,l.thankYouPageId].filter(Boolean))}}});
  await prisma.storePage.deleteMany({where:{id:{in:storeIds}}});await prisma.product.delete({where:{id:product.id}});
 }
});
