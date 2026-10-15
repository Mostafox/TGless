import { InjectionToken } from 'tglessjs';

export interface ShopConfig {
  adminIds: number[];
  currency: string;
  pageSize: number;
}

export const SHOP_CONFIG = new InjectionToken<ShopConfig>('ShopConfig');

export const shopConfig: ShopConfig = {
  adminIds: (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean),
  currency: 'USD',
  pageSize: 5,
};
