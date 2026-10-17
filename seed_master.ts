import prisma from './src/config/prisma';
import bcrypt from 'bcryptjs';
import { RoleService } from './src/services/role.service';
import { SettingService } from './src/services/setting.service';

async function seedMaster() {
  console.log('====================================================');
  console.log('🚀 Starting Master Seed for Oil Retail POS & ERP');
  console.log('====================================================');

  // 1. Roles & Permissions + Settings
  console.log('\n[1/7] Seeding RBAC Roles, Permissions & Settings...');
  await RoleService.seedDefaultRolesAndPermissions();
  await SettingService.seedDefaultSettings();
  console.log('✓ Roles and permissions ready.');

  const superAdminRole = await prisma.role.findFirst({ where: { name: { in: ['Super Admin', 'Superadmin'] } } });
  const managerRole = await prisma.role.findFirst({ where: { name: { in: ['Branch Admin', 'Branch Manager', 'Admin'] } } });
  const cashierRole = await prisma.role.findFirst({ where: { name: 'Cashier' } });

  // 2. Physical Branches
  console.log('\n[2/7] Seeding Branches Network...');
  const branchesData = [
    {
      name: 'Colombo Central Oil Depot & Hub',
      code: 'CMB-01',
      type: 'RETAIL',
      address: 'No. 142, Baseline Road, Colombo 09',
      phone: '0112-889900',
      isActive: true,
    },
    {
      name: 'Kandy Super AutoCare Branch',
      code: 'KDY-01',
      type: 'RETAIL',
      address: 'No. 55, William Gopallawa Mawatha, Kandy',
      phone: '0812-445566',
      isActive: true,
    },
    {
      name: 'Kurunegala Lubricants Depot',
      code: 'KGL-01',
      type: 'RETAIL',
      address: 'No. 88, Negombo Road, Kurunegala',
      phone: '0372-223344',
      isActive: true,
    },
  ];

  const branchMap = new Map<string, any>();
  for (const bData of branchesData) {
    const b = await prisma.branch.upsert({
      where: { code: bData.code },
      update: { name: bData.name, address: bData.address, phone: bData.phone, isActive: true },
      create: bData,
    });
    branchMap.set(bData.code, b);
  }
  console.log(`✓ ${branchMap.size} physical branches active.`);

  const cmbBranch = branchMap.get('CMB-01');
  const kdyBranch = branchMap.get('KDY-01');

  // 3. Terminals
  let cmbTerminal = await prisma.posTerminal.findFirst({ where: { branchId: cmbBranch.id } });
  if (!cmbTerminal) {
    cmbTerminal = await prisma.posTerminal.create({
      data: {
        name: 'Counter 01 Express Terminal',
        branchId: cmbBranch.id,
        status: 'ACTIVE',
      },
    });
  }

  let kdyTerminal = await prisma.posTerminal.findFirst({ where: { branchId: kdyBranch.id } });
  if (!kdyTerminal) {
    kdyTerminal = await prisma.posTerminal.create({
      data: {
        name: 'Kandy Main Counter',
        branchId: kdyBranch.id,
        status: 'ACTIVE',
      },
    });
  }

  // 4. Staff Users & Credentials
  console.log('\n[3/7] Seeding Staff Credentials...');
  const salt = await bcrypt.genSalt(10);
  const defaultPasswordHash = await bcrypt.hash('Password@123', salt);

  const staffUsers = [
    {
      email: 'superadmin@oilpos.lk',
      name: 'Asitha Konara (Superadmin)',
      phone: '0770000000',
      roleId: superAdminRole!.id,
      branchId: cmbBranch.id,
    },
    {
      email: 'manager.colombo@oilpos.lk',
      name: 'Dinesh Wickramasinghe (Branch Manager)',
      phone: '0771112233',
      roleId: managerRole!.id,
      branchId: cmbBranch.id,
    },
    {
      email: 'manager.kandy@oilpos.lk',
      name: 'Nuwan Bandara (Branch Manager)',
      phone: '0772223344',
      roleId: managerRole!.id,
      branchId: kdyBranch.id,
    },
    {
      email: 'cashier.colombo@oilpos.lk',
      name: 'Kasun Perera (Cashier)',
      phone: '0773334455',
      roleId: cashierRole!.id,
      branchId: cmbBranch.id,
    },
    {
      email: 'cashier.kandy@oilpos.lk',
      name: 'Sachintha Fernando (Cashier)',
      phone: '0774445566',
      roleId: cashierRole!.id,
      branchId: kdyBranch.id,
    },
  ];

  const userMap = new Map<string, any>();
  for (const staff of staffUsers) {
    const existing = await prisma.user.findUnique({ where: { email: staff.email } });
    if (!existing) {
      const u = await prisma.user.create({
        data: {
          email: staff.email,
          name: staff.name,
          phone: staff.phone,
          password: defaultPasswordHash,
          branchId: staff.branchId,
          status: 'ACTIVE',
          userRoles: {
            create: { roleId: staff.roleId },
          },
        },
      });
      userMap.set(staff.email, u);
    } else {
      userMap.set(staff.email, existing);
    }
  }
  console.log(`✓ ${staffUsers.length} staff credentials ready.`);

  // 5. Categories & Catalog
  console.log('\n[4/7] Seeding Lubricants, Fluids & Spares Catalog...');
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

  const productsList = [
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
        { name: '4L Can', sku: 'MOB-0W20-4L', barcode: '071924149791', costPrice: 13500, price: 17500, wholesalePrice: 15500, unitVolume: 4, unitType: '4L Can', quantity: 35 },
        { name: '1L Bottle', sku: 'MOB-0W20-1L', barcode: '071924149784', costPrice: 3800, price: 4950, wholesalePrice: 4300, unitVolume: 1, unitType: '1L Can', quantity: 60 },
        { name: 'Bulk Loose Liter', sku: 'MOB-0W20-LIT', barcode: 'MOB0W20BULK', costPrice: 3200, price: 4200, wholesalePrice: 3700, unitVolume: 1, unitType: 'Loose Liter', quantity: 200 },
      ],
    },
    {
      name: 'Castrol EDGE 5W-30 LL Titanium FST',
      slug: 'castrol-edge-5w-30',
      productType: 'LUBRICANT',
      brand: 'Castrol',
      viscosity: '5W-30',
      oilType: 'FULL_SYNTHETIC',
      apiStandard: 'ACEA C3 / MB-Approval 229.51 / VW 504 00',
      compatibleVehicles: 'BMW, Mercedes-Benz, Audi, Volkswagen, European & Japanese Turbo Petrol/Diesel',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        { name: '4L Can', sku: 'CAS-EDGE-5W30-4L', barcode: '4008177074362', costPrice: 14200, price: 18900, wholesalePrice: 16800, unitVolume: 4, unitType: '4L Can', quantity: 28 },
        { name: '1L Bottle', sku: 'CAS-EDGE-5W30-1L', barcode: '4008177074355', costPrice: 3950, price: 5200, wholesalePrice: 4500, unitVolume: 1, unitType: '1L Can', quantity: 45 },
      ],
    },
    {
      name: 'Shell Helix HX7 10W-40 Synthetic Technology',
      slug: 'shell-helix-hx7-10w-40',
      productType: 'LUBRICANT',
      brand: 'Shell',
      viscosity: '10W-40',
      oilType: 'SEMI_SYNTHETIC',
      apiStandard: 'API SN PLUS / ACEA A3/B4',
      compatibleVehicles: 'Nissan Sunny, Toyota Corolla, Suzuki Swift, Mitsubishi Lancer',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        { name: '4L Can', sku: 'SHL-HX7-10W40-4L', barcode: '5011987249123', costPrice: 8500, price: 11800, wholesalePrice: 10200, unitVolume: 4, unitType: '4L Can', quantity: 50 },
        { name: 'Bulk Loose Liter', sku: 'SHL-HX7-10W40-LIT', barcode: 'SHLHX7BULK', costPrice: 2000, price: 2900, wholesalePrice: 2500, unitVolume: 1, unitType: 'Loose Liter', quantity: 400 },
      ],
    },
    {
      name: 'Caltex Delo 400 MGX 15W-40 Heavy Duty Diesel',
      slug: 'caltex-delo-400-15w-40',
      productType: 'LUBRICANT',
      brand: 'Caltex',
      viscosity: '15W-40',
      oilType: 'HEAVY_DUTY_DIESEL',
      apiStandard: 'API CJ-4 / CI-4 PLUS / Cummins CES 20081',
      compatibleVehicles: 'Toyota Hilux, Land Cruiser, Isuzu D-Max, Mitsubishi Fuso, Commercial Fleets',
      categoryId: categoryMap.get('engine-oils'),
      variants: [
        { name: '5L Can', sku: 'CLX-DELO-15W40-5L', barcode: '8888001150058', costPrice: 8900, price: 12500, wholesalePrice: 10800, unitVolume: 5, unitType: '5L Can', quantity: 40 },
        { name: '208L Commercial Drum', sku: 'CLX-DELO-DRUM-208L', barcode: 'CLXDELODRUM', costPrice: 320000, price: 440000, wholesalePrice: 385000, unitVolume: 208, unitType: '208L Drum', quantity: 4 },
      ],
    },
    {
      name: 'Toyota Genuine Continuously Variable Transmission Fluid (CVTF FE)',
      slug: 'toyota-cvtf-fe',
      productType: 'LUBRICANT',
      brand: 'Toyota Genuine',
      viscosity: 'CVTF',
      oilType: 'SYNTHETIC_TRANSMISSION',
      apiStandard: 'Toyota Spec 08886-02505',
      compatibleVehicles: 'Toyota Axio, Premio, Allion, Aqua, Vitz CVT Gearboxes',
      categoryId: categoryMap.get('gear-transmission'),
      variants: [
        { name: '4L Tin', sku: 'TOY-CVTF-FE-4L', barcode: '0888602505', costPrice: 16500, price: 21500, wholesalePrice: 19000, unitVolume: 4, unitType: '4L Can', quantity: 22 },
      ],
    },
    {
      name: 'Toyota Genuine Super Long Life Coolant Pre-mixed 50/50 (Pink)',
      slug: 'toyota-sllc-pink-4l',
      productType: 'LUBRICANT',
      brand: 'Toyota Genuine',
      viscosity: 'SLLC',
      oilType: 'ETHYLENE_GLYCOL_COOLANT',
      apiStandard: 'JIS K2234 Spec',
      compatibleVehicles: 'All Toyota, Lexus, Daihatsu Engines',
      categoryId: categoryMap.get('coolants-car-care'),
      variants: [
        { name: '4L Can', sku: 'TOY-SLLC-4L', barcode: '0888980072', costPrice: 6200, price: 8500, wholesalePrice: 7400, unitVolume: 4, unitType: '4L Can', quantity: 30 },
      ],
    },
    // --- NON-OIL ITEMS ---
    {
      name: 'Denso Genuine Japanese Automotive Oil Filter',
      slug: 'denso-oil-filter-90915-10003',
      productType: 'FILTER',
      brand: 'Denso',
      partNumber: '90915-10003',
      compatibleVehicles: 'Toyota 1NZ-FE, 2NZ-FE, Prius 1.5, Aqua, Vitz, Axio, Yaris',
      categoryId: categoryMap.get('filters'),
      variants: [
        { name: 'Single Unit Box', sku: 'FLT-DNS-10003', barcode: '04251100034', costPrice: 1200, price: 1950, wholesalePrice: 1550, unitVolume: 1, unitType: 'Box', quantity: 80 },
      ],
    },
    {
      name: 'Vic Japanese Air Filter Element (A-1014)',
      slug: 'vic-air-filter-a-1014',
      productType: 'FILTER',
      brand: 'VIC Japan',
      partNumber: '17801-21050 / A-1014',
      compatibleVehicles: 'Toyota Corolla 141, Axio 161, Fielder, Premio 260',
      categoryId: categoryMap.get('filters'),
      variants: [
        { name: 'Single Unit Box', sku: 'FLT-VIC-A1014', barcode: '4976701010148', costPrice: 1850, price: 2900, wholesalePrice: 2350, unitVolume: 1, unitType: 'Box', quantity: 50 },
      ],
    },
    {
      name: 'NGK Laser Iridium Long-Life Spark Plug (ILKAR7B11)',
      slug: 'ngk-iridium-ilkar7b11',
      productType: 'SPARE_PART',
      brand: 'NGK',
      partNumber: 'ILKAR7B11 / 4912',
      compatibleVehicles: 'Toyota Prius 1.8, Aqua, C-HR, Corolla 1.8 Dual VVT-i',
      categoryId: categoryMap.get('spark-plugs-spares'),
      variants: [
        { name: 'Set of 4 Plugs', sku: 'SPK-NGK-7B11-4', barcode: '087295149126', costPrice: 9200, price: 13500, wholesalePrice: 11500, unitVolume: 4, unitType: 'Pack of 4', quantity: 25 },
        { name: 'Single Plug', sku: 'SPK-NGK-7B11-1', barcode: '087295149121', costPrice: 2300, price: 3450, wholesalePrice: 2900, unitVolume: 1, unitType: 'Single Box', quantity: 50 },
      ],
    },
  ];

  const variantList: any[] = [];
  for (const p of productsList) {
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        productType: p.productType,
        brand: p.brand,
        viscosity: p.viscosity,
        oilType: p.oilType,
        apiStandard: p.apiStandard,
        partNumber: p.partNumber,
        compatibleVehicles: p.compatibleVehicles,
        categoryId: p.categoryId,
        status: 'ACTIVE',
      },
      create: {
        name: p.name,
        slug: p.slug,
        productType: p.productType,
        brand: p.brand,
        viscosity: p.viscosity,
        oilType: p.oilType,
        apiStandard: p.apiStandard,
        partNumber: p.partNumber,
        compatibleVehicles: p.compatibleVehicles,
        categoryId: p.categoryId,
        status: 'ACTIVE',
      },
    });

    for (const vData of p.variants) {
      const v = await prisma.productVariant.upsert({
        where: { sku: vData.sku },
        update: {
          name: vData.name,
          barcode: vData.barcode,
          costPrice: vData.costPrice,
          price: vData.price,
          wholesalePrice: vData.wholesalePrice,
          unitVolumeLiters: vData.unitVolume,
          packUnit: vData.unitType,
        },
        create: {
          productId: product.id,
          name: vData.name,
          sku: vData.sku,
          barcode: vData.barcode,
          costPrice: vData.costPrice,
          price: vData.price,
          wholesalePrice: vData.wholesalePrice,
          unitVolumeLiters: vData.unitVolume,
          packUnit: vData.unitType,
        },
      });

      variantList.push({ ...v, product, defaultQty: vData.quantity });

      // Stock across all 3 branches
      for (const branch of [cmbBranch, kdyBranch, branchMap.get('KGL-01')]) {
        const branchQty = branch.code === 'CMB-01' ? vData.quantity : Math.round(vData.quantity * 0.7);
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
            quantity: branchQty,
            lowStockThreshold: 6,
          },
          update: {
            quantity: branchQty,
          },
        });
      }
    }
  }
  console.log(`✓ Catalog seeded with ${productsList.length} products & stock across 3 branches.`);

  // 6. B2B Commercial Workshop & Fleet Customers
  console.log('\n[5/7] Seeding B2B Workshop & Fleet Customer Accounts...');
  const b2bAccounts = [
    {
      companyName: 'Pitstop AutoCare & Hybrid Solutions',
      firstName: 'Sunil',
      lastName: 'Perera',
      phone: '0771234567',
      email: 'pitstop.autocare@gmail.com',
      customerType: 'GARAGE_WORKSHOP',
      creditLimit: 300000,
      creditBalance: 75000,
      vehicleNumber: 'WP CAB-4821',
      notes: 'Premier hybrid workshop in Kottawa. Buys 0W-20 drums and Denso filters weekly.',
    },
    {
      companyName: 'Lanka Freight Express Fleet',
      firstName: 'Dammika',
      lastName: 'Fernando',
      phone: '0719876543',
      email: 'fleet@lankafreight.lk',
      customerType: 'COMMERCIAL_FLEET',
      creditLimit: 600000,
      creditBalance: 185000,
      vehicleNumber: 'WP NB-8899',
      notes: 'Commercial fleet of 18 delivery trucks. Purchases 15W-40 208L drums on 30-day terms.',
    },
    {
      companyName: 'City Master Motors & Diagnostic Lab',
      firstName: 'Roshan',
      lastName: 'Alwis',
      phone: '0703344556',
      email: 'citymaster.motors@yahoo.com',
      customerType: 'GARAGE_WORKSHOP',
      creditLimit: 200000,
      creditBalance: 32000,
      vehicleNumber: 'WP CAR-1200',
      notes: 'General mechanical repair shop. Purchases ATF, Coolants, and Spin-on filters.',
    },
    {
      companyName: 'Walk-in Retail Counter',
      firstName: 'Kamal',
      lastName: 'Gunawardena',
      phone: '0761122334',
      email: 'kamal.guna@gmail.com',
      customerType: 'RETAIL',
      creditLimit: 0,
      creditBalance: 0,
      vehicleNumber: 'WP CAA-9912',
      notes: 'Retail customer (Toyota Aqua owner). Pays cash/card at counter.',
    },
  ];

  const customerMap = new Map<string, any>();
  for (const acc of b2bAccounts) {
    const cust = await prisma.customer.upsert({
      where: { phone: acc.phone },
      update: {
        companyName: acc.companyName,
        customerType: acc.customerType,
        creditLimit: acc.creditLimit,
        creditBalance: acc.creditBalance,
        vehicleNumber: acc.vehicleNumber,
        notes: acc.notes,
      },
      create: {
        companyName: acc.companyName,
        firstName: acc.firstName,
        lastName: acc.lastName,
        phone: acc.phone,
        email: acc.email,
        customerType: acc.customerType,
        creditLimit: acc.creditLimit,
        creditBalance: acc.creditBalance,
        vehicleNumber: acc.vehicleNumber,
        notes: acc.notes,
        isGuest: false,
      },
    });
    customerMap.set(acc.phone, cust);

    if (acc.creditBalance > 0) {
      await prisma.customerCreditLedger.create({
        data: {
          customerId: cust.id,
          type: 'CHARGE',
          amount: acc.creditBalance,
          balanceAfter: acc.creditBalance,
          paymentMethod: 'CREDIT_ACCOUNT',
          reference: 'INV-OPENING-DEBT',
          notes: 'Opening Outstanding Credit Balance for Workshop Account',
        },
      });
    }
  }
  console.log(`✓ ${b2bAccounts.length} B2B workshop and fleet accounts ready.`);

  // 7. Active POS Shift & Sample Completed Orders
  console.log('\n[6/7] Seeding Active Cashier Shift & Realistic Oil Sales...');
  const cashierUser = userMap.get('cashier.colombo@oilpos.lk');

  // Open shift for cashier in Colombo
  const existingShift = await prisma.posSession.findFirst({
    where: { branchId: cmbBranch.id, status: 'OPEN' },
  });

  let activeSession = existingShift;
  if (!activeSession && cashierUser) {
    activeSession = await prisma.posSession.create({
      data: {
        branchId: cmbBranch.id,
        terminalId: cmbTerminal.id,
        userId: cashierUser.id,
        status: 'OPEN',
        openingFloat: 15000,
        totalCashSales: 48500,
        totalCardSales: 21500,
        totalCreditSales: 35000,
        openedAt: new Date(Date.now() - 4 * 3600 * 1000), // opened 4 hours ago
      },
    });
  }

  // Seed sample completed orders for live analytics
  const pitstopCustomer = customerMap.get('0771234567');
  const freightCustomer = customerMap.get('0719876543');
  const retailCustomer = customerMap.get('0761122334');

  const vMobil0W20_4L = variantList.find(v => v.sku === 'MOB-0W20-4L');
  const vCastrol5W30_4L = variantList.find(v => v.sku === 'CAS-EDGE-5W30-4L');
  const vDensoFilter = variantList.find(v => v.sku === 'FLT-DNS-10003');
  const vDeloDrum = variantList.find(v => v.sku === 'CLX-DELO-DRUM-208L');

  // Order 1: Workshop Credit Sale (Pitstop AutoCare)
  if (pitstopCustomer && vMobil0W20_4L && vDensoFilter) {
    const o1Total = vMobil0W20_4L.price * 2 + vDensoFilter.price * 4;
    await prisma.order.create({
      data: {
        orderNumber: 'POS-CMB-1001',
        branchId: cmbBranch.id,
        posSessionId: activeSession?.id,
        customerId: pitstopCustomer.id,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: 'CREDIT_ACCOUNT',
        shippingFee: 0,
        type: 'POS',
        subtotal: o1Total,
        total: o1Total,
        items: {
          create: [
            {
              variantId: vMobil0W20_4L.id,
              quantity: 2,
              priceAtPurchase: vMobil0W20_4L.price,
              costPriceAtPurchase: vMobil0W20_4L.costPrice,
            },
            {
              variantId: vDensoFilter.id,
              quantity: 4,
              priceAtPurchase: vDensoFilter.price,
              costPriceAtPurchase: vDensoFilter.costPrice,
            },
          ],
        },
      },
    });
  }

  // Order 2: Retail Cash Sale
  if (retailCustomer && vCastrol5W30_4L && vDensoFilter) {
    const o2Total = vCastrol5W30_4L.price + vDensoFilter.price;
    await prisma.order.create({
      data: {
        orderNumber: 'POS-CMB-1002',
        branchId: cmbBranch.id,
        posSessionId: activeSession?.id,
        customerId: retailCustomer.id,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        shippingFee: 0,
        type: 'POS',
        subtotal: o2Total,
        total: o2Total,
        items: {
          create: [
            {
              variantId: vCastrol5W30_4L.id,
              quantity: 1,
              priceAtPurchase: vCastrol5W30_4L.price,
              costPriceAtPurchase: vCastrol5W30_4L.costPrice,
            },
            {
              variantId: vDensoFilter.id,
              quantity: 1,
              priceAtPurchase: vDensoFilter.price,
              costPriceAtPurchase: vDensoFilter.costPrice,
            },
          ],
        },
      },
    });
  }

  // Order 3: Fleet Drum Purchase
  if (freightCustomer && vDeloDrum) {
    const o3Total = vDeloDrum.price;
    await prisma.order.create({
      data: {
        orderNumber: 'POS-CMB-1003',
        branchId: cmbBranch.id,
        posSessionId: activeSession?.id,
        customerId: freightCustomer.id,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: 'CREDIT_ACCOUNT',
        shippingFee: 0,
        type: 'POS',
        subtotal: o3Total,
        total: o3Total,
        items: {
          create: [
            {
              variantId: vDeloDrum.id,
              quantity: 1,
              priceAtPurchase: vDeloDrum.price,
              costPriceAtPurchase: vDeloDrum.costPrice,
            },
          ],
        },
      },
    });
  }

  // 8. Inter-Branch Stock Transfers
  console.log('\n[7/7] Seeding Inter-Branch Stock Transfers...');
  if (vMobil0W20_4L) {
    await prisma.stockTransfer.create({
      data: {
        variantId: vMobil0W20_4L.id,
        fromBranchId: cmbBranch.id,
        toBranchId: kdyBranch.id,
        quantity: 12,
        status: 'DISPATCHED',
        requestedBy: 'Nuwan Bandara (Kandy Branch Manager)',
        notes: 'Urgent weekend restocking for Kandy Workshop client',
      },
    });
  }

  if (vDensoFilter) {
    await prisma.stockTransfer.create({
      data: {
        variantId: vDensoFilter.id,
        fromBranchId: cmbBranch.id,
        toBranchId: kdyBranch.id,
        quantity: 20,
        status: 'PENDING',
        requestedBy: 'Nuwan Bandara (Kandy Branch Manager)',
        notes: 'Oil filter replenishment request',
      },
    });
  }

  console.log('✓ Inter-branch transfers seeded (1 Dispatched in transit, 1 Pending).');

  console.log('\n====================================================');
  console.log('🎉 MASTER SEED COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
  console.log('System Access Credentials:');
  console.log('----------------------------------------------------');
  console.log('1. Super Admin:');
  console.log('   Email:    superadmin@oilpos.lk');
  console.log('   Password: Password@123');
  console.log('   Access:   Consolidated Multi-Branch Executive Command (/admin)');
  console.log('');
  console.log('2. Colombo Branch Manager:');
  console.log('   Email:    manager.colombo@oilpos.lk');
  console.log('   Password: Password@123');
  console.log('   Access:   Colombo Store Operations Dashboard (/branch-admin)');
  console.log('');
  console.log('3. Colombo Cashier:');
  console.log('   Email:    cashier.colombo@oilpos.lk');
  console.log('   Password: Password@123');
  console.log('   Access:   Touch & Fast Scanner Oil POS Terminal (/pos)');
  console.log('====================================================\n');
}

seedMaster()
  .catch((e) => {
    console.error('Master seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
