import { describe, expect, it, vi } from 'vitest';
import { routeUpgrade } from './upgrade-router';

const routes = { encoded: '/app/assets/e2uev/', plain: '/wisp/' };

describe('routeUpgrade', () => {
	it('routes plain /wisp/ to onPlain', () => {
		const enc = vi.fn();
		const pl = vi.fn();
		const rj = vi.fn();
		routeUpgrade('/wisp/', routes, enc, pl, rj);
		expect(pl).toHaveBeenCalled();
		expect(enc).not.toHaveBeenCalled();
		expect(rj).not.toHaveBeenCalled();
	});

	it('routes encoded path with query to onEncoded', () => {
		const enc = vi.fn();
		const pl = vi.fn();
		const rj = vi.fn();
		routeUpgrade('/app/assets/e2uev/?session=x', routes, enc, pl, rj);
		expect(enc).toHaveBeenCalled();
		expect(pl).not.toHaveBeenCalled();
		expect(rj).not.toHaveBeenCalled();
	});

	it('rejects unknown upgrades', () => {
		const enc = vi.fn();
		const pl = vi.fn();
		const rj = vi.fn();
		routeUpgrade('/', routes, enc, pl, rj);
		expect(rj).toHaveBeenCalled();
		routeUpgrade('/random/path', routes, enc, pl, rj);
		expect(rj).toHaveBeenCalledTimes(2);
		expect(enc).not.toHaveBeenCalled();
		expect(pl).not.toHaveBeenCalled();
	});

	it('normalizes trailing slashes', () => {
		const enc = vi.fn();
		const pl = vi.fn();
		const rj = vi.fn();
		routeUpgrade('/wisp', routes, enc, pl, rj);
		expect(pl).toHaveBeenCalled();
	});
});
