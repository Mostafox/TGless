import dayjs from 'dayjs';
import { command, html, inline } from 'tgless';
import { openCart } from '../../cart/callbacks/cart.callbacks';
import { showCatalog } from '../../catalog/callbacks/catalog.callbacks';
import type { User } from '../entities/user.entity';

export const startCommand = command('start', { description: 'Welcome & main menu' }, async (ctx) => {
  const user = ctx.state.user as User | undefined;
  const since = user ? dayjs(user.createdAt).format('MMM D, YYYY') : 'today';
  await ctx.reply(html`👋 Hi <b>${ctx.from.first_name}</b>! Customer since ${since}.`, {
    keyboard: inline()
      .text('🛍 Catalog', showCatalog.data({ page: 1 }))
      .text('🛒 Cart', openCart.data()),
  });
});
