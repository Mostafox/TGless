import { c, entity, type Infer } from 'tgless/db';

export const Products = entity('products', {
  id: c.id(),
  title: c.text(),
  description: c.text().optional(),
  price: c.real(),
  stock: c.int().default(0),
  active: c.bool().default(true).index(),
  ...c.timestamps(),
}, {
  checks: { products_price_positive: 'price >= 0' },
});

export type Product = Infer<typeof Products>;
