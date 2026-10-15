import { createApp, defineModule } from 'tglessjs';
import { SHOP_CONFIG, shopConfig } from './config';
import { AdminModule } from './modules/admin/admin.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { UsersModule } from './modules/users/users.module';
import { trackUser } from './modules/users/track-user.middleware';

/** Global config, injectable everywhere without importing the module. */
const ConfigModule = defineModule({
  name: 'config',
  global: true,
  providers: [{ provide: SHOP_CONFIG, useValue: shopConfig }],
  exports: [SHOP_CONFIG],
});

export default createApp({
  modules: [ConfigModule, UsersModule, CatalogModule, CartModule, AdminModule],
  middlewares: [trackUser],
  parseMode: 'HTML',
  onError: async (error, ctx) => {
    console.error('Unhandled error', error);
    if (ctx.chatId) await ctx.reply('Something went wrong. Please try again.');
  },
});
