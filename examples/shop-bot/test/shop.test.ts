import { beforeEach, describe, expect, it } from 'vitest';
import { createTestBot, type TestBot } from 'tgless/testing';
import app from '../src/main';
import { SHOP_CONFIG, shopConfig } from '../src/config';
import { Products } from '../src/modules/catalog/entities/product.entity';
import { Orders } from '../src/modules/cart/entities/cart.entities';

const ADMIN = 777;

describe('shop bot', () => {
  let bot: TestBot;

  beforeEach(async () => {
    bot = createTestBot(app);
    bot.override(SHOP_CONFIG, { provide: SHOP_CONFIG, useValue: { ...shopConfig, adminIds: [ADMIN] } });
    await Products.createMany([
      { title: 'Coffee', price: 4.5, stock: 3 },
      { title: 'Tea', price: 3, stock: 0 },
    ]);
  });

  it('greets on /start and stores the user', async () => {
    await bot.send('/start');
    expect(bot.lastReply.text).toContain('Hi <b>Test</b>');
    expect(bot.lastReply.parse_mode).toBe('HTML');
  });

  it('lists only in-stock products', async () => {
    await bot.send('/shop');
    const buttons = bot.lastReply.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(buttons).toEqual(['Coffee — 4.50 USD']);
  });

  it('adds to cart and checks out through the scene', async () => {
    await bot.click('cart:add/1');
    await bot.click('cart:add/1');
    expect(bot.api.callsOf('answerCallbackQuery').at(-1)?.text).toBe('Added Coffee 🛒');

    await bot.send('/cart');
    expect(bot.lastReply.text).toContain('Coffee × 2');

    await bot.click('cart:checkout');
    expect(bot.lastReply.text).toContain('Where should we deliver');
    await bot.send('221B Baker Street');
    await bot.click('checkout:yes');
    expect(bot.lastReply.text).toContain('Order <b>#1</b> placed');

    const order = await Orders.findById(1);
    expect(order).toMatchObject({ total: 9, status: 'new', address: '221B Baker Street' });
    expect((await Products.findById(1))?.stock).toBe(1);
  });

  it('refuses to oversell', async () => {
    for (let i = 0; i < 4; i++) await bot.click('cart:add/1');
    const answers = bot.api.callsOf('answerCallbackQuery');
    expect(answers.at(-1)).toMatchObject({ text: 'Not enough stock', show_alert: true });
  });

  it('cancels checkout with /cancel', async () => {
    await bot.click('cart:add/1');
    await bot.click('cart:checkout');
    await bot.send('/cancel');
    expect(bot.lastReply.text).toBe('Checkout cancelled. Your cart is still there.');
  });

  it('protects admin commands', async () => {
    await bot.send('/stats');
    expect(bot.lastReply.text).toBe('⛔ Admins only.');
  });

  it('lets admins add products and see stats', async () => {
    const admin = bot;
    const from = { id: ADMIN };
    await admin.send('/addproduct', {}, from);
    await admin.send('Cookies', {}, from);
    await admin.send('2.5', {}, from);
    await admin.send('10', {}, from);
    expect(admin.lastReply.text).toContain('Added <b>Cookies</b>');
    await admin.send('/stats', {}, from);
    expect(admin.lastReply.text).toContain('Orders: 0');
  });

  it('serves Mini App endpoints', async () => {
    expect(await bot.call('addItem', { productId: 1 })).toMatchObject({ ok: true, result: { total: 4.5 } });
    expect(await bot.call('addItem', { productId: 2 })).toMatchObject({
      ok: false,
      error_type: 'ENDPOINT_ERROR',
      parameters: { code: 'CART_ERROR' },
    });
    expect(await bot.call('addItem', { productId: 'x' })).toMatchObject({ ok: false, parameters: { code: 'VALIDATION_ERROR' } });
    const page = await bot.call('listProducts', { page: 1 });
    expect(page.ok && page.result.total).toBe(1);
  });
});
