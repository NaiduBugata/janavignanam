import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { BirthdaysController } from './birthdays.controller';
import { BirthdaysSchedulerService } from './birthdays-scheduler.service';
import { BirthdaysService } from './birthdays.service';
import { MessagesController } from './messages.controller';
import { ContactMessagesService } from './messages.service';

@Module({
  imports: [AdminModule],
  controllers: [BirthdaysController, MessagesController],
  providers: [
    BirthdaysService,
    BirthdaysSchedulerService,
    ContactMessagesService,
  ],
})
export class BirthdaysModule {}
