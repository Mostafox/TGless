import { inject } from 'tglessjs';
import { CatalogService } from '../../catalog/services/catalog.service';
import { Products } from '../../catalog/entities/product.entity';
import { CartItems, Orders, type OrderLine } from '../entities/cart.entities';

export class CartError extends Error {}

export class CartService {
  private catalog = inject(CatalogService);

  async add(userId: number, productId: number) {
    const product = await this.catalog.get(productId);
    if (!product) throw new CartError('Product not found');
    const existing = await CartItems.find({ userId, productId });
    if ((existing?.qty ?? 0) + 1 > product.stock) throw new CartError('Not enough stock');
    if (existing) await CartItems.increment({ id: existing.id }, 'qty');
    else await CartItems.create({ userId, productId });
    return product;
  }

  remove(userId: number, productId: number) {
    return CartItems.delete({ userId, productId });
  }

  async items(userId: number) {
    const rows = await CartItems.findMany({ where: { userId }, orderBy: { id: 'asc' }, with: { product: true } });
    return rows.filter((r) => r.product !== null);
  }

  async summary(userId: number) {
    const items = await this.items(userId);
    const lines: OrderLine[] = items.map((i) => ({ productId: i.productId, title: i.product!.title, qty: i.qty, price: i.product!.price }));
    const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
    return { lines, total };
  }

  /** Turn the cart into an order: check stock, decrement it, clear the cart. */
  async checkout(userId: number, address: string) {
    const { lines, total } = await this.summary(userId);
    if (!lines.length) throw new CartError('Your cart is empty');
    for (const l of lines) {
      const p = await Products.findById(l.productId);
      if (!p || p.stock < l.qty) throw new CartError(`"${l.title}" is out of stock`);
    }
    for (const l of lines) await Products.decrement({ id: l.productId }, 'stock', l.qty);
    const order = await Orders.create({ userId, total, address, items: lines });
    await CartItems.delete({ userId });
    return order;
  }
}
