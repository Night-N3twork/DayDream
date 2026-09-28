import { Logger } from '@apis/logging';
import { SettingsAPI } from '@apis/settings';
import { v4 as uuidv4 } from 'uuid';

export interface SearchEngine {
	id: string;
	name: string;
	bang: string;
	at?: string;
	urlTemplate: string;
	builtIn: boolean;
}

export interface SearchEngineRegistryReader {
	findByBang(bang: string): SearchEngine | undefined;
	findByAt(at: string): SearchEngine | undefined;
}

export const BUILTIN_SEARCH_ENGINES: Omit<SearchEngine, 'id'>[] = [
	{ name: 'DuckDuckGo', bang: 'ddg', at: 'ddg', urlTemplate: 'https://duckduckgo.com/?q=%s', builtIn: true },
	{ name: 'Google', bang: 'g', at: 'google', urlTemplate: 'https://www.google.com/search?q=%s', builtIn: true },
	{ name: 'Brave', bang: 'br', at: 'brave', urlTemplate: 'https://search.brave.com/search?q=%s', builtIn: true },
	{ name: 'Bing', bang: 'b', at: 'bing', urlTemplate: 'https://www.bing.com/search?q=%s', builtIn: true },
	{ name: 'Yahoo', bang: 'y', at: 'yahoo', urlTemplate: 'https://search.yahoo.com/search?p=%s', builtIn: true },
	{ name: 'YouTube', bang: 'yt', at: 'yt', urlTemplate: 'https://www.youtube.com/results?search_query=%s', builtIn: true },
	{ name: 'Wikipedia', bang: 'w', at: 'wiki', urlTemplate: 'https://en.wikipedia.org/w/index.php?search=%s', builtIn: true },
	{ name: 'GitHub', bang: 'gh', at: 'gh', urlTemplate: 'https://github.com/search?q=%s', builtIn: true },
];

const URL_PREFIXES_TO_SKIP = ['http://', 'https://', 'data:', 'javascript:'];
const BANG_REGEX = /^\s*!([A-Za-z0-9._-]+)(?:\s+(.*))?$/;
const AT_REGEX = /^\s*@([A-Za-z0-9._-]+)(?:\s+(.*))?$/;
const DEFAULT_BANG = 'ddg';

export function parseBang(
	input: string,
	registry: SearchEngineRegistryReader,
): { engine: SearchEngine; query: string } | null {
	if (!input) return null;
	for (const prefix of URL_PREFIXES_TO_SKIP) {
		if (input.startsWith(prefix)) return null;
	}
	const match = input.match(BANG_REGEX);
	if (!match) return null;
	const engine = registry.findByBang(match[1]);
	if (!engine) return null;
	return { engine, query: match[2] ?? '' };
}

export function parseAtPrefix(
	input: string,
	registry: SearchEngineRegistryReader,
): { engine: SearchEngine; query: string } | null {
	if (!input) return null;
	for (const prefix of URL_PREFIXES_TO_SKIP) {
		if (input.startsWith(prefix)) return null;
	}
	const match = input.match(AT_REGEX);
	if (!match) return null;
	const engine = registry.findByAt(match[1]);
	if (!engine) return null;
	return { engine, query: match[2] ?? '' };
}

export function expandSearchTemplate(template: string, query: string): string {
	return template.replace('%s', encodeURIComponent(query));
}

const BOOTSTRAP_ENGINE: SearchEngine = {
	id: '__bootstrap__',
	name: 'DuckDuckGo',
	bang: DEFAULT_BANG,
	urlTemplate: 'https://duckduckgo.com/?q=%s',
	builtIn: true,
};

export class SearchEngineRegistry implements SearchEngineRegistryReader {
	private engines: SearchEngine[] = [];
	private defaultId: string | null = null;
	private loaded = false;
	private logger: Logger | null = null;
	private listeners = new Set<() => void>();

	constructor(private settings: SettingsAPI) {}

	private getLogger(): Logger {
		if (!this.logger) this.logger = new Logger();
		return this.logger;
	}

	async load(): Promise<void> {
		const rawEngines = await this.settings.getItem<unknown>('searchEngines');
		const rawDefaultId = await this.settings.getItem<string>('defaultSearchEngineId');

		if (rawEngines != null && !this.isValidEngineList(rawEngines)) {
			await this.settings.setItem('searchEngines.backup', rawEngines);
			try {
				const logResult = this.getLogger().createLog(
					'[searchEngines] corrupt registry value backed up to searchEngines.backup; reseeding built-ins',
				);
				logResult?.catch?.(() => {});
			} catch {
				/* ignore */
			}
			await this.seedFromBuiltins();
			this.loaded = true;
			return;
		}

		if (!Array.isArray(rawEngines) || rawEngines.length === 0) {
			const legacySearch = await this.settings.getItem<string>('search');
			await this.migrateFromLegacy(legacySearch);
			this.loaded = true;
			return;
		}

		this.engines = (rawEngines as SearchEngine[]).map((e) => ({ ...e }));
		if (rawDefaultId && this.engines.some((e) => e.id === rawDefaultId)) {
			this.defaultId = rawDefaultId;
		} else {
			this.defaultId = this.engines[0]?.id ?? null;
			await this.settings.setItem('defaultSearchEngineId', this.defaultId);
		}
		this.loaded = true;
	}

	private isValidEngineList(value: unknown): value is SearchEngine[] {
		if (!Array.isArray(value)) return false;
		return value.every((e) => {
			if (!e || typeof e !== 'object') return false;
			const o = e as Record<string, unknown>;
			return (
				typeof o.id === 'string' &&
				typeof o.name === 'string' &&
				typeof o.bang === 'string' &&
				typeof o.urlTemplate === 'string' &&
				typeof o.builtIn === 'boolean' &&
				(o.at === undefined || typeof o.at === 'string')
			);
		});
	}

	private async seedFromBuiltins(): Promise<void> {
		this.engines = BUILTIN_SEARCH_ENGINES.map((e) => ({ ...e, id: uuidv4() }));
		this.defaultId = this.engines.find((e) => e.bang === DEFAULT_BANG)?.id ?? this.engines[0].id;
		await this.persist();
	}

	private async migrateFromLegacy(legacySearch: string | null): Promise<void> {
		await this.seedFromBuiltins();
		if (!legacySearch) return;
		const match = this.engines.find((e) => e.urlTemplate === legacySearch);
		if (match) {
			this.defaultId = match.id;
		} else {
			const custom: SearchEngine = {
				id: uuidv4(),
				name: 'Custom',
				bang: 'custom',
				urlTemplate: legacySearch,
				builtIn: false,
			};
			this.engines.push(custom);
			this.defaultId = custom.id;
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		await this.settings.setItem('searchEngines', this.engines);
		if (this.defaultId) await this.settings.setItem('defaultSearchEngineId', this.defaultId);
	}

	private notify(): void {
		for (const fn of this.listeners) {
			try { fn(); } catch (err) { console.warn('[searchEngines] onChange handler threw:', err); }
		}
	}

	list(): SearchEngine[] {
		return this.engines.map((e) => ({ ...e }));
	}

	getDefault(): SearchEngine {
		if (!this.loaded || !this.defaultId) return { ...BOOTSTRAP_ENGINE };
		const match = this.engines.find((e) => e.id === this.defaultId);
		return match ? { ...match } : { ...BOOTSTRAP_ENGINE };
	}

	async setDefault(id: string): Promise<void> {
		if (!this.engines.some((e) => e.id === id)) {
			throw new Error(`Unknown engine id: ${id}`);
		}
		this.defaultId = id;
		await this.settings.setItem('defaultSearchEngineId', id);
		this.notify();
	}

	findByBang(bang: string): SearchEngine | undefined {
		const target = bang.toLowerCase();
		const hit = this.engines.find((e) => e.bang.toLowerCase() === target);
		return hit ? { ...hit } : undefined;
	}

	findByAt(at: string): SearchEngine | undefined {
		if (!at) return undefined;
		const target = at.toLowerCase();
		const hit = this.engines.find((e) => e.at?.toLowerCase() === target);
		return hit ? { ...hit } : undefined;
	}

	async add(engine: Omit<SearchEngine, 'id' | 'builtIn'>): Promise<SearchEngine> {
		this.validateTemplate(engine.urlTemplate);
		const normBang = engine.bang ? engine.bang.trim() : '';
		const normAt = engine.at && engine.at.trim() ? engine.at.trim() : undefined;
		this.validateAtLeastOnePrefix(normBang, normAt);
		if (normBang) this.validateBangUnique(normBang, null);
		if (normAt) this.validateAtUnique(normAt, null);
		const created: SearchEngine = { ...engine, bang: normBang, at: normAt, id: uuidv4(), builtIn: false };
		this.engines.push(created);
		await this.persist();
		this.notify();
		return { ...created };
	}

	async update(id: string, patch: Partial<Omit<SearchEngine, 'id' | 'builtIn'>>): Promise<void> {
		const idx = this.engines.findIndex((e) => e.id === id);
		if (idx === -1) throw new Error(`Unknown engine id: ${id}`);
		if (patch.urlTemplate !== undefined) this.validateTemplate(patch.urlTemplate);
		const normPatch: typeof patch = { ...patch };
		if (patch.bang !== undefined) {
			normPatch.bang = patch.bang.trim();
		}
		if (patch.at !== undefined) {
			const trimmed = patch.at.trim();
			normPatch.at = trimmed === '' ? undefined : trimmed;
		}
		const merged = { ...this.engines[idx], ...normPatch };
		this.validateAtLeastOnePrefix(merged.bang, merged.at);
		if (normPatch.bang !== undefined && normPatch.bang) this.validateBangUnique(normPatch.bang, id);
		if (normPatch.at !== undefined && normPatch.at) this.validateAtUnique(normPatch.at, id);
		this.engines[idx] = merged;
		await this.persist();
		this.notify();
	}

	async remove(id: string): Promise<void> {
		const idx = this.engines.findIndex((e) => e.id === id);
		if (idx === -1) throw new Error(`Unknown engine id: ${id}`);
		this.engines.splice(idx, 1);
		if (this.engines.length === 0) {
			await this.reset();
			return;
		}
		if (this.defaultId === id) {
			this.defaultId = this.engines[0].id;
			await this.settings.setItem('defaultSearchEngineId', this.defaultId);
		}
		await this.persist();
		this.notify();
	}

	async reset(): Promise<void> {
		await this.seedFromBuiltins();
		this.notify();
	}

	onChange(handler: () => void): () => void {
		this.listeners.add(handler);
		return () => { this.listeners.delete(handler); };
	}

	private validateTemplate(template: string): void {
		const occurrences = (template.match(/%s/g) || []).length;
		if (occurrences !== 1) {
			throw new Error('URL template must contain "%s" exactly once.');
		}
		try {
			new URL(template.replace('%s', 'test'));
		} catch {
			throw new Error('URL template is not a valid URL after substitution.');
		}
	}

	private validateBangUnique(bang: string, excludeId: string | null): void {
		const target = bang.toLowerCase();
		const clash = this.engines.find(
			(e) => e.bang.toLowerCase() === target && e.id !== excludeId,
		);
		if (clash) {
			throw new Error(`A search engine with bang "!${bang}" already exists (duplicate).`);
		}
	}

	private validateAtUnique(at: string, excludeId: string | null): void {
		const target = at.toLowerCase();
		const clash = this.engines.find(
			(e) => e.at?.toLowerCase() === target && e.id !== excludeId,
		);
		if (clash) {
			throw new Error(`A search engine with at "@${at}" already exists (duplicate).`);
		}
	}

	private validateAtLeastOnePrefix(bang: string | undefined, at: string | undefined): void {
		const hasBang = !!(bang && bang.trim());
		const hasAt = !!(at && at.trim());
		if (!hasBang && !hasAt) {
			throw new Error('At least one of "bang" or "at" must be set.');
		}
	}
}

/**
 * Pure helper that powers Proxy.search(). Extracted so it can be unit-tested
 * without instantiating the full Proxy (which pulls in BareMux + SW).
 */
export function searchImpl(input: string, registry: SearchEngineRegistry): string {
	input = input.trim();

	const bangHit = parseBang(input, registry);
	if (bangHit) {
		return expandSearchTemplate(bangHit.engine.urlTemplate, bangHit.query);
	}

	const defaultTemplate = registry.getDefault().urlTemplate;

	if (input.includes('.') && input.includes(' ')) {
		return expandSearchTemplate(defaultTemplate, input);
	}
	try {
		return new URL(input).toString();
	} catch {
		try {
			const url = new URL(`http://${input}`);
			if (url.hostname.includes('.')) return url.toString();
			throw new Error('Invalid hostname');
		} catch {
			return expandSearchTemplate(defaultTemplate, input);
		}
	}
}
