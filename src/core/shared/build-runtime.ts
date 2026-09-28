import config from 'virtual:ddx-build-config';

export type BuildRuntime = typeof config;

let cached: BuildRuntime | null = null;

export function buildConfig(): BuildRuntime {
	if (cached) return cached;
	cached = Object.freeze({ ...config }) as BuildRuntime;
	return cached;
}

export function routes() {
	return buildConfig().routes;
}

export function globals() {
	return buildConfig().globals;
}

export function coverIdentity() {
	return buildConfig().cover.identity;
}
