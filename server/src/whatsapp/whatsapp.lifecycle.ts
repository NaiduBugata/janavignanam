import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NotificationStatusRepository } from '../database/repositories/notification-status.repository';
import { truthy } from '../common/utils/truthy';
import {
  notifyShutdownWhatsApp,
  notifyStartupWhatsApp,
} from './whatsapp.notify';
import { setWhatsAppStatusRecorder } from './whatsapp.send';

/**
 * Startup and shutdown WhatsApp notices. Off unless WHATSAPP_ON_API=true, so
 * Flask remains the process that sends them until cutover.
 */
@Injectable()
export class WhatsAppLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppLifecycleService.name);

  constructor(status: NotificationStatusRepository) {
    setWhatsAppStatusRecorder((update) =>
      status.record('whatsapp', {
        status: update.status,
        enabled: update.enabled,
        error: update.error,
        notificationType: update.notificationType,
        httpCode: update.httpCode,
      }),
    );
  }

  onModuleInit(): void {
    if (!truthy(process.env.WHATSAPP_ON_API)) {
      this.logger.log('WhatsApp startup notice stays with Flask.');
      return;
    }
    void notifyStartupWhatsApp().catch((err) => {
      this.logger.error(err instanceof Error ? err.message : String(err));
    });
  }

  onModuleDestroy(): void {
    if (!truthy(process.env.WHATSAPP_ON_API)) return;
    void notifyShutdownWhatsApp().catch((err) => {
      this.logger.error(err instanceof Error ? err.message : String(err));
    });
  }
}
