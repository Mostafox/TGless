import { callback, html, inline, type Context } from 'tglessjs';
import { addToCart } from '../../cart/callbacks/cart.callbacks';
import { CatalogService } from '../services/catalog.service';

/** Render a catalog page (shared by the /shop command and the callback). */
export async function renderCatalog(ctx: Context, page: number) {
  const catalog = ctx.inject(CatalogService);
  const result = await catalog.page(page);
  if (!result.total) return { text: 'The catalog is empty for now.', keyboard: inline() };

  const keyboard = inline().grid(result.items, 1, (p) => ({
    text: `${p.title} — ${catalog.price(p)}`,
    callback_data: showProduct.data({ id: p.id }),
  }));
  if (page > 1) keyboard.text('⬅️', showCatalog.data({ page: page - 1 }));
  if (result.hasNext) keyboard.text('➡️', showCatalog.data({ page: page + 1 }));
  return { text: html`🛍 <b>Catalog</b> (page ${page}/${result.pages})`, keyboard };
}

export const showCatalog = callback('catalog/:page', async (ctx) => {
  const { text, keyboard } = await renderCatalog(ctx, Number(ctx.params.page) || 1);
  await ctx.edit(text, { keyboard });
});

export const showProduct = callback('product/:id', async (ctx) => {
  const catalog = ctx.inject(CatalogService);
  const product = await catalog.get(Number(ctx.params.id));
  if (!product) return ctx.alert('This product is no longer available.');
  await ctx.edit(
    html`<b>${product.title}</b>\n${product.description ?? ''}\n\n💰 ${catalog.price(product)} · 📦 ${product.stock} left`,
    {
      keyboard: inline()
        .text('➕ Add to cart', addToCart.data({ id: product.id }))
        .row()
        .text('⬅️ Back', showCatalog.data({ page: 1 })),
    },
  );
});
