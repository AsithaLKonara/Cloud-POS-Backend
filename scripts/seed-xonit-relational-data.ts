import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Direct Prisma instance without RLS interceptor for system seeding
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🚀 Starting Comprehensive Multi-Tenant Relational Database Seed...\n');

  // 1. Fetch Existing Tenants
  const tenants = await prisma.tenant.findMany();
  const tenantMap = new Map<string, any>(tenants.map(t => [t.slug, t]));

  if (!tenantMap.has('velvet-threads') || !tenantMap.has('artisan-bistro')) {
    console.error('❌ Tenants not found! Please run seed-xonit-multitenant.ts first.');
    process.exit(1);
  }

  // 2. Multi-Branch Setup per Tenant
  console.log('📍 1. Seeding Secondary Branches and Terminals...');
  const branchesConfig = [
    // Velvet Threads Boutique
    { tenantSlug: 'velvet-threads', name: 'Velvet Threads - Colombo Flagship', code: 'VELV-01', address: '42 Galle Road, Colombo 03', phone: '+94 11 257 8899' },
    { tenantSlug: 'velvet-threads', name: 'Velvet Threads - Kandy City Centre', code: 'VELV-02', address: 'Level 2, KCC, Kandy', phone: '+94 81 223 4455' },

    // The Artisan Bistro & Cafe
    { tenantSlug: 'artisan-bistro', name: 'Artisan Bistro - Park Street Hub', code: 'ARTI-01', address: '18 Park Street, Colombo 02', phone: '+94 11 298 7766' },
    { tenantSlug: 'artisan-bistro', name: 'Artisan Bistro - Galle Fort Roastery', code: 'ARTI-02', address: '54 Church Street, Galle Fort', phone: '+94 91 224 8822' },

    // Luxe Spa & Wellness
    { tenantSlug: 'luxe-spa-wellness', name: 'Luxe Spa - Cinnamon Gardens Clinic', code: 'LUXE-01', address: '77 Barnes Place, Colombo 07', phone: '+94 11 445 6677' },
    { tenantSlug: 'luxe-spa-wellness', name: 'Luxe Spa - Negombo Ocean Sanctuary', code: 'LUXE-02', address: '12 Beach Road, Negombo', phone: '+94 31 223 9911' },

    // Colombo Central Flagship
    { tenantSlug: 'colombo-central', name: 'Colombo Central Flagship Hub', code: 'COL-01', address: '100 York Street, Colombo 01', phone: '+94 11 789 0001' },
    { tenantSlug: 'colombo-central', name: 'Colombo Central - One Galle Face', code: 'COL-02', address: 'OGF Mall Level 3, Colombo 01', phone: '+94 11 789 0002' },
  ];

  const branchRecords = new Map<string, any>();

  for (const b of branchesConfig) {
    const tenant = tenantMap.get(b.tenantSlug);
    if (!tenant) continue;

    const branch = await prisma.branch.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: b.code } },
      update: { name: b.name, address: b.address, phone: b.phone },
      create: {
        name: b.name,
        code: b.code,
        address: b.address,
        phone: b.phone,
        tenantId: tenant.id,
      },
    });

    branchRecords.set(b.code, branch);

    // Create Terminals for Branch
    for (const termSuffix of ['01', '02']) {
      const termId = `TERM-${b.code}-${termSuffix}`;
      await prisma.posTerminal.upsert({
        where: { id: termId },
        update: { branchId: branch.id, name: `${b.name} Terminal ${termSuffix}` },
        create: {
          id: termId,
          name: `${b.name} Terminal ${termSuffix}`,
          branchId: branch.id,
          tenantId: tenant.id,
        },
      });
    }
  }
  console.log(`✓ 8 Branches and 16 Terminals configured.\n`);

  // 3. Seed Categories per Tenant
  console.log('🏷️  2. Seeding Categories...');
  const categoriesData = [
    // Velvet Threads
    { tenantSlug: 'velvet-threads', name: "Women's Couture", slug: 'womens-couture', desc: 'Designer silk blouses, dresses, and formal wear' },
    { tenantSlug: 'velvet-threads', name: "Men's Sartorial", slug: 'mens-sartorial', desc: 'Handcrafted linen shirts, chinos, and tailored blazers' },
    { tenantSlug: 'velvet-threads', name: 'Accessories & Leather', slug: 'accessories-leather', desc: 'Italian leather belts, wallets, and silk scarves' },
    { tenantSlug: 'velvet-threads', name: 'Footwear & Loafers', slug: 'footwear-loafers', desc: 'Handmade leather shoes and loafers' },

    // Artisan Bistro
    { tenantSlug: 'artisan-bistro', name: 'Specialty Coffee & Brews', slug: 'specialty-coffee', desc: 'Single origin espresso, pour-overs, and cold brews' },
    { tenantSlug: 'artisan-bistro', name: 'Artisan Bakery & Pastries', slug: 'artisan-bakery', desc: 'Fresh French croissants, sourdough loaves, and tarts' },
    { tenantSlug: 'artisan-bistro', name: 'Gourmet Brunch & Bowls', slug: 'gourmet-brunch', desc: 'Truffle eggs benedict, acai bowls, and sourdough toasts' },
    { tenantSlug: 'artisan-bistro', name: 'Botanical Beverages', slug: 'botanical-beverages', desc: 'Fresh pressed organic juices and iced wellness tonics' },

    // Luxe Spa
    { tenantSlug: 'luxe-spa-wellness', name: 'Facial Aesthetics & Peels', slug: 'facial-aesthetics', desc: 'Hydra-glow facials, gold serums, and LED therapy' },
    { tenantSlug: 'luxe-spa-wellness', name: 'Therapeutic Bodywork', slug: 'therapeutic-bodywork', desc: 'Deep tissue therapy, hot stone, and aromatherapy' },
    { tenantSlug: 'luxe-spa-wellness', name: 'Hair & Scalp Rituals', slug: 'hair-scalp-rituals', desc: 'Moroccan argan hair spa and scalp detox treatments' },
    { tenantSlug: 'luxe-spa-wellness', name: 'Apothecary Retail', slug: 'apothecary-retail', desc: 'Pure essential oils, body scrubs, and botanical teas' },

    // Colombo Central Tech
    { tenantSlug: 'colombo-central', name: 'Wireless Audio & ANC', slug: 'wireless-audio', desc: 'Active noise cancelling headphones and earbuds' },
    { tenantSlug: 'colombo-central', name: 'GaN Power & Charging', slug: 'gan-power', desc: 'Ultra-fast GaN desktop and travel fast-chargers' },
    { tenantSlug: 'colombo-central', name: 'Smart Travel & Mounts', slug: 'smart-mounts', desc: 'MagSafe wireless car mounts and travel tech pouches' },
  ];

  const categoryMap = new Map<string, any>();

  for (const c of categoriesData) {
    const tenant = tenantMap.get(c.tenantSlug);
    if (!tenant) continue;

    const cat = await prisma.category.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: c.slug } },
      update: { name: c.name, description: c.desc },
      create: {
        name: c.name,
        slug: c.slug,
        description: c.desc,
        tenantId: tenant.id,
      },
    });

    categoryMap.set(`${c.tenantSlug}:${c.slug}`, cat);
  }
  console.log(`✓ ${categoryMap.size} Industry-Specific Categories created.\n`);

  // 4. Seed Dining Tables for Bistro
  console.log('🍽️  3. Seeding Dining Tables for Artisan Bistro...');
  const bistroBranch1 = branchRecords.get('ARTI-01');
  const bistroTenant = tenantMap.get('artisan-bistro');

  if (bistroBranch1 && bistroTenant) {
    for (let t = 1; t <= 8; t++) {
      const tableName = `Table ${String(t).padStart(2, '0')}`;
      await prisma.diningTable.upsert({
        where: { tenantId_branchId_name: { tenantId: bistroTenant.id, branchId: bistroBranch1.id, name: tableName } },
        update: { capacity: t <= 4 ? 2 : (t <= 6 ? 4 : 8), status: 'AVAILABLE' },
        create: {
          name: tableName,
          zone: t <= 4 ? 'INDOOR_CAFE' : 'TERRACE_GARDEN',
          capacity: t <= 4 ? 2 : (t <= 6 ? 4 : 8),
          status: 'AVAILABLE',
          branchId: bistroBranch1.id,
          tenantId: bistroTenant.id,
        },
      });
    }
    console.log(`✓ 8 Dining Tables seeded for Artisan Bistro.\n`);
  }

  // 5. Products & ProductVariants Data
  console.log('🛍️  4. Seeding Catalog Products & Variants...');

  const productsCatalog = [
    // ── VELVET THREADS ────────────────────────────────────────────────────────
    {
      tenantSlug: 'velvet-threads',
      catSlug: 'womens-couture',
      name: 'Pure Mulberry Silk Wrap Dress',
      slug: 'mulberry-silk-wrap-dress',
      desc: '100% Grade 6A Mulberry Silk dress with tailored waist tie.',
      brand: 'Velvet Atelier',
      variants: [
        { name: 'Emerald / S', sku: 'VELV-DRS-EMR-S', barcode: '890100100001', price: 18500, costPrice: 7200, size: 'S', color: 'Emerald Green' },
        { name: 'Emerald / M', sku: 'VELV-DRS-EMR-M', barcode: '890100100002', price: 18500, costPrice: 7200, size: 'M', color: 'Emerald Green' },
        { name: 'Emerald / L', sku: 'VELV-DRS-EMR-L', barcode: '890100100003', price: 18500, costPrice: 7200, size: 'L', color: 'Emerald Green' },
        { name: 'Midnight Navy / M', sku: 'VELV-DRS-NAV-M', barcode: '890100100004', price: 18500, costPrice: 7200, size: 'M', color: 'Midnight Navy' },
      ],
    },
    {
      tenantSlug: 'velvet-threads',
      catSlug: 'mens-sartorial',
      name: 'French Linen Long Sleeve Shirt',
      slug: 'french-linen-ls-shirt',
      desc: 'Airy, breathable Normandie flax linen with mother-of-pearl buttons.',
      brand: 'Velvet Sartorial',
      variants: [
        { name: 'Optic White / M', sku: 'VELV-SHRT-WHT-M', barcode: '890100100011', price: 7900, costPrice: 2800, size: 'M', color: 'Optic White' },
        { name: 'Optic White / L', sku: 'VELV-SHRT-WHT-L', barcode: '890100100012', price: 7900, costPrice: 2800, size: 'L', color: 'Optic White' },
        { name: 'Sky Blue / M', sku: 'VELV-SHRT-BLU-M', barcode: '890100100013', price: 7900, costPrice: 2800, size: 'M', color: 'Sky Blue' },
        { name: 'Olive Green / L', sku: 'VELV-SHRT-OLV-L', barcode: '890100100014', price: 7900, costPrice: 2800, size: 'L', color: 'Olive Green' },
      ],
    },
    {
      tenantSlug: 'velvet-threads',
      catSlug: 'mens-sartorial',
      name: 'Tailored Cotton Stretch Chinos',
      slug: 'tailored-cotton-stretch-chinos',
      desc: 'Smart-casual slim tapered chinos with subtle stretch for comfort.',
      brand: 'Velvet Sartorial',
      variants: [
        { name: 'Khaki Beige / 32', sku: 'VELV-CHN-BGE-32', barcode: '890100100021', price: 8900, costPrice: 3200, size: '32', color: 'Khaki Beige' },
        { name: 'Khaki Beige / 34', sku: 'VELV-CHN-BGE-34', barcode: '890100100022', price: 8900, costPrice: 3200, size: '34', color: 'Khaki Beige' },
        { name: 'Charcoal Grey / 32', sku: 'VELV-CHN-CHR-32', barcode: '890100100023', price: 8900, costPrice: 3200, size: '32', color: 'Charcoal Grey' },
      ],
    },
    {
      tenantSlug: 'velvet-threads',
      catSlug: 'accessories-leather',
      name: 'Full Grain Italian Leather Reversible Belt',
      slug: 'italian-leather-belt',
      desc: 'Reversible Black / Tan harness leather belt with brushed brass buckle.',
      brand: 'Velvet Pelle',
      variants: [
        { name: 'Standard (32-38)', sku: 'VELV-BLT-STD', barcode: '890100100031', price: 4950, costPrice: 1600, size: 'One Size', color: 'Black/Tan' },
      ],
    },

    // ── ARTISAN BISTRO & CAFE ────────────────────────────────────────────────
    {
      tenantSlug: 'artisan-bistro',
      catSlug: 'specialty-coffee',
      name: 'Single Origin Espresso Double',
      slug: 'single-origin-espresso-double',
      desc: 'Washed Yirgacheffe Ethiopian beans with floral bergamot notes.',
      brand: 'Artisan Roast',
      variants: [
        { name: 'Double Shot (60ml)', sku: 'ARTI-ESP-DBL', barcode: '890200100001', price: 850, costPrice: 180, packUnit: 'Cup' },
      ],
    },
    {
      tenantSlug: 'artisan-bistro',
      catSlug: 'specialty-coffee',
      name: 'Iced Madagascar Vanilla Oat Latte',
      slug: 'iced-vanilla-oat-latte',
      desc: 'Double ristretto poured over chilled Minor Figures oat milk and vanilla bean extract.',
      brand: 'Artisan Roast',
      variants: [
        { name: 'Regular (12oz)', sku: 'ARTI-LAT-REG', barcode: '890200100002', price: 1450, costPrice: 420, packUnit: '12oz Cup' },
        { name: 'Large (16oz)', sku: 'ARTI-LAT-LRG', barcode: '890200100003', price: 1750, costPrice: 510, packUnit: '16oz Cup' },
      ],
    },
    {
      tenantSlug: 'artisan-bistro',
      catSlug: 'artisan-bakery',
      name: 'French Butter Almond Croissant',
      slug: 'french-butter-almond-croissant',
      desc: 'Twice-baked butter croissant filled with frangipane and toasted sliced almonds.',
      brand: 'Bistro Boulangerie',
      variants: [
        { name: 'Fresh Baked Single', sku: 'ARTI-CRS-ALM', barcode: '890200100011', price: 1100, costPrice: 380, packUnit: 'Piece' },
      ],
    },
    {
      tenantSlug: 'artisan-bistro',
      catSlug: 'gourmet-brunch',
      name: 'Black Truffle Wild Mushroom Benedict',
      slug: 'black-truffle-benedict',
      desc: 'Poached free-range eggs on toasted brioche with sauteed wild mushrooms and truffle hollandaise.',
      brand: 'Bistro Kitchen',
      variants: [
        { name: 'Standard Plate', sku: 'ARTI-BND-TRF', barcode: '890200100021', price: 2950, costPrice: 950, packUnit: 'Plate' },
      ],
    },

    // ── LUXE SPA & WELLNESS ──────────────────────────────────────────────────
    {
      tenantSlug: 'luxe-spa-wellness',
      catSlug: 'facial-aesthetics',
      name: 'Hydra-Glow Cellular Facial (60 mins)',
      slug: 'hydra-glow-facial',
      desc: 'Deep ultrasonic pore extraction followed by cold-hammer hyaluronic acid infusion.',
      brand: 'Luxe MediSpa',
      variants: [
        { name: '60 Minute Session', sku: 'LUXE-FAC-60M', barcode: '890300100001', price: 14500, costPrice: 3200, packUnit: 'Session' },
      ],
    },
    {
      tenantSlug: 'luxe-spa-wellness',
      catSlug: 'therapeutic-bodywork',
      name: 'Balinese Deep Tissue Tension Release',
      slug: 'balinese-deep-tissue',
      desc: 'Traditional firm pressure acupressure with warm sandalwood and ginger massage oils.',
      brand: 'Luxe Bodywork',
      variants: [
        { name: '60 Minute Therapy', sku: 'LUXE-MSG-60M', barcode: '890300100011', price: 12000, costPrice: 2800, packUnit: 'Session' },
        { name: '90 Minute Therapy', sku: 'LUXE-MSG-90M', barcode: '890300100012', price: 16500, costPrice: 3900, packUnit: 'Session' },
      ],
    },
    {
      tenantSlug: 'luxe-spa-wellness',
      catSlug: 'apothecary-retail',
      name: 'Organic Moroccan Cold-Pressed Argan Serum (100ml)',
      slug: 'organic-argan-serum-100ml',
      desc: 'USDA certified organic extra-virgin argan oil for face, hair, and cuticle nourishment.',
      brand: 'Luxe Apothecary',
      variants: [
        { name: '100ml Glass Dropper', sku: 'LUXE-ARG-100ML', barcode: '890300100021', price: 6800, costPrice: 2100, packUnit: '100ml Bottle' },
      ],
    },

    // ── COLOMBO CENTRAL FLAGSHIP ─────────────────────────────────────────────
    {
      tenantSlug: 'colombo-central',
      catSlug: 'wireless-audio',
      name: 'AcousticPro Hybrid Active Noise Cancelling Earbuds',
      slug: 'acousticpro-anc-earbuds',
      desc: 'Bluetooth 5.4, 48dB active noise cancellation, 36hr battery with wireless Qi charging case.',
      brand: 'AcousticPro',
      variants: [
        { name: 'Matte Obsidian Black', sku: 'COL-EAR-BLK', barcode: '890400100001', price: 14900, costPrice: 6500, color: 'Obsidian Black' },
        { name: 'Pearl White Frost', sku: 'COL-EAR-WHT', barcode: '890400100002', price: 14900, costPrice: 6500, color: 'Pearl White' },
      ],
    },
    {
      tenantSlug: 'colombo-central',
      catSlug: 'gan-power',
      name: '65W Dual USB-C GaN Ultra-Fast Charger',
      slug: '65w-dual-usbc-gan-charger',
      desc: 'Foldable prongs, Power Delivery 3.0 & QC 4.0 fast charging for laptops, tablets, and phones.',
      brand: 'VoltGrid',
      variants: [
        { name: 'Midnight Graphite', sku: 'COL-CHG-65W', barcode: '890400100011', price: 5400, costPrice: 2100, color: 'Midnight Graphite' },
      ],
    },
  ];

  const variantRecords: any[] = [];

  for (const p of productsCatalog) {
    const tenant = tenantMap.get(p.tenantSlug);
    const category = categoryMap.get(`${p.tenantSlug}:${p.catSlug}`);
    if (!tenant) continue;

    const product = await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: p.slug } },
      update: {
        name: p.name,
        description: p.desc,
        brand: p.brand,
        categoryId: category?.id || null,
      },
      create: {
        name: p.name,
        slug: p.slug,
        description: p.desc,
        brand: p.brand,
        tenantId: tenant.id,
        categoryId: category?.id || null,
        status: 'ACTIVE',
      },
    });

    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: {
          name: v.name,
          price: v.price,
          costPrice: v.costPrice,
          barcode: v.barcode,
          size: (v as any).size || null,
          color: (v as any).color || null,
          packUnit: (v as any).packUnit || 'Piece',
        },
        create: {
          productId: product.id,
          name: v.name,
          sku: v.sku,
          barcode: v.barcode,
          price: v.price,
          costPrice: v.costPrice,
          size: (v as any).size || null,
          color: (v as any).color || null,
          packUnit: (v as any).packUnit || 'Piece',
          quantity: 100,
        },
      });

      variantRecords.push({ variant, tenantSlug: p.tenantSlug });
    }
  }
  console.log(`✓ ${productsCatalog.length} Products and ${variantRecords.length} Variants seeded.\n`);

  // 6. Seed Inventory Stock across Branches
  console.log('📦 5. Seeding Inventory Stock in Branches...');
  for (const item of variantRecords) {
    const primaryBranchCode = 
      item.tenantSlug === 'velvet-threads' ? 'VELV-01' :
      item.tenantSlug === 'artisan-bistro' ? 'ARTI-01' :
      item.tenantSlug === 'luxe-spa-wellness' ? 'LUXE-01' : 'COL-01';

    const secondaryBranchCode = 
      item.tenantSlug === 'velvet-threads' ? 'VELV-02' :
      item.tenantSlug === 'artisan-bistro' ? 'ARTI-02' :
      item.tenantSlug === 'luxe-spa-wellness' ? 'LUXE-02' : 'COL-02';

    const b1 = branchRecords.get(primaryBranchCode);
    const b2 = branchRecords.get(secondaryBranchCode);

    if (b1) {
      await prisma.inventoryItem.upsert({
        where: { variantId_branchId: { variantId: item.variant.id, branchId: b1.id } },
        update: { quantity: 65, lowStockThreshold: 10 },
        create: {
          variantId: item.variant.id,
          branchId: b1.id,
          quantity: 65,
          lowStockThreshold: 10,
        },
      });
    }

    if (b2) {
      await prisma.inventoryItem.upsert({
        where: { variantId_branchId: { variantId: item.variant.id, branchId: b2.id } },
        update: { quantity: 35, lowStockThreshold: 8 },
        create: {
          variantId: item.variant.id,
          branchId: b2.id,
          quantity: 35,
          lowStockThreshold: 8,
        },
      });
    }
  }
  console.log(`✓ Inventory stock linked to all active branches.\n`);

  // 7. Seed Customers
  console.log('👥 6. Seeding Customers & Loyalty Accounts...');
  const customersConfig = [
    { tenantSlug: 'velvet-threads', phone: '0771234567', email: 'ananya.s@gmail.com', first: 'Ananya', last: 'Senanayake', type: 'VIP', points: 450 },
    { tenantSlug: 'velvet-threads', phone: '0719876543', email: 'dilan.p@yahoo.com', first: 'Dilan', last: 'Perera', type: 'RETAIL', points: 120 },
    { tenantSlug: 'artisan-bistro', phone: '0765551234', email: 'sarah.c@outlook.com', first: 'Sarah', last: 'Cooray', type: 'RETAIL', points: 340 },
    { tenantSlug: 'luxe-spa-wellness', phone: '0778889900', email: 'nathasha.d@gmail.com', first: 'Dr. Nathasha', last: 'De Silva', type: 'VIP', points: 890 },
    { tenantSlug: 'colombo-central', phone: '0703334455', email: 'malik.f@gmail.com', first: 'Malik', last: 'Fernando', type: 'WHOLESALE', points: 1500 },
  ];

  const customerRecords = new Map<string, any>();

  for (const c of customersConfig) {
    const tenant = tenantMap.get(c.tenantSlug);
    if (!tenant) continue;

    const customer = await prisma.customer.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: c.phone } },
      update: { firstName: c.first, lastName: c.last, email: c.email, customerType: c.type },
      create: {
        phone: c.phone,
        email: c.email,
        firstName: c.first,
        lastName: c.last,
        customerType: c.type,
        tenantId: tenant.id,
      },
    });

    customerRecords.set(c.phone, customer);

    // Ensure loyalty account
    await prisma.loyaltyAccount.upsert({
      where: { customerId: customer.id },
      update: { points: c.points, tier: c.points > 500 ? 'GOLD' : (c.points > 200 ? 'SILVER' : 'BRONZE') },
      create: {
        customerId: customer.id,
        points: c.points,
        tier: c.points > 500 ? 'GOLD' : (c.points > 200 ? 'SILVER' : 'BRONZE'),
      },
    });
  }
  console.log(`✓ Customers & Loyalty records active.\n`);

  // 8. Seed Historical POS Orders & Revenue Transactions (Past 7 Days)
  console.log('📈 7. Seeding Historical POS Sales Orders for BI Dashboard...');

  const velvetVariants = variantRecords.filter(v => v.tenantSlug === 'velvet-threads').map(v => v.variant);
  const velvetBranch = branchRecords.get('VELV-01');
  const velvetTenant = tenantMap.get('velvet-threads');
  const velvetCustomer = customerRecords.get('0771234567');

  if (velvetBranch && velvetTenant && velvetVariants.length > 0) {
    // Generate 12 past orders across the last 6 days
    for (let day = 6; day >= 0; day--) {
      const orderDate = new Date();
      orderDate.setDate(orderDate.getDate() - day);
      orderDate.setHours(11 + (day % 7), 20, 0, 0);

      const item1 = velvetVariants[day % velvetVariants.length];
      const item2 = velvetVariants[(day + 1) % velvetVariants.length];
      const qty1 = 1 + (day % 2);
      const qty2 = 1;

      const subtotal = (item1.price * qty1) + (item2.price * qty2);
      const total = subtotal;
      const orderNum = `ORD-VELV-2026-${1000 + day}`;

      const paymentMethods = ['CASH', 'CARD', 'KOKO'];
      const pMethod = paymentMethods[day % paymentMethods.length];

      const order = await prisma.order.upsert({
        where: { tenantId_orderNumber: { tenantId: velvetTenant.id, orderNumber: orderNum } },
        update: {},
        create: {
          orderNumber: orderNum,
          tenantId: velvetTenant.id,
          branchId: velvetBranch.id,
          customerId: velvetCustomer?.id || null,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: pMethod,
          subtotal,
          total,
          shippingFee: 0,
          type: 'POS',
          createdAt: orderDate,
          updatedAt: orderDate,
        },
      });

      // Order Items
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.createMany({
        data: [
          {
            orderId: order.id,
            variantId: item1.id,
            quantity: qty1,
            priceAtPurchase: item1.price,
            costPriceAtPurchase: item1.costPrice,
          },
          {
            orderId: order.id,
            variantId: item2.id,
            quantity: qty2,
            priceAtPurchase: item2.price,
            costPriceAtPurchase: item2.costPrice,
          },
        ],
      });

      // Payment Transaction
      await prisma.paymentTransaction.deleteMany({ where: { orderId: order.id } });
      await prisma.paymentTransaction.create({
        data: {
          orderId: order.id,
          amount: total,
          method: pMethod || 'CASH',
          status: 'SUCCESS',
          reference: `PAY-TXN-${orderNum}`,
          createdAt: orderDate,
        },
      });
    }
    console.log(`✓ Historical POS Orders and P&L financial data successfully populated!\n`);
  }

  console.log('🎉 Comprehensive Relational Database Seed Finished Successfully!\n');
}

main()
  .catch((e) => {
    console.error('Fatal error seeding relational data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
