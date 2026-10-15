import { c, entity, type Infer } from 'tglessjs/db';
import { Products } from '../../catalog/entities/product.entity';

export const CartItems = entity('cart_items', {
  id: c.id(),
  userId: c.int(), // Telegram user id
  productId: c.int(), // logical link to products.id (tgcloud has no foreign keys)
  qty: c.int().default(1),
  ...c.timestamps(),
}, {
  indexes: [{ columns: ['userId', 'productId'], unique: true }],
}).relations((r) => ({
  product: r.belongsTo(() => Products, 'productId'),
}));

export interface OrderLine {
  productId: number;
  title: string;
  qty: number;
  price: number;
}

export const Orders = entity('orders', {
  id: c.id(),
  userId: c.int().index(),
  total: c.real(),
  status: c.enum(['new', 'paid', 'shipped', 'cancelled']).default('new'),
  address: c.text(),
  items: c.json<OrderLine[]>(),
  ...c.timestamps(),
});

export type CartItem = Infer<typeof CartItems>;
export type Order = Infer<typeof Orders>;
