import { createApp } from 'tgless';
import { CoreModule } from './modules/core/core.module';

export default createApp({
  modules: [CoreModule],
  parseMode: 'HTML',
});
