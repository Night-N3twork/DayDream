import { SettingsAPI } from '@apis/settings';
import { ProfilesAPI } from '@apis/profiles';
import { SearchEngineRegistry } from '@apis/searchEngines';
import { universalTheme } from '@utils/global/universalTheme';
import { checkNightPlusStatus } from '@apis/nightplus';
import { basePath, resolvePath } from '@utils/basepath';
import { buildConfig } from '@core/shared/build-runtime';
import type { BootReadiness } from './readiness';

export interface BackgroundResult {
	SW: ServiceWorkerRegistration;
	settingsAPI: SettingsAPI;
	profilesAPI: ProfilesAPI;
	searchEngines: SearchEngineRegistry;
}

export async function backgroundInit(
	readiness: BootReadiness,
): Promise<BackgroundResult> {
	const settingsAPI = new SettingsAPI();

	const [SW, , profilesAPI] = await Promise.all([
		navigator.serviceWorker
			// MUST match the filename used by proxy.registerSW / index.ts
			// swConfig (both use `buildConfig().cover.worker`). Registering a
			// different script at the same scope makes the first redundant and
			// the scramjet Controller ends up posting `$controller$init` to a
			// dead worker — proxied navigations then 404 (never routed).
			.register(resolvePath(buildConfig().cover.worker), {
				scope: basePath,
			})
			.then(async (reg) => {
				await navigator.serviceWorker.ready;
				return reg;
			}),
		universalTheme.init().then(() => {
			const theming = universalTheme.getTheming();
			theming.applyTheme(theming.currentTheme);
		}),
		(async () => {
			const p = new ProfilesAPI(checkNightPlusStatus, 3);
			await p.initPromise;
			return p;
		})(),
	]);

	const searchEngines = new SearchEngineRegistry(settingsAPI);
	await searchEngines.load();

	readiness.resolveSettings();

	return { SW, settingsAPI, profilesAPI, searchEngines };
}
