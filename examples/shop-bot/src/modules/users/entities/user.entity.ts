import { c, entity, type Infer } from 'tglessjs/db';

export const Users = entity('users', {
  id: c.id(),
  tgId: c.int().unique(),
  firstName: c.text(),
  username: c.text().optional(),
  lang: c.text().default('en'),
  isBlocked: c.bool().default(false),
  ...c.timestamps(),
});

export type User = Infer<typeof Users>;
