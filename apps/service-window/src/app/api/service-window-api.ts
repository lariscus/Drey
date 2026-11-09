import { InjectionToken } from '@angular/core';
import type { ServiceWindowApi } from '../../../../../shared/service-window/contract';
import { DemoServiceWindowApi } from './demo-api';

/** The preload's `window.serviceWindow`, or the demo data when there is no bridge (plain browser, specs). */
export const SERVICE_WINDOW_API = new InjectionToken<ServiceWindowApi>('SERVICE_WINDOW_API', {
  providedIn: 'root',
  factory: (): ServiceWindowApi => {
    const bridge = (window as unknown as { serviceWindow?: ServiceWindowApi }).serviceWindow;
    return bridge ?? new DemoServiceWindowApi();
  },
});
