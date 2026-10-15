import { Request, Response } from 'express';
import prisma from '../../prisma';
import { config } from '../../config';

const escapeXml = (unsafe: string): string => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

/**
 * Dynamic XML Sitemap for Google Search Console and other crawlers.
 * Gathers all active products, published store pages, and key storefront routes.
 */
export async function getSitemapXml(_req: Request, res: Response): Promise<void> {
  try {
    const baseUrl = (config.publicOrigin || 'https://nix.bd').replace(/\/+$/, '');

    const [products, pages] = await Promise.all([
      prisma.product.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, slug: true, updatedAt: true, image: true, name: true },
        orderBy: { updatedAt: 'desc' },
        take: 2000,
      }),
      prisma.storePage.findMany({
        where: { status: 'PUBLISHED', isActive: true },
        select: { slug: true, updatedAt: true },
        take: 500,
      }),
    ]);

    const staticRoutes = [
      { path: '/', priority: '1.0', changefreq: 'daily', lastmod: new Date().toISOString() },
      { path: '/shop', priority: '0.9', changefreq: 'daily', lastmod: new Date().toISOString() },
      { path: '/track', priority: '0.5', changefreq: 'monthly', lastmod: new Date().toISOString() },
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

    for (const route of staticRoutes) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(`${baseUrl}${route.path}`)}</loc>\n`;
      xml += `    <lastmod>${route.lastmod.split('T')[0]}</lastmod>\n`;
      xml += `    <changefreq>${route.changefreq}</changefreq>\n`;
      xml += `    <priority>${route.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    for (const page of pages) {
      if (['maintenance'].includes(page.slug)) continue;
      const lastmod = page.updatedAt ? page.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(`${baseUrl}/${encodeURIComponent(page.slug)}`)}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
    }

    for (const product of products) {
      const identifier = product.slug || product.id;
      const lastmod = product.updatedAt ? product.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(`${baseUrl}/product/${encodeURIComponent(identifier)}`)}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.8</priority>\n`;
      if (product.image) {
        const imageUrl = product.image.startsWith('http') ? product.image : `${baseUrl}${product.image}`;
        xml += `    <image:image>\n`;
        xml += `      <image:loc>${escapeXml(imageUrl)}</image:loc>\n`;
        xml += `      <image:title>${escapeXml(product.name)}</image:title>\n`;
        xml += `    </image:image>\n`;
      }
      xml += `  </url>\n`;
    }

    xml += `</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('X-LiteSpeed-Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (error) {
    console.error('[SEO] Error generating sitemap.xml:', error);
    res.status(500).type('text/plain').send('Error generating sitemap');
  }
}

/**
 * Standard robots.txt for search engine crawlers.
 */
export function getRobotsTxt(_req: Request, res: Response): void {
  const baseUrl = (config.publicOrigin || 'https://nix.bd').replace(/\/+$/, '');
  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /payment/result',
    'Disallow: /order/',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-LiteSpeed-Cache-Control', 'public, max-age=86400');
  res.send(robots);
}
