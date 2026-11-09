import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LogPanel } from '../log/log-panel';

/** The Logs tab: the log panel at full size, with the component filter. */
@Component({
  selector: 'sw-logs-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LogPanel],
  templateUrl: './logs-tab.html',
  styleUrl: './logs-tab.css',
})
export class LogsTab {}
