import { defineModule } from 'tglessjs';
import { startCommand } from './commands/start.command';
import { Users } from './entities/user.entity';
import { UsersService } from './services/users.service';

export const UsersModule = defineModule({
  name: 'users',
  providers: [UsersService],
  exports: [UsersService],
  entities: [Users],
  commands: [startCommand],
});
