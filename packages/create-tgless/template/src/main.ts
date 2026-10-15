import { createApp } from 'tglessjs';
import { CoreModule } from './modules/core/core.module';

export default createApp({
  modules: [CoreModule],
  parseMode: 'HTML',
});
