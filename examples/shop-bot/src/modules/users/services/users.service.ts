import type { Telegram } from 'tglessjs';
import { Users, type User } from '../entities/user.entity';

export class UsersService {
  /** Create or refresh the user row for a Telegram user. */
  async sync(from: Telegram.User): Promise<User> {
    return Users.upsert({
      where: { tgId: from.id },
      create: { firstName: from.first_name, username: from.username ?? null, lang: from.language_code ?? 'en' },
      update: { firstName: from.first_name, username: from.username ?? null },
    });
  }

  byTgId(tgId: number) {
    return Users.find({ tgId });
  }

  count() {
    return Users.count({ isBlocked: false });
  }
}
