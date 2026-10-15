import { command, defineModule, endpoint } from 'tgless';
import { renderCatalog, showCatalog, showProduct } from './callbacks/catalog.callbacks';
import { Products } from './entities/product.entity';
import { CatalogService } from './services/catalog.service';

export const CatalogModule = defineModule({
  name: 'catalog',
  providers: [CatalogService],
  exports: [CatalogService],
  entities: [Products],
  commands: [
    command('shop', { description: 'Browse the catalog' }, async (ctx) => {
      const { text, keyboard } = await renderCatalog(ctx, 1);
      await ctx.reply(text, { keyboard });
    }),
  ],
  callbacks: [showCatalog, showProduct],
  endpoints: {
    // Mini App: Telegram.WebApp.Serverless.call('listProducts', { page: 1 }, cb)
    listProducts: endpoint(async (ctx) => ctx.inject(CatalogService).page(Number(ctx.input.page) || 1)),
  },
});
