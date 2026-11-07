import prisma from '../config/prisma';

export interface BomItemInput {
  componentVariantId: string;
  quantity: number;
  unit?: string;
}

export class BillOfMaterialsService {
  /**
   * Sets up or updates the Bill of Materials (Recipe / Kit) for a parent variant
   */
  static async upsertBom(data: {
    tenantId?: string | null;
    parentVariantId: string;
    name: string;
    description?: string;
    items: BomItemInput[];
  }) {
    if (!data.items || data.items.length === 0) {
      throw new Error('A Bill of Materials must have at least one component ingredient.');
    }

    // Verify parent variant exists
    const parent = await (prisma as any).productVariant.findUnique({
      where: { id: data.parentVariantId }
    });
    if (!parent) throw new Error(`Parent product variant [${data.parentVariantId}] not found.`);

    // Delete existing BOM if exists
    await (prisma as any).billOfMaterials.deleteMany({
      where: { parentVariantId: data.parentVariantId }
    });

    return await (prisma as any).billOfMaterials.create({
      data: {
        tenantId: data.tenantId || null,
        parentVariantId: data.parentVariantId,
        name: data.name,
        description: data.description || null,
        items: {
          create: data.items.map(it => ({
            componentVariantId: it.componentVariantId,
            quantity: it.quantity,
            unit: it.unit || null
          }))
        }
      },
      include: {
        items: true
      }
    });
  }

  /**
   * Returns BOM definition for a variant if one exists
   */
  static async getBomForVariant(parentVariantId: string) {
    return await (prisma as any).billOfMaterials.findUnique({
      where: { parentVariantId },
      include: { items: true }
    });
  }

  /**
   * Automatically deducts raw ingredients from inventory when a manufactured/composite item is sold
   */
  static async deductBomIngredients(data: {
    parentVariantId: string;
    quantitySold: number;
    branchId: string;
    reference: string;
  }, client?: any) {
    const db = client || prisma;

    const bom = await db.billOfMaterials.findUnique({
      where: { parentVariantId: data.parentVariantId },
      include: { items: true }
    });

    if (!bom || !bom.items || bom.items.length === 0) {
      return null; // Not a manufactured / composite item
    }

    const deductedComponents = [];

    for (const component of bom.items) {
      const totalQtyToDeduct = component.quantity * data.quantitySold;

      // Decrement branch inventory for raw ingredient
      await db.inventoryItem.upsert({
        where: {
          variantId_branchId: {
            variantId: component.componentVariantId,
            branchId: data.branchId
          }
        },
        update: {
          quantity: { decrement: totalQtyToDeduct }
        },
        create: {
          variantId: component.componentVariantId,
          branchId: data.branchId,
          quantity: -totalQtyToDeduct
        }
      });

      // Log transaction
      await db.inventoryTransaction.create({
        data: {
          variantId: component.componentVariantId,
          branchId: data.branchId,
          type: 'BOM_DEDUCT',
          quantityChange: -totalQtyToDeduct,
          reference: data.reference,
          reason: `Recipe auto-deduction for ${bom.name} x${data.quantitySold}`
        }
      });

      deductedComponents.push({
        variantId: component.componentVariantId,
        deducted: totalQtyToDeduct
      });
    }

    return {
      bomId: bom.id,
      name: bom.name,
      componentsDeducted: deductedComponents
    };
  }
}

