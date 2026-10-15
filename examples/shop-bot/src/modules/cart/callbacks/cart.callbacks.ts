import { callback, html, inline, type Context } from 'tgless';
import { showCatalog } from '../../catalog/callbacks/catalog.callbacks';
import { CatalogService } from '../../catalog/services/catalog.service';
import { CartError, CartService } from '../services/cart.service';

export async function renderCart(ctx: Context) {
  const cart = ctx.inject(CartService);
  const catalog = ctx.inject(CatalogService);
  const { lines, total } = await cart.summary(ctx.from!.id);
  if (!lines.length) {
    return { text: '🛒 Your cart is empty.', keyboard: inline().text('🛍 Catalog', showCatalog.data({ page: 1 })) };
  }
  const keyboard = inline();
  for (const l of lines) keyboard.text(`❌ ${l.title}`, removeFromCart.data({ id: l.productId })).row();
  keyboard.text('✅ Checkout', checkout.data()).text('🛍 Continue', showCatalog.data({ page: 1 }));
  const body = lines.map((l) => html`• ${l.title} × ${l.qty} = ${catalog.price({ price: l.price * l.qty })}`).join('\n');
  return { text: `🛒 <b>Your cart</b>\n${body}\n\n<b>Total:</b> ${catalog.price({ price: total })}`, keyboard };
}

export const openCart = callback('cart', async (ctx) => {
  const { text, keyboard } = await renderCart(ctx);
  await ctx.edit(text, { keyboard });
});

export const addToCart = callback('cart:add/:id', async (ctx) => {
  try {
    const product = await ctx.inject(CartService).add(ctx.from.id, Number(ctx.params.id));
    await ctx.answer(`Added ${product.title} 🛒`);
  } catch (e) {
    if (e instanceof CartError) return ctx.alert(e.message);
    throw e;
  }
});

export const removeFromCart = callback('cart:rm/:id', async (ctx) => {
  await ctx.inject(CartService).remove(ctx.from.id, Number(ctx.params.id));
  const { text, keyboard } = await renderCart(ctx);
  await ctx.edit(text, { keyboard });
});

export const checkout = callback('cart:checkout', async (ctx) => {
  await ctx.answer();
  await ctx.scene.enter('checkout');
});
