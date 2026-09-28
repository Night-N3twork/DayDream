const TAG = '[terbium/notifications]';

export interface TerbiumNotificationOptions {
  iconSrc?: string;
  time?: number;
  [key: string]: unknown;
}

export function installNotifications(tb: any): void {
  if (typeof tb?.notification?.Toast !== 'function') {
    console.warn(TAG, 'tb.notification.Toast not available — skipping install');
    return;
  }

  (globalThis as any).__ddxNotify = (
    message: string,
    options: TerbiumNotificationOptions = {},
  ): void => {
    tb.notification.Toast({
      message,
      application: 'Daydream',
      iconSrc: './icon.png',
      ...options,
    });
  };

  console.log(TAG, 'notification helper installed');
}
