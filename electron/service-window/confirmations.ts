/**
 * The two questions the service window asks natively (req-165, board 8a's
 * "Quit service asks while runs live", the tray's Stop all running
 * steps…): one message box each, the strings from the catalog.
 */
import { dialog, type BrowserWindow } from 'electron';
import { i18n } from '../../shared/i18n';

export class Confirmations {
  constructor(private readonly parent: () => BrowserWindow | null) {}

  private async ask(message: string, detail: string | undefined, confirm: string): Promise<boolean> {
    const options = {
      type: 'warning' as const,
      title: i18n.t('service_tray.window_title'),
      message,
      ...(detail === undefined ? {} : { detail }),
      buttons: [confirm, i18n.t('service_tray.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const parent = this.parent();
    const reply = parent === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
    return reply.response === 0;
  }

  /** True when the service may quit: nothing lives, or the owner said so. */
  quitService(liveRuns: number): Promise<boolean> {
    if (liveRuns === 0) {
      return Promise.resolve(true);
    }
    return this.ask(i18n.t('service_tray.quit.message', { count: liveRuns }), i18n.t('service_tray.quit.detail'), i18n.t('service_tray.quit'));
  }

  stopAll(liveRuns: number): Promise<boolean> {
    return this.ask(i18n.t('service_tray.stop_all.message', { count: liveRuns }), undefined, i18n.t('service_tray.stop_all.confirm'));
  }
}
