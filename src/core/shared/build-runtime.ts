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
	const identity = buildConfig().cover.identity;
	return Object.freeze({
		...identity,
		product: 'Daydream',
		title: 'Daydream',
		description: 'The Daydream browser.',
	});
}
