import { Router } from 'express';
import { HeadlessCatalogController } from '../../controllers/headless/catalog.controller';
import { requireScope } from '../../middlewares/scope.middleware';

const router = Router();
const controller = new HeadlessCatalogController();

router.get('/products', requireScope('catalog:read'), (req, res) => controller.getProducts(req, res));
router.get('/products/:slugOrId', requireScope('catalog:read'), (req, res) => controller.getProduct(req, res));
router.get('/categories', requireScope('catalog:read'), (req, res) => controller.getCategories(req, res));

export default router;
