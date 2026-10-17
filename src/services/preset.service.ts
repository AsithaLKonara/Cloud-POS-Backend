import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export interface AttributeDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'multiselect';
  options?: string[];
  unit?: string;
  required?: boolean;
}

export interface BusinessPresetConfig {
  businessType: string;
  defaultUnit: string;
  trackInventoryDefault: boolean;
  categories: { name: string; slug: string; description: string }[];
  attributeDefinitions: AttributeDefinition[];
}

export const BUSINESS_PRESETS: Record<string, BusinessPresetConfig> = {
  RETAIL: {
    businessType: 'RETAIL',
    defaultUnit: 'PIECE',
    trackInventoryDefault: true,
    categories: [
      { name: "Men's Apparel", slug: 'mens-apparel', description: 'Shirts, trousers, tees, and activewear for men' },
      { name: "Women's Apparel", slug: 'womens-apparel', description: 'Dresses, tops, skirts, and activewear for women' },
      { name: 'Footwear', slug: 'footwear', description: 'Formal, casual, and athletic shoes' },
      { name: 'Accessories & Bags', slug: 'accessories', description: 'Watches, belts, sunglasses, and bags' },
      { name: 'Electronics & Gadgets', slug: 'electronics', description: 'Smartphones, audio gear, and lifestyle tech' },
    ],
    attributeDefinitions: [
      { key: 'size', label: 'Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'] },
      { key: 'color', label: 'Color', type: 'text' },
      { key: 'material', label: 'Fabric / Material', type: 'text' },
      { key: 'gender', label: 'Gender', type: 'select', options: ['Men', 'Women', 'Unisex', 'Kids'] },
    ],
  },
  RESTAURANT_CAFE: {
    businessType: 'RESTAURANT_CAFE',
    defaultUnit: 'PIECE',
    trackInventoryDefault: false,
    categories: [
      { name: 'Appetizers & Starters', slug: 'appetizers', description: 'Soups, salads, and finger foods' },
      { name: 'Main Courses', slug: 'main-courses', description: 'Signature mains, pasta, grills, and bowls' },
      { name: 'Desserts & Pastries', slug: 'desserts', description: 'Cakes, gelato, and sweet treats' },
      { name: 'Artisan Coffee & Tea', slug: 'coffee-tea', description: 'Espresso, pour-overs, and specialty teas' },
      { name: 'Cold Beverages & Mocktails', slug: 'cold-drinks', description: 'Fresh juices, smoothies, and craft mocktails' },
    ],
    attributeDefinitions: [
      { key: 'dietary', label: 'Dietary Preferences', type: 'multiselect', options: ['Vegetarian', 'Vegan', 'Halal', 'Gluten-Free', 'Dairy-Free', 'Keto'] },
      { key: 'allergens', label: 'Allergens', type: 'text' },
      { key: 'spicyLevel', label: 'Spiciness', type: 'select', options: ['Mild', 'Medium', 'Hot', 'Extra Spicy'] },
      { key: 'prepTimeMinutes', label: 'Preparation Time (min)', type: 'number', unit: 'min' },
    ],
  },
  SALON_SPA: {
    businessType: 'SALON_SPA',
    defaultUnit: 'SERVICE',
    trackInventoryDefault: false,
    categories: [
      { name: 'Hair Services & Styling', slug: 'hair-styling', description: 'Cuts, coloring, blowouts, and keratin treatments' },
      { name: 'Facial & Skincare', slug: 'facial-skincare', description: 'Deep cleansing, anti-aging, and hydration treatments' },
      { name: 'Massage & Body Therapy', slug: 'massage-therapy', description: 'Aromatherapy, Swedish, and deep tissue therapy' },
      { name: 'Manicure & Pedicure', slug: 'nails', description: 'Gel polish, acrylics, and spa foot care' },
      { name: 'Retail Aftercare Products', slug: 'salon-retail', description: 'Professional shampoos, serums, and body oils' },
    ],
    attributeDefinitions: [
      { key: 'durationMinutes', label: 'Service Duration (min)', type: 'number', unit: 'min', required: true },
      { key: 'practitionerGender', label: 'Staff Preference', type: 'select', options: ['Any', 'Female', 'Male'] },
      { key: 'stationRequired', label: 'Dedicated Station', type: 'text' },
    ],
  },
  PHARMACY_CLINIC: {
    businessType: 'PHARMACY_CLINIC',
    defaultUnit: 'PACK',
    trackInventoryDefault: true,
    categories: [
      { name: 'Prescription Medicines', slug: 'prescription-medicines', description: 'Antibiotics, cardiac, diabetes, and scheduled drugs' },
      { name: 'Over-The-Counter (OTC)', slug: 'otc-drugs', description: 'Pain relief, cold & flu, and antacids' },
      { name: 'Vitamins & Supplements', slug: 'vitamins-supplements', description: 'Multivitamins, whey, and herbal wellness' },
      { name: 'First Aid & Medical Devices', slug: 'medical-devices', description: 'Bandages, monitors, and surgical disposables' },
    ],
    attributeDefinitions: [
      { key: 'genericName', label: 'Generic Chemical Name', type: 'text' },
      { key: 'dosage', label: 'Strength / Dosage', type: 'text' },
      { key: 'prescriptionRequired', label: 'Requires Prescription (Rx)', type: 'boolean' },
      { key: 'batchNumber', label: 'Batch / Lot #', type: 'text' },
      { key: 'expiryDate', label: 'Expiry Date', type: 'text' },
    ],
  },
  GROCERY_SUPERMARKET: {
    businessType: 'GROCERY_SUPERMARKET',
    defaultUnit: 'KG',
    trackInventoryDefault: true,
    categories: [
      { name: 'Fresh Vegetables & Produce', slug: 'fresh-produce', description: 'Farm-fresh greens, roots, and seasonal produce' },
      { name: 'Dairy, Eggs & Chilled', slug: 'dairy-eggs', description: 'Milk, cheese, butter, and yogurts' },
      { name: 'Pantry & Dry Staples', slug: 'pantry-staples', description: 'Rice, flour, oils, pasta, and pulses' },
      { name: 'Beverages & Snacks', slug: 'beverages-snacks', description: 'Soft drinks, biscuits, chips, and confectionery' },
    ],
    attributeDefinitions: [
      { key: 'netWeight', label: 'Net Weight / Volume', type: 'text' },
      { key: 'isOrganic', label: 'Organic Certified', type: 'boolean' },
      { key: 'shelfLifeDays', label: 'Shelf Life (Days)', type: 'number', unit: 'days' },
      { key: 'originCountry', label: 'Country of Origin', type: 'text' },
    ],
  },
  AUTOMOTIVE_SERVICES: {
    businessType: 'AUTOMOTIVE_SERVICES',
    defaultUnit: 'PIECE',
    trackInventoryDefault: true,
    categories: [
      { name: 'Engine Lubricants', slug: 'engine-oils', description: 'Synthetic, semi-synthetic, and mineral engine lubricants' },
      { name: 'Transmission & Gear Fluids', slug: 'gear-fluids', description: 'ATF, CVT, manual transmission, and differential oils' },
      { name: 'Vehicle Filters', slug: 'filters', description: 'Oil, cabin, engine air, and fuel filters' },
      { name: 'Maintenance & Service Labor', slug: 'service-labor', description: 'Oil change labor, brake bleeding, inspection diagnostics' },
    ],
    attributeDefinitions: [
      { key: 'viscosity', label: 'Viscosity Grade', type: 'select', options: ['0W-20', '5W-30', '10W-40', '15W-40', '20W-50', 'SAE 90', 'ATF'] },
      { key: 'oilType', label: 'Base Oil Type', type: 'select', options: ['Full Synthetic', 'Semi-Synthetic', 'Mineral', 'Heavy Duty Diesel'] },
      { key: 'apiStandard', label: 'API / ACEA Standard', type: 'text' },
      { key: 'partNumber', label: 'OEM Part Number', type: 'text' },
      { key: 'compatibleVehicles', label: 'Compatible Vehicle Models', type: 'text' },
    ],
  },
  WHOLESALE_DISTRIBUTION: {
    businessType: 'WHOLESALE_DISTRIBUTION',
    defaultUnit: 'BOX',
    trackInventoryDefault: true,
    categories: [
      { name: 'Bulk Packaged Goods', slug: 'bulk-goods', description: 'Case packs and carton lots' },
      { name: 'Industrial Supplies', slug: 'industrial-supplies', description: 'Hardware, chemicals, and commercial equipment' },
      { name: 'Packaging Materials', slug: 'packaging-materials', description: 'Corrugated cartons, bubble wrap, and pallet stretch' },
    ],
    attributeDefinitions: [
      { key: 'caseQuantity', label: 'Items per Carton / Box', type: 'number' },
      { key: 'moq', label: 'Minimum Order Qty (MOQ)', type: 'number' },
      { key: 'palletQuantity', label: 'Units per Pallet', type: 'number' },
    ],
  },
  GENERAL_SERVICES: {
    businessType: 'GENERAL_SERVICES',
    defaultUnit: 'HOUR',
    trackInventoryDefault: false,
    categories: [
      { name: 'Professional Consulting', slug: 'consulting', description: 'Strategy, advisory, and specialized expert guidance' },
      { name: 'Technical Support & Repair', slug: 'technical-support', description: 'Diagnostics, repair sessions, and troubleshooting' },
      { name: 'Project & Retainer Work', slug: 'retainers', description: 'Monthly fixed deliverables and project milestones' },
    ],
    attributeDefinitions: [
      { key: 'durationHours', label: 'Duration (Hours)', type: 'number', unit: 'hrs' },
      { key: 'deliverables', label: 'Deliverables Summary', type: 'text' },
    ],
  },
};

export class PresetService {
  /**
   * Retrieves preset configuration for a given business type.
   */
  static getPresetConfig(businessType: string): BusinessPresetConfig {
    const key = (businessType || 'RETAIL').toUpperCase();
    return BUSINESS_PRESETS[key] || (BUSINESS_PRESETS['RETAIL'] as BusinessPresetConfig);
  }

  static getPresetCategories(businessType: string) {
    return this.getPresetConfig(businessType).categories;
  }

  static getAttributeSchemaForBusinessType(businessType: string): AttributeDefinition[] {
    return this.getPresetConfig(businessType).attributeDefinitions;
  }

  /**
   * Automatically seeds initial industry categories and configuration for a newly created tenant.
   */
  static async seedPresetsForTenant(tenantId: string, businessType: string): Promise<{ createdCategories: number }> {
    const preset = this.getPresetConfig(businessType);
    let createdCount = 0;

    for (const cat of preset.categories) {
      try {
        const existing = await (prisma as any).category.findFirst({
          where: { tenantId, slug: cat.slug },
        });

        if (!existing) {
          await (prisma as any).category.create({
            data: {
              tenantId,
              name: cat.name,
              slug: cat.slug,
              description: cat.description,
              status: 'Active',
            },
          });
          createdCount++;
        }
      } catch (err: any) {
        logger.warn(`Could not seed preset category ${cat.name} for tenant ${tenantId}: ${err.message}`);
      }
    }

    logger.info(`Seeded ${createdCount} preset categories for tenant [${tenantId}] (${preset.businessType})`);
    return { createdCategories: createdCount };
  }
}
