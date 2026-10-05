const DAYDREAM_SOCIAL_BAR_URL = 'https://bauval.org/14/dac4c81ea0baf231b58310131aba958c';

export function injectDaydreamAds(
	enabled: boolean,
	doc: Document = document,
): HTMLScriptElement | null {
	if (!enabled || !doc.body) return null;
	const existing = doc.querySelector<HTMLScriptElement>(`script[src="${DAYDREAM_SOCIAL_BAR_URL}"]`);
	if (existing) return existing;

	const script = doc.createElement('script');
	script.src = DAYDREAM_SOCIAL_BAR_URL;
	script.setAttribute('data-cfasync', 'false');
	doc.body.appendChild(script);
	return script;
}
