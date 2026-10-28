import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getMetaCatalogFeed = async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        variants: true,
        category: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    const storeUrl = process.env.STORE_URL || 'https://xonitspace.com';

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Product Catalog Feed</title>
    <link>${storeUrl}</link>
    <description>Dynamic product feed for Meta Ads</description>
`;

    for (const product of products) {
      if (!product.variants || product.variants.length === 0) continue;

      for (const variant of product.variants) {
        // Meta requires a unique ID per variant
        const id = variant.sku || variant.id;
        const title = variant.name ? `${product.name} - ${variant.name}` : product.name;
        const description = product.description || title;
        const link = `${storeUrl}/product/${product.slug}`;
        const imageLink = variant.featuredImage || product.variants[0]?.featuredImage || `${storeUrl}/placeholder.png`;
        const price = variant.salePrice ? variant.salePrice : variant.price;
        const availability = variant.quantity > 0 ? 'in stock' : 'out of stock';
        const brand = product.brand || 'Store';

        xml += `    <item>
      <g:id><![CDATA[${id}]]></g:id>
      <g:item_group_id><![CDATA[${product.id}]]></g:item_group_id>
      <g:title><![CDATA[${title.substring(0, 150)}]]></g:title>
      <g:description><![CDATA[${description.substring(0, 9999)}]]></g:description>
      <g:link><![CDATA[${link}]]></g:link>
      <g:image_link><![CDATA[${imageLink}]]></g:image_link>
      <g:brand><![CDATA[${brand}]]></g:brand>
      <g:condition>new</g:condition>
      <g:availability>${availability}</g:availability>
      <g:price>${price.toFixed(2)} LKR</g:price>
    </item>
`;
      }
    }

    xml += `  </channel>
</rss>`;

    res.set('Content-Type', 'application/xml');
    res.send(xml);

  } catch (error) {
    console.error('Error generating Meta catalog feed:', error);
    res.status(500).json({ error: 'Failed to generate product feed' });
  }
};
