import prisma from './src/config/prisma';

async function seedOilRetail() {
  console.log('--- Starting Oil Retail Catalog Seed ---');

  // 1. Ensure Categories Exist
  const categoriesData = [
    { name: 'Engine Oils', slug: 'engine-oils', description: 'Automotive and Heavy Duty Diesel Engine Lubricants' },
    { name: 'Gear & Transmission Fluids', slug: 'gear-transmission', description: 'Automatic & Manual Transmission, Axle, and Differential Fluids' },
    { name: 'Coolants & Car Care', slug: 'coolants-car-care', description: 'Radiator Coolants, Brake Fluids, Degreasers, and Windshield Fluids' },
    { name: 'Filters (Non-Oil)', slug: 'filters', description: 'Oil, Air, Cabin, and Fuel Filters for all vehicle models' },
    { name: 'Batteries (Non-Oil)', slug: 'batteries', description: 'Automotive and Motorcycle Lead-Acid & Maintenance-Free Batteries' },
    { name: 'Spark Plugs & Spares (Non-Oil)', slug: 'spark-plugs-spares', description: 'Ignition, Wipers, Belts, and Electrical Spares' },
  ];

  const categoryMap = new Map<string, string>();
  for (const cat of categoriesData) {
    const existing = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, description: cat.description },
      create: { name: cat.name, slug: cat.slug, description: cat.description, status: 'Active' },
    });
    categoryMap.set(cat.slug, existing.id);
  }
  console.log('✓ Categories verified/created.');

  // 2. Fetch or create a default branch
  let branch = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: 'Main Workshop & Oil Depot',
        code: 'DEPOT-01',
        type: 'RETAIL',
        isActive: true,
      },
    });
  }

  // 3. Products List (Oils and Non-Oil items)
  const products = [
    // --- LUBRICANTS / OILS ---
    {
      name: 'Mobil 1 Advanced Fuel Economy 0W-20',
      slug: 'mobil-1-0w-20',
      productType: 'LUBRICANT',
      brand: 'Mobil',
      viscosity: '0W-20',
      oilType: 'FULL_SYNTHETIC',
      apiStandard: 'API SP / ILSAC GF-6A',
      compatibleVehicles: 'Toyota Prius, Aqua, Vitz / Honda Fit, Vezel / Hybrid Engines',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        {
          name: '4L Can',
          sku: 'MOB-0W20-4L',
          barcode: '071924149791',
          costPrice: 13500,
          price: 17500,
          wholesalePrice: 15500,
          packUnit: '4L Can',
          unitVolumeLiters: 4.0,
          quantity: 24,
        },
        {
          name: '1L Bottle',
          sku: 'MOB-0W20-1L',
          barcode: '071924149784',
          costPrice: 3800,
          price: 4950,
          wholesalePrice: 4400,
          packUnit: '1L Bottle',
          unitVolumeLiters: 1.0,
          quantity: 48,
        },
      ],
    },
    {
      name: 'Castrol EDGE 5W-30 Full Synthetic',
      slug: 'castrol-edge-5w-30',
      productType: 'LUBRICANT',
      brand: 'Castrol',
      viscosity: '5W-30',
      oilType: 'FULL_SYNTHETIC',
      apiStandard: 'API SP / ACEA C3',
      compatibleVehicles: 'European & Japanese Sedans, SUVs, Turbocharged petrol/diesel',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        {
          name: '4L Can',
          sku: 'CAS-5W30-4L',
          barcode: '079191000101',
          costPrice: 14200,
          price: 18900,
          wholesalePrice: 16800,
          packUnit: '4L Can',
          unitVolumeLiters: 4.0,
          quantity: 30,
        },
      ],
    },
    {
      name: 'Caltex Delo 400 MGX 15W-40 Heavy Duty Diesel',
      slug: 'caltex-delo-400-15w-40',
      productType: 'LUBRICANT',
      brand: 'Caltex',
      viscosity: '15W-40',
      oilType: 'HEAVY_DUTY_DIESEL',
      apiStandard: 'API CJ-4 / CI-4 Plus',
      compatibleVehicles: 'Commercial Trucks, Buses, Heavy Machinery, Isuzu, Mitsubishi Fuso',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        {
          name: '5L Can',
          sku: 'DELO-15W40-5L',
          barcode: '028886000501',
          costPrice: 9500,
          price: 12500,
          wholesalePrice: 11000,
          packUnit: '5L Can',
          unitVolumeLiters: 5.0,
          quantity: 40,
        },
        {
          name: '208L Bulk Drum',
          sku: 'DELO-15W40-208L',
          barcode: '028886002081',
          costPrice: 320000,
          price: 415000,
          wholesalePrice: 380000,
          packUnit: '208L Drum',
          unitVolumeLiters: 208.0,
          quantity: 4,
        },
      ],
    },
    {
      name: 'Mobil Super 20W-50 Premium Mineral',
      slug: 'mobil-super-20w-50',
      productType: 'LUBRICANT',
      brand: 'Mobil',
      viscosity: '20W-50',
      oilType: 'MINERAL',
      apiStandard: 'API SL / CF',
      compatibleVehicles: 'High mileage engines, Classic cars, Vans, Carburetor models',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        {
          name: '4L Can',
          sku: 'MOB-20W50-4L',
          barcode: '071924150018',
          costPrice: 7200,
          price: 9500,
          wholesalePrice: 8400,
          packUnit: '4L Can',
          unitVolumeLiters: 4.0,
          quantity: 50,
        },
      ],
    },
    {
      name: 'Castrol Transmax ATF Dex/Merc',
      slug: 'castrol-transmax-atf',
      productType: 'LUBRICANT',
      brand: 'Castrol',
      viscosity: 'ATF',
      oilType: 'AUTOMATIC_TRANSMISSION',
      apiStandard: 'Dexron III-H / Mercon',
      compatibleVehicles: 'Automatic transmission vehicles & power steering systems',
      categoryId: categoryMap.get('gear-transmission'),
      variants: [
        {
          name: '1L Bottle',
          sku: 'CAS-ATF-1L',
          barcode: '079191000202',
          costPrice: 2800,
          price: 3750,
          wholesalePrice: 3200,
          packUnit: '1L Bottle',
          unitVolumeLiters: 1.0,
          quantity: 36,
        },
      ],
    },

    // --- NON-OIL ITEMS (FILTERS, BATTERIES, PLUGS, CHEMICALS) ---
    {
      name: 'Toyota Genuine Oil Filter (15601-BZ010)',
      slug: 'toyota-oil-filter-bz010',
      productType: 'FILTER',
      brand: 'Toyota Genuine Parts',
      partNumber: '15601-BZ010',
      compatibleVehicles: 'Toyota Vitz, Passo, Aqua, Corolla, Yaris, Avanza',
      categoryId: categoryMap.get('filters'),
      variants: [
        {
          name: 'Standard Unit',
          sku: 'FILT-TOY-BZ010',
          barcode: '4954514930101',
          costPrice: 1250,
          price: 1850,
          wholesalePrice: 1500,
          packUnit: 'Piece',
          unitVolumeLiters: null,
          quantity: 120,
        },
      ],
    },
    {
      name: 'Denso Cool Gear Oil Filter (115010-0900)',
      slug: 'denso-oil-filter-0900',
      productType: 'FILTER',
      brand: 'Denso',
      partNumber: '115010-0900',
      compatibleVehicles: 'Suzuki Alto, WagonR, Swift, Every / Daihatsu Mira',
      categoryId: categoryMap.get('filters'),
      variants: [
        {
          name: 'Standard Unit',
          sku: 'FILT-DENSO-0900',
          barcode: '4957902009002',
          costPrice: 950,
          price: 1450,
          wholesalePrice: 1200,
          packUnit: 'Piece',
          unitVolumeLiters: null,
          quantity: 80,
        },
      ],
    },
    {
      name: 'Bosch High Flow Air Filter',
      slug: 'bosch-air-filter-toyota',
      productType: 'FILTER',
      brand: 'Bosch',
      partNumber: '17801-21050',
      compatibleVehicles: 'Toyota Corolla 141, Premio 260, Allion 260, Axio',
      categoryId: categoryMap.get('filters'),
      variants: [
        {
          name: 'Standard Unit',
          sku: 'FILT-AIR-BOSCH-21050',
          barcode: '4047024821050',
          costPrice: 2200,
          price: 3200,
          wholesalePrice: 2700,
          packUnit: 'Piece',
          unitVolumeLiters: null,
          quantity: 45,
        },
      ],
    },
    {
      name: 'NGK Laser Iridium Spark Plug (Set of 4)',
      slug: 'ngk-laser-iridium-bkr6eix-11',
      productType: 'SPARE_PART',
      brand: 'NGK',
      partNumber: 'BKR6EIX-11',
      compatibleVehicles: 'Toyota 1NZ-FE, 2NZ-FE / Nissan QG15 / Honda L15A',
      categoryId: categoryMap.get('spark-plugs-spares'),
      variants: [
        {
          name: 'Set of 4 Plugs',
          sku: 'NGK-IRID-SET4',
          barcode: '087295137642',
          costPrice: 9800,
          price: 13500,
          wholesalePrice: 11500,
          packUnit: 'Box of 4',
          unitVolumeLiters: null,
          quantity: 25,
        },
      ],
    },
    {
      name: 'Amaron Hi-Life Maintenance-Free Battery 35B20L',
      slug: 'amaron-battery-35b20l',
      productType: 'BATTERY',
      brand: 'Amaron',
      partNumber: '35B20L / NS40ZL',
      compatibleVehicles: 'Suzuki WagonR, Alto, Swift / Toyota Passo, Vitz / Honda N-Box',
      categoryId: categoryMap.get('batteries'),
      variants: [
        {
          name: '12V 35Ah Battery',
          sku: 'BAT-AMA-35B20L',
          barcode: '8906001002011',
          costPrice: 22500,
          price: 28500,
          wholesalePrice: 25500,
          packUnit: 'Piece',
          unitVolumeLiters: null,
          quantity: 15,
        },
      ],
    },
    {
      name: 'Toyota Super Long Life Coolant Premixed 50/50',
      slug: 'toyota-sllc-coolant-gallon',
      productType: 'CAR_CARE',
      brand: 'Toyota Genuine Parts',
      partNumber: '08889-80072',
      compatibleVehicles: 'All Toyota & Japanese Aluminum Engines',
      categoryId: categoryMap.get('coolants-car-care'),
      variants: [
        {
          name: '3.785L Gallon',
          sku: 'COOL-TOY-378L',
          barcode: '008889800722',
          costPrice: 5800,
          price: 7800,
          wholesalePrice: 6800,
          packUnit: 'Gallon Can',
          unitVolumeLiters: 3.785,
          quantity: 35,
        },
      ],
    },
  ];

  for (const item of products) {
    const existing = await prisma.product.findUnique({
      where: { slug: item.slug },
      include: { variants: true },
    });

    if (existing) {
      console.log(`- Updating existing product: ${item.name}`);
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          productType: item.productType,
          brand: item.brand,
          viscosity: item.viscosity || null,
          oilType: item.oilType || null,
          apiStandard: item.apiStandard || null,
          partNumber: item.partNumber || null,
          compatibleVehicles: item.compatibleVehicles || null,
          categoryId: item.categoryId,
        },
      });

      // Update variant costs
      for (const vData of item.variants) {
        const matchedVariant = existing.variants.find((v) => v.sku === vData.sku);
        if (matchedVariant) {
          await prisma.productVariant.update({
            where: { id: matchedVariant.id },
            data: {
              costPrice: vData.costPrice,
              wholesalePrice: vData.wholesalePrice,
              packUnit: vData.packUnit,
              unitVolumeLiters: vData.unitVolumeLiters,
            },
          });
        }
      }
    } else {
      console.log(`+ Creating product: ${item.name}`);
      const created = await prisma.product.create({
        data: {
          name: item.name,
          slug: item.slug,
          productType: item.productType,
          brand: item.brand,
          viscosity: item.viscosity || null,
          oilType: item.oilType || null,
          apiStandard: item.apiStandard || null,
          partNumber: item.partNumber || null,
          compatibleVehicles: item.compatibleVehicles || null,
          categoryId: item.categoryId,
          status: 'ACTIVE',
          variants: {
            create: item.variants.map((v) => ({
              name: v.name,
              sku: v.sku,
              barcode: v.barcode,
              price: v.price,
              costPrice: v.costPrice,
              wholesalePrice: v.wholesalePrice,
              packUnit: v.packUnit,
              unitVolumeLiters: v.unitVolumeLiters,
              quantity: v.quantity,
              stockStatus: 'instock',
            })),
          },
        },
        include: { variants: true },
      });

      // Create branch inventory records
      for (const v of created.variants) {
        const vData = item.variants.find((x) => x.sku === v.sku);
        if (vData && branch) {
          await prisma.inventoryItem.upsert({
            where: {
              variantId_branchId: {
                variantId: v.id,
                branchId: branch.id,
              },
            },
            create: {
              variantId: v.id,
              branchId: branch.id,
              quantity: vData.quantity,
              lowStockThreshold: 5,
            },
            update: {
              quantity: vData.quantity,
            },
          });
        }
      }
    }
  }

  console.log('=== Oil Retail Catalog Seed Completed Successfully! ===');
}

seedOilRetail()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
