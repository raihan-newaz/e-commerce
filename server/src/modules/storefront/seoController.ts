import { Request, Response } from 'express';
import prisma from '../../prisma';
import { config } from '../../config';

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!);
const pageSize = 1000;
const productWhere = { status: 'ACTIVE' };
const storeWhere = { status: 'PUBLISHED', isActive: true, slug: { not: 'maintenance' } };
const builderWhere = { published: { not: null }, publishedSlug: { not: null }, landingLink: null, thankYouLink: null };

export async function getSitemapXml(req: Request, res: Response): Promise<void> {
  const base = config.publicOrigin.replace(/\/+$/, '');
  try {
    const kind = String(req.query.kind || '');
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    if (!kind) {
      const counts = await Promise.all([prisma.product.count({ where: productWhere }), prisma.storePage.count({ where: storeWhere }), prisma.builderPage.count({ where: builderWhere })]);
      const paths = ['/api/sitemap.xml?kind=static&page=1'];
      ['products', 'pages', 'builder'].forEach((type, i) => { for (let page = 1; page <= Math.ceil(counts[i] / pageSize); page++) paths.push(`/api/sitemap.xml?kind=${type}&page=${page}`); });
      xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + paths.map(path => `<sitemap><loc>${escapeXml(base + path)}</loc></sitemap>`).join('') + '</sitemapindex>';
    } else {
      const page = Number(req.query.page || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 50000 || !['static', 'products', 'pages', 'builder'].includes(kind)) { res.status(400).send('Invalid sitemap page'); return; }
      const skip = (page - 1) * pageSize;
      const urls: Array<{ path: string; updatedAt?: Date; image?: string | null; name?: string }> = [];
      if (kind === 'static' && page === 1) urls.push({ path: '/' }, { path: '/shop' });
      if (kind === 'products') {
        const rows = await prisma.product.findMany({ where: productWhere, select: { id: true, slug: true, updatedAt: true, image: true, name: true }, orderBy: { id: 'asc' }, skip, take: pageSize });
        urls.push(...rows.map(row => ({ ...row, path: '/product/' + encodeURIComponent(row.slug || row.id) })));
      }
      if (kind === 'pages') {
        const rows = await prisma.storePage.findMany({ where: storeWhere, select: { slug: true, updatedAt: true }, orderBy: { id: 'asc' }, skip, take: pageSize });
        urls.push(...rows.map(row => ({ ...row, path: '/' + encodeURIComponent(row.slug.replace(/^flow-/, '')) })));
      }
      if (kind === 'builder') {
        const rows = await prisma.builderPage.findMany({ where: builderWhere, select: { publishedSlug: true, updatedAt: true }, orderBy: { id: 'asc' }, skip, take: pageSize });
        urls.push(...rows.map(row => ({ ...row, path: '/b/' + encodeURIComponent(row.publishedSlug!) })));
      }
      if (!urls.length) { res.status(404).send('Sitemap page not found'); return; }
      xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">';
      for (const row of urls) {
        xml += `<url><loc>${escapeXml(base + row.path)}</loc>${row.updatedAt ? `<lastmod>${row.updatedAt.toISOString().slice(0, 10)}</lastmod>` : ''}`;
        if (row.image) {
          try { const image = new URL(row.image, base + '/'); if (['https:', 'http:'].includes(image.protocol)) xml += `<image:image><image:loc>${escapeXml(image.href)}</image:loc><image:title>${escapeXml(row.name || '')}</image:title></image:image>`; } catch { /* Invalid legacy image URL is omitted. */ }
        }
        xml += '</url>';
      }
      xml += '</urlset>';
    }
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').set('X-LiteSpeed-Cache-Control', 'public, max-age=3600').send(xml);
  } catch { res.status(500).type('text/plain').send('Error generating sitemap'); }
}

export function getRobotsTxt(_req: Request, res: Response): void {
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send([
    'User-agent: *', 'Allow: /', 'Allow: /api/sitemap.xml', 'Disallow: /admin/', 'Disallow: /api/', 'Disallow: /payment/result', 'Disallow: /order/', '', `Sitemap: ${config.publicOrigin.replace(/\/+$/, '')}/api/sitemap.xml`,
  ].join('\n'));
}
