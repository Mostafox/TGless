import { html, inline, scene } from 'tglessjs';
import { CartError, CartService } from '../services/cart.service';

interface CheckoutState {
  address?: string;
}

/** Ask for an address, confirm, then place the order. /cancel leaves at any time. */
export const checkoutScene = scene<CheckoutState>('checkout', {
  steps: [
    async (ctx) => {
      await ctx.reply('📦 Where should we deliver? Send your address (or /cancel).');
      ctx.scene.next();
    },
    async (ctx) => {
      if (!ctx.text || ctx.text.length < 5) return ctx.reply('Please send a full address.');
      ctx.scene.state.address = ctx.text;
      await ctx.reply(html`Deliver to:\n<i>${ctx.text}</i>\n\nConfirm?`, {
        keyboard: inline().text('✅ Confirm', 'checkout:yes').text('✏️ Change', 'checkout:no'),
      });
      ctx.scene.next();
    },
    async (ctx) => {
      if (ctx.data === 'checkout:no') {
        ctx.scene.back();
        await ctx.answer();
        return ctx.reply('OK, send the new address.');
      }
      if (ctx.data !== 'checkout:yes') return ctx.reply('Tap Confirm or Change above.');
      await ctx.answer();
      try {
        const order = await ctx.inject(CartService).checkout(ctx.from!.id, ctx.scene.state.address!);
        await ctx.reply(html`🎉 Order <b>#${order.id}</b> placed! Total: ${order.total.toFixed(2)}`);
      } catch (e) {
        if (!(e instanceof CartError)) throw e;
        await ctx.reply(`❌ ${e.message}`);
      }
      ctx.scene.leave();
    },
  ],
  onCancel: (ctx) => ctx.reply('Checkout cancelled. Your cart is still there.'),
});
