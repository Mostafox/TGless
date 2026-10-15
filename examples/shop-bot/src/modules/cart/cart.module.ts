import { command, defineModule, endpoint, fail } from 'tglessjs';
import { CatalogModule } from '../catalog/catalog.module';
import { addToCart, checkout, openCart, removeFromCart, renderCart } from './callbacks/cart.callbacks';
import { CartItems, Orders } from './entities/cart.entities';
import { checkoutScene } from './scenes/checkout.scene';
import { CartError, CartService } from './services/cart.service';

/** Tiny validator; any zod/valibot schema works here too. */
const productInput = (x: unknown) => {
  const id = Number((x as { productId?: unknown })?.productId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('productId must be a positive integer');
  return { productId: id };
};

export const CartModule = defineModule({
  name: 'cart',
  imports: [CatalogModule],
  providers: [CartService],
  entities: [CartItems, Orders],
  commands: [
    command('cart', { description: 'Show your cart' }, async (ctx) => {
      const { text, keyboard } = await renderCart(ctx);
      await ctx.reply(text, { keyboard });
    }),
  ],
  callbacks: [openCart, addToCart, removeFromCart, checkout],
  scenes: [checkoutScene],
  endpoints: {
    getCart: endpoint((ctx) => ctx.inject(CartService).summary(ctx.user.id)),
    addItem: endpoint({ input: productInput }, async (ctx) => {
      try {
        await ctx.inject(CartService).add(ctx.user.id, ctx.input.productId);
      } catch (e) {
        if (e instanceof CartError) throw fail(e.message, { code: 'CART_ERROR' });
        throw e;
      }
      return ctx.inject(CartService).summary(ctx.user.id);
    }),
  },
});
