import { expect, it } from 'vitest';
import { ChromeI18n } from './i18n';

it('looks up extension message keys case-insensitively', () => {
  const api = new ChromeI18n({
    id: 'localized-extension',
    origin: 'localized-extension.ddx',
    manifestVersion: 3,
    manifest: { manifest_version: 3, name: '__MSG_extName__' } as any,
    i18nLocale: 'en',
    i18nMessages: { extname: { message: 'Localized Extension Name' } },
  });

  expect(api.getMessage('extName')).toBe('Localized Extension Name');
});
