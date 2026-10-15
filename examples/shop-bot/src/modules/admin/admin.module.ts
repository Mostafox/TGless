import { command, defineModule, guards, html, scene } from 'tgless';
import { SHOP_CONFIG } from '../../config';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/services/catalog.service';
import { Orders } from '../cart/entities/cart.entities';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/services/users.service';

const isAdmin = guards.when((ctx) => ctx.inject(SHOP_CONFIG).adminIds.includes(ctx.from?.id ?? 0), '⛔ Admins only.');

interface NewProduct {
  title?: string;
  price?: number;
}

const addProductScene = scene<NewProduct>('add-product', [
  async (ctx) => {
    await ctx.reply('Product title?');
    ctx.scene.next();
  },
  async (ctx) => {
    if (!ctx.text) return ctx.reply('Send the title as text.');
    ctx.scene.state.title = ctx.text;
    await ctx.reply('Price?');
    ctx.scene.next();
  },
  async (ctx) => {
    const price = Number(ctx.text);
    if (!(price >= 0)) return ctx.reply('Send a number, e.g. 9.99');
    ctx.scene.state.price = price;
    await ctx.reply('Stock quantity?');
    ctx.scene.next();
  },
  async (ctx) => {
    const stock = Number.parseInt(ctx.text ?? '', 10);
    if (!(stock >= 0)) return ctx.reply('Send a whole number.');
    const { title, price } = ctx.scene.state;
    const product = await ctx.inject(CatalogService).add({ title: title!, price: price!, stock });
    await ctx.reply(html`✅ Added <b>${product.title}</b> (#${product.id}).`);
    ctx.scene.leave();
  },
]);

export const AdminModule = defineModule({
  name: 'admin',
  imports: [UsersModule, CatalogModule],
  guards: [isAdmin],
  commands: [
    command('stats', async (ctx) => {
      const users = await ctx.inject(UsersService).count();
      const orders = await Orders.count();
      // Escape hatch: a raw aggregate with the sdk/db query builder.
      const { ops } = Orders;
      const row = await Orders.select({ revenue: ops.sum(Orders.table.total) }).get();
      await ctx.reply(html`👥 Users: ${users}\n📦 Orders: ${orders}\n💰 Revenue: ${Number(row?.revenue ?? 0).toFixed(2)}`);
    }),
    command('addproduct', (ctx) => ctx.scene.enter('add-product')),
    command('synccommands', async (ctx) => {
      const list = await ctx.app.syncCommands();
      await ctx.reply(`Registered ${list.length} commands with Telegram.`);
    }),
  ],
  scenes: [addProductScene],
});
