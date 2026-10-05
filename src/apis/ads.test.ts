import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('injects Daydream SocialBar into the outer body only when the build flag is enabled', async () => {
	const modulePath = './ads.ts';
	const module = await import(/* @vite-ignore */ modulePath).catch(() => ({}));
	expect(module.injectDaydreamAds, 'Daydream ad injector').toBeTypeOf('function');
	const { injectDaydreamAds } = module as typeof import('./ads');
	const append = vi.spyOn(document.body, 'appendChild');

	expect(injectDaydreamAds(false, document)).toBeNull();
	expect(append).not.toHaveBeenCalled();
	const script = injectDaydreamAds(true, document);
	expect(script?.src).toBe('https://bauval.org/14/dac4c81ea0baf231b58310131aba958c');
	expect(script?.getAttribute('data-cfasync')).toBe('false');
	expect(script?.getAttribute('data-ddx-ad')).toBeNull();
	expect(append).toHaveBeenCalledWith(script);
	expect(injectDaydreamAds(true, document)).toBe(script);
});
