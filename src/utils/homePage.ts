export function isCustomHomePage(value: string | null): value is string {
	if (!value) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

export function normalizeCustomHomePage(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const normalized = trimmed.startsWith('//')
		? `https:${trimmed}`
		: /^[a-z][a-z0-9+\-.]*:/i.test(trimmed)
			? trimmed
			: `https://${trimmed}`;
	return isCustomHomePage(normalized) ? normalized : null;
}
