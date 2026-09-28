import { describe, expect, it } from 'vitest';
import {
	expandSearchTemplate,
	searchImpl,
	type SearchEngine,
	type SearchEngineRegistry,
} from './searchEngines';

const customEngine: SearchEngine = {
	id: 'custom',
	name: 'Custom Search',
	bang: 'custom',
	urlTemplate: 'https://search.example/search?query=%s&source=ddx',
	builtIn: false,
};

function registryWith(engine: SearchEngine): SearchEngineRegistry {
	return {
		getDefault: () => engine,
		findByBang: (bang) => (bang === engine.bang ? engine : undefined),
	} as SearchEngineRegistry;
}

describe('expandSearchTemplate', () => {
	it('encodes the query before substituting it into the template', () => {
		expect(expandSearchTemplate('https://search.example/?q=%s', 'C++ & tea/coffee?')).toBe(
			'https://search.example/?q=C%2B%2B%20%26%20tea%2Fcoffee%3F',
		);
	});
});

describe('searchImpl', () => {
	it('uses a custom default engine template for searches', () => {
		expect(searchImpl('green tea', registryWith(customEngine))).toBe(
			'https://search.example/search?query=green%20tea&source=ddx',
		);
	});

	it('uses the bang engine template and encodes its query', () => {
		expect(searchImpl('!custom C++ & tea', registryWith(customEngine))).toBe(
			'https://search.example/search?query=C%2B%2B%20%26%20tea&source=ddx',
		);
	});
});
