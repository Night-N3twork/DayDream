import type { OmniboxRow, OmniboxSection } from '../types';
import type { SearchEngineRegistry } from '@apis/searchEngines';
import { expandSearchTemplate } from '@apis/searchEngines';
import type { Tabs } from '@browser/tabs';
import type { HistoryManager, HistorySearchResult } from '@apis/history';
import type { BookmarkManager } from '@apis/bookmarks';
import { isBookmark } from '@apis/bookmarks';
import type { Protocols, ProtocolRouteSnapshot } from '@browser/protocols';

export interface DefaultModeDeps {
	query: string;
	searchEngines: Pick<SearchEngineRegistry, 'getDefault'>;
	tabs: Pick<Tabs, 'searchOpen' | 'selectTab'> & { activeTabId?: string | null };
	history: Pick<HistoryManager, 'searchEntries'>;
	bookmarks: Pick<BookmarkManager, 'searchBookmarks'>;
	protocols: Pick<Protocols, 'listRoutes' | 'navigate'>;
	fetchSuggestions: (query: string, signal: AbortSignal) => Promise<string[]>;
	signal: AbortSignal;
	onNavigate: (url: string) => void;
}

export interface DefaultModeResult {
	primaryRow: OmniboxRow;
	sections: OmniboxSection[];
}

const CAPS = { tabs: 3, history: 4, bookmarks: 4, internal: 4, search: 6 };

function isUrlLike(s: string): boolean {
	if (s.startsWith('http://') || s.startsWith('https://')) return true;
	try {
		const u = new URL(s);
		return !!u.protocol;
	} catch {
		try {
			const u = new URL(`http://${s}`);
			return u.hostname.includes('.');
		} catch {
			return false;
		}
	}
}

export async function renderDefaultMode(deps: DefaultModeDeps): Promise<DefaultModeResult> {
	const { query } = deps;
	const defaultEngine = deps.searchEngines.getDefault();
	const urlLike = isUrlLike(query);

	const primaryRow: OmniboxRow = urlLike
		? {
			id: 'primary-go',
			icon: 'globe',
			label: `Go to: ${query}`,
			onSelect: () => deps.onNavigate(query.startsWith('http') ? query : `http://${query}`),
		}
		: {
			id: 'primary-search',
			icon: 'search',
			label: `Search ${defaultEngine.name} for: ${query}`,
			onSelect: () => deps.onNavigate(expandSearchTemplate(defaultEngine.urlTemplate, query)),
		};

	const tabsResults = safeCall(() => deps.tabs.searchOpen(query)) ?? [];
	const historyResults = safeCall(() => deps.history.searchEntries(query)) ?? [];
	const bookmarksRaw = safeCall(() => deps.bookmarks.searchBookmarks(query)) ?? [];
	const bookmarksResults = bookmarksRaw.filter(isBookmark);
	const protocolRoutes = safeCall(() => deps.protocols.listRoutes()) ?? [];

	let suggestions: string[] = [];
	try {
		suggestions = await deps.fetchSuggestions(query, deps.signal);
	} catch {
		suggestions = [];
	}

	const sections: OmniboxSection[] = [];

	if (tabsResults.length > 0) {
		const rows: OmniboxRow[] = tabsResults.slice(0, CAPS.tabs).map((t) => ({
			id: `tab-${t.tabId}`,
			icon: 'monitor',
			label: t.title,
			sublabel: hostnameOf(t.url),
			onSelect: () => { void deps.tabs.selectTab(t.tabId); },
		}));
		sections.push({
			id: 'tabs',
			title: 'Open tabs',
			icon: 'monitor',
			rows,
			hasMore: tabsResults.length > CAPS.tabs,
		});
	}

	if (historyResults.length > 0) {
		const rows: OmniboxRow[] = historyResults.slice(0, CAPS.history).map((r: HistorySearchResult) => ({
			id: `hist-${r.entry.id}`,
			icon: 'history',
			label: r.entry.title || r.entry.url,
			sublabel: hostnameOf(r.entry.url),
			onSelect: () => deps.onNavigate(r.entry.url),
		}));
		sections.push({
			id: 'history',
			title: 'History',
			icon: 'history',
			rows,
			hasMore: historyResults.length > CAPS.history,
		});
	}

	if (bookmarksResults.length > 0) {
		const rows: OmniboxRow[] = bookmarksResults.slice(0, CAPS.bookmarks).map((b) => ({
			id: `bm-${b.id}`,
			icon: 'star',
			label: b.title,
			sublabel: hostnameOf((b as { url: string }).url),
			onSelect: () => deps.onNavigate((b as { url: string }).url),
		}));
		sections.push({
			id: 'bookmarks',
			title: 'Bookmarks',
			icon: 'star',
			rows,
			hasMore: bookmarksResults.length > CAPS.bookmarks,
		});
	}

	const protoMatches = filterProtocolRoutes(protocolRoutes, query);
	if (protoMatches.length > 0) {
		const rows: OmniboxRow[] = protoMatches.slice(0, CAPS.internal).map((r) => ({
			id: `proto-${r.proto}-${r.path}`,
			icon: 'box',
			label: `${r.proto}://${r.path}`,
			onSelect: () => { void deps.protocols.navigate(`${r.proto}://${r.path}`); },
		}));
		sections.push({
			id: 'internal',
			title: 'Internal pages',
			icon: 'box',
			rows,
			hasMore: protoMatches.length > CAPS.internal,
		});
	}

	if (suggestions.length > 0) {
		const rows: OmniboxRow[] = suggestions.slice(0, CAPS.search).map((s, i) => ({
			id: `sug-${i}`,
			icon: 'search',
			label: s,
			onSelect: () => deps.onNavigate(expandSearchTemplate(defaultEngine.urlTemplate, s)),
		}));
		sections.push({
			id: 'search',
			title: 'Search suggestions',
			icon: 'search',
			rows,
			hasMore: suggestions.length > CAPS.search,
		});
	}

	return { primaryRow, sections };
}

function safeCall<T>(fn: () => T): T | null {
	try { return fn(); } catch (err) { console.warn('[omnibox/default] section threw:', err); return null; }
}

function hostnameOf(url: string): string {
	try { return new URL(url).hostname; } catch { return url; }
}

function filterProtocolRoutes(routes: ProtocolRouteSnapshot[], query: string): ProtocolRouteSnapshot[] {
	const q = query.toLowerCase();
	return routes
		.filter((r) => r.path !== '*')
		.filter((r) => `${r.proto}://${r.path}`.toLowerCase().includes(q));
}
