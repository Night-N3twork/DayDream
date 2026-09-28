import '@css/vars.scss';
import '@css/imports.scss';
import '@css/tailwind.css';
import '@css/global.scss';
import '@css/internal.scss';
import 'basecoat-css/all';
import '@utils/global/panic';
import '@pages/shared/themeInit';
import { createIcons, icons } from 'lucide';
import { resolvePath } from '@utils/basepath';

import { BookmarkManager, isBookmark } from '@apis/bookmarks';
import { Nightmare } from '@pkgs/Nightmare';

interface Shortcut {
	id: string;
	title: string;
	url: string;
	favicon?: string;
}

class NewTabShortcuts {
	private bookmarkManager: BookmarkManager;
	private ui: Nightmare;
	private shortcuts: Shortcut[] = [];
	private currentEditingId: string | null = null;

	private defaultShortcuts: Omit<Shortcut, 'id' | 'favicon'>[] = [
		{ title: 'Google', url: 'https://google.com' },
		{ title: 'YouTube', url: 'https://youtube.com' },
		{ title: 'GitLab', url: 'https://gitlab.com' },
		{ title: 'Reddit', url: 'https://reddit.com' },
		{ title: 'Twitter', url: 'https://twitter.com' },
		{ title: 'Wikipedia', url: 'https://wikipedia.org' },
		{ title: 'Stack Overflow', url: 'https://stackoverflow.com' },
		{ title: 'Discord', url: 'https://discord.com' },
		{ title: 'Netflix', url: 'https://netflix.com' },
		{ title: 'Amazon', url: 'https://amazon.com' },
		{ title: 'Spotify', url: 'https://spotify.com' },
		{ title: 'Twitch', url: 'https://twitch.tv' }
	];

	constructor() {
		this.bookmarkManager = new BookmarkManager();
		this.ui = new Nightmare();
		(async () => {
			const proxySettings = window.parent.ProxySettings || 'sj';
			const swConfig =
				window.parent.SWconfig?.[
					proxySettings as keyof typeof window.parent.SWconfig
				];
			if (swConfig) {
				await window.parent.proxy.registerSW(swConfig);
			}
			await window.parent.proxy.setTransports();
			const transportState = await window.parent.proxy.getTransports();
			if (transportState.controller == null) {
				await window.parent.proxy.setTransports();
			}
		})();

		setTimeout(() => {
			window.parent.proxy.setBookmarkManager(this.bookmarkManager);
			this.init();
		}, 20);
	}

	private async init() {
		await this.bookmarkManager.loadFromStorage();
		await this.loadShortcuts();
		await this.renderNewtab();
		this.setupEventListeners();
		createIcons({ icons });
	}

	private async renderNewtab() {
		document.body.innerHTML = '';

		const mainContainer = this.ui.createElement('div', {
			class: 'bg-[var(--bg-2)] text-[var(--text)] select-none antialiased',
			component: 'newtab-main'
		});

		const contentWrapper = this.ui.createElement('div', {
			class: 'min-h-dvh w-full relative overflow-hidden',
			component: 'content-wrapper'
		});

		const main = this.ui.createElement('main', {
			class: 'mx-auto max-w-6xl px-4 pt-28 pb-24',
			component: 'main-content'
		});

		const header = this.renderHeader();
		main.appendChild(header);

		const searchBar = this.renderSearchBar();
		main.appendChild(searchBar);

		const showShortcuts = await window.parent.settings?.getItem(
			'newtabShowShortcuts'
		);
		if (showShortcuts !== 'false') {
			const shortcutsSection = this.renderShortcuts();
			main.appendChild(shortcutsSection);
		}

		contentWrapper.appendChild(main);

		const modal = this.renderModal();
		contentWrapper.appendChild(modal);

		const signInButton = this.renderSignInButton();
		contentWrapper.appendChild(signInButton);

		const footer = this.renderFooter();
		contentWrapper.appendChild(footer);

		mainContainer.appendChild(contentWrapper);
		document.body.appendChild(mainContainer);
	}

	private renderHeader() {
		return this.ui.createElement(
			'div',
			{
				class: 'flex items-center justify-center',
				component: 'header'
			},
			[
				this.ui.createElement('div', { class: 'relative' }, [
					this.ui.createElement(
						'div',
						{
							class: 'backdrop-blur inline-flex items-center gap-2 rounded-2xl border border-[var(--white-10)] bg-[var(--bg-2)] px-6 py-3 shadow-[0_0_1px_var(--shadow-outer)]',
							component: 'logo-container'
						},
						[
							this.ui.createElement(
								'div',
								{ class: 'stack h-10 w-10' },
								[
									this.ui.createElement(
										'div',
										{
											class: 'masked-shape',
											style: `width: 100%; height: 100%; background: var(--main); -webkit-mask-image: url('${resolvePath('res/logo/mask.png')}'); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; -webkit-mask-size: cover; -webkit-mask-mode: luminance; mask-image: url('${resolvePath('res/logo/mask.png')}'); mask-repeat: no-repeat; mask-position: center; mask-size: cover; mask-mode: luminance;`
										},
										[
											this.ui.createElement('img', {
												class: 'overlay',
												src: resolvePath(
													'res/logo/overlay.png'
												),
												alt: 'overlay gradient',
												style: 'width: 100%; height: 100%; mix-blend-mode: multiply; pointer-events: none;'
											})
										]
									)
								]
							),
							this.ui.createElement(
								'span',
								{
									class: 'text-3xl tracking-widest text-[var(--text)] -mr-1', id: 'title-txt'
								},
								['DayDream']
							),
							this.ui.createElement(
								'button',
								{
									class: 'grid place-items-center rounded-full h-7 w-7 text-[var(--text)]/80 hover:bg-[var(--white-05)]',
									'data-tooltip': 'Share',
									'data-side': 'right',
									'data-align': 'center',
									'aria-label': 'Share',
									component: 'share-button'
								},
								[
									this.ui.createElement('i', {
										'data-lucide': 'share-2',
										class: 'h-4 w-4 text-white'
									})
								]
							)
						]
					),
					this.ui.createElement('div', { id: 'trigger' })
				])
			]
		);
	}

	private renderSearchBar() {
		return this.ui.createElement(
			'div',
			{
				class: 'mt-8 relative',
				component: 'search-bar'
			},
			[
				this.ui.createElement('input', {
					class: 'w-full rounded-xl bg-[var(--bg-2)] pl-4 pr-12 py-3 text-sm text-[var(--text)] backdrop-blur placeholder:text-[var(--text)]/40 ring-1 ring-inset ring-[var(--main-35a)] focus:outline-none focus:ring-2 focus:ring-[var(--main)] shadow-[0_0_1px_var(--shadow-outer)]',
					placeholder: 'Search for anything...',
					'aria-label': 'Search',
					id: 'searchInput',
					component: 'search-input',
					onkeydown: (e: KeyboardEvent) => {
						if (e.key === 'Enter') {
							const target = e.target as HTMLInputElement;
							const value = target.value.trim();
							window.parent.protocols.navigate(
								window.parent.proxy.search(value)
							);
						}
					}
				})
			]
		);
	}

	private renderShortcuts() {
		const section = this.ui.createElement('section', {
			id: 'shortcuts-section',
			component: 'shortcuts-section',
			class: 'mt-8 grid grid-cols-6 gap-4 max-w-4xl mx-auto'
		});

		this.shortcuts.forEach(shortcut => {
			const shortcutElement = this.createShortcutElement(shortcut);
			section.appendChild(shortcutElement);
		});

		const remaining = 12 - this.shortcuts.length;
		for (let i = 0; i < remaining; i++) {
			const emptySlot = this.createEmptySlot();
			section.appendChild(emptySlot);
		}

		return section;
	}

	private renderModal() {
		return this.ui.createElement(
			'div',
			{
				id: 'editShortcutModal',
				component: 'shortcut-modal',
				class: 'fixed inset-0 bg-black/50 backdrop-blur-sm z-50 hidden items-center justify-center'
			},
			[
				this.ui.createElement(
					'div',
					{
						class: 'bg-[var(--bg-1)] rounded-xl border border-[var(--white-08)] p-6 w-full max-w-md mx-4',
						component: 'modal-content'
					},
					[
						this.ui.createElement(
							'h3',
							{
								class: 'text-lg font-semibold text-[var(--text)] mb-4'
							},
							['Edit Shortcut']
						),
						this.ui.createElement(
							'form',
							{
								id: 'editShortcutForm',
								component: 'shortcut-form',
								class: 'space-y-4'
							},
							[
								this.ui.createElement('div', {}, [
									this.ui.createElement(
										'label',
										{
											class: 'block text-sm font-medium text-[var(--text)] mb-2'
										},
										['Title']
									),
									this.ui.createElement('input', {
										type: 'text',
										id: 'shortcutTitle',
										component: 'title-input',
										required: true,
										class: 'w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--white-10)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--main)] focus:border-transparent'
									})
								]),
								this.ui.createElement('div', {}, [
									this.ui.createElement(
										'label',
										{
											class: 'block text-sm font-medium text-[var(--text)] mb-2'
										},
										['URL']
									),
									this.ui.createElement('input', {
										type: 'url',
										id: 'shortcutUrl',
										component: 'url-input',
										required: true,
										class: 'w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--white-10)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--main)] focus:border-transparent'
									})
								]),
								this.ui.createElement(
									'div',
									{
										class: 'flex justify-end gap-3'
									},
									[
										this.ui.createElement(
											'button',
											{
												type: 'button',
												id: 'cancelEditShortcut',
												component: 'cancel-button',
												class: 'px-4 py-2 bg-[var(--white-10)] text-[var(--text)] rounded-lg hover:bg-[var(--white-20)] transition-colors'
											},
											['Cancel']
										),
										this.ui.createElement(
											'button',
											{
												type: 'submit',
												component: 'save-button',
												class: 'px-4 py-2 bg-[var(--main)] text-white rounded-lg hover:bg-[var(--main)]/90 transition-colors'
											},
											['Save Changes']
										)
									]
								)
							]
						)
					]
				)
			]
		);
	}

	private renderSignInButton() {
		return this.ui.createElement(
			'div',
			{
				class: 'absolute bottom-16 left-0 right-0 flex justify-center',
				component: 'signin-container'
			},
			[
				this.ui.createElement(
					'button',
					{
						id: 'nightPlusSignIn',
						component: 'signin-button',
						class: 'pointer-events-auto px-6 py-2 bg-[var(--main)] text-white rounded-lg hover:bg-[var(--main)]/90 transition-colors text-sm font-medium'
					},
					['Sign into Night+']
				)
			]
		);
	}

	private renderFooter() {
		const latencySpan = this.ui.createElement(
			'span',
			{
				id: 'latency',
				component: 'latency',
				class: 'text-[var(--text)]/80 ml-1'
			},
			['...']
		);

		const pingButton = this.ui.createElement(
			'button',
			{
				id: 'ping-button',
				component: 'ping-button',
				class: 'ml-2 text-xs hover:opacity-70 transition-opacity cursor-pointer flex items-center',
				title: 'Check latency',
				onclick: () => this.checkLatency()
			},
			[
				this.ui.createElement('i', {
					'data-lucide': 'refresh-cw',
					class: 'h-3 w-3'
				})
			]
		);

		return this.ui.createElement(
			'footer',
			{
				class: 'pointer-events-none absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs text-[var(--proto)]',
				component: 'footer'
			},
			[
				this.ui.createElement(
					'span',
					{
						class: 'pointer-events-auto flex items-center',
						component: 'latency-container'
					},
					['Server Latency: ', latencySpan, pingButton]
				),
				this.ui.createElement(
					'nav',
					{
						class: 'pointer-events-auto flex items-center gap-4',
						component: 'footer-nav'
					},
					[
						this.ui.createElement(
							'a',
							{
								href: 'https://gitlab.com/nightnetwork/daydreamx',
								rel: 'noreferrer',
								class: 'hover:text-[var(--text)]',
								component: 'gitlab-link',
								onclick: (e: Event) => {
									e.preventDefault();
									const url = (
										e.target as HTMLAnchorElement
									).getAttribute('href');
									if (url && window.parent.tabs) {
										window.parent.tabs.createTab(url);
									}
								}
							},
							['GitLab']
						),
						this.ui.createElement('span', {}, ['\\']),
						this.ui.createElement(
							'a',
							{
								href: 'https://discord.night-x.com',
								rel: 'noreferrer',
								class: 'hover:text-[var(--text)]',
								component: 'discord-link',
								onclick: (e: Event) => {
									e.preventDefault();
									const url = (
										e.target as HTMLAnchorElement
									).getAttribute('href');
									if (url && window.parent.tabs) {
										window.parent.tabs.createTab(url);
									}
								}
							},
							['Discord']
						),
						this.ui.createElement('span', {}, ['\\']),
						this.ui.createElement(
							'a',
							{
								href: resolvePath('internal/privacy/'),
								class: 'hover:text-[var(--text)]',
								component: 'privacy-link'
							},
							['Privacy']
						),
						this.ui.createElement('span', {}, ['\\']),
						this.ui.createElement(
							'a',
							{
								href: resolvePath('internal/terms/'),
								class: 'hover:text-[var(--text)]',
								component: 'terms-link'
							},
							['Terms']
						)
					]
				)
			]
		);
	}

	private async checkLatency() {
		const latencyElement =
			this.ui.queryComponent('latency') ||
			document.getElementById('latency');
		const pingButton =
			this.ui.queryComponent('ping-button') ||
			document.getElementById('ping-button');

		if (!latencyElement || !pingButton) return;

		try {
			pingButton.innerHTML =
				'<i data-lucide="loader-2" class="h-3 w-3 animate-spin"></i>';
			(pingButton as HTMLButtonElement).disabled = true;

			const result = await window.parent.proxy.ping(
				window.parent.proxy.wispUrl
			);

			if (result.online) {
				latencyElement.textContent = `${result.ping}ms`;
				latencyElement.classList.remove('text-red-500');
				latencyElement.classList.remove('text-[var(--text)]/80');
				latencyElement.classList.add('text-green-500');
			} else {
				latencyElement.textContent = 'Offline';
				latencyElement.classList.remove('text-green-500');
				latencyElement.classList.remove('text-[var(--text)]/80');
				latencyElement.classList.add('text-red-500');
			}

			pingButton.innerHTML =
				'<i data-lucide="refresh-cw" class="h-3 w-3"></i>';
			(pingButton as HTMLButtonElement).disabled = false;

			createIcons({ icons });
		} catch (error) {
			latencyElement.textContent = 'Error';
			latencyElement.style.color = 'red';
			pingButton.innerHTML =
				'<i data-lucide="refresh-cw" class="h-3 w-3"></i>';
			(pingButton as HTMLButtonElement).disabled = false;
			createIcons({ icons });
			console.error('Latency check failed:', error);
		}
	}

	private async getFavicon(url: string): Promise<string> {
		try {
			const cachedFavicon = this.bookmarkManager.getCachedFavicon(url);
			if (cachedFavicon) {
				return cachedFavicon;
			}

			const faviconUrl = await window.parent.proxy.getFavicon(url);
			return faviconUrl || this.getFallbackFavicon();
		} catch (error) {
			console.warn('Failed to get favicon for', url, error);
			return this.getFallbackFavicon();
		}
	}

	private getFallbackFavicon(): string {
		return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggMTVBNyA3IDAgMSAwIDggMUE3IDcgMCAwIDAgOCAxNVoiIGZpbGw9IiNFNUU3RUIiLz4KPHBhdGggZD0iTTggMTJBNCA0IDAgMSAwIDggNEE0IDQgMCAwIDAgOCAxMloiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+';
	}

	private async loadShortcuts() {
		try {
			const folders = this.bookmarkManager.getFolders();
			let shortcutsFolder = folders.find(
				f => f.title.toLowerCase() === 'shortcuts'
			);

			if (!shortcutsFolder) {
				await this.createDefaultShortcuts();
				const updatedFolders = this.bookmarkManager.getFolders();
				shortcutsFolder = updatedFolders.find(
					f => f.title.toLowerCase() === 'shortcuts'
				);
			}

			if (shortcutsFolder) {
				const shortcutBookmarks = this.bookmarkManager
					.getItemsByParent(shortcutsFolder.id)
					.filter(item => isBookmark(item))
					.slice(0, 12);

				this.shortcuts = await Promise.all(
					shortcutBookmarks.map(async bookmark => {
						if (isBookmark(bookmark)) {
							return {
								id: bookmark.id,
								title: bookmark.title,
								url: bookmark.url,
								favicon: await this.getFavicon(bookmark.url)
							};
						}
						return null;
					})
				).then(results => results.filter(Boolean) as Shortcut[]);

				const hasFallbackIcons = this.shortcuts.some(
					shortcut => shortcut.favicon === this.getFallbackFavicon()
				);

				if (hasFallbackIcons) {
					setTimeout(async () => {
						await this.reloadFavicons();
					}, 1000);
				}
			}
		} catch (error) {
			console.error('Failed to load shortcuts:', error);
			if (this.shortcuts.length === 0) {
				await this.createDefaultShortcuts();
			}
		}
	}

	private async reloadFavicons() {
		let updated = false;

		for (const shortcut of this.shortcuts) {
			if (shortcut.favicon === this.getFallbackFavicon()) {
				try {
					const newFavicon = await this.getFavicon(shortcut.url);
					if (newFavicon !== this.getFallbackFavicon()) {
						shortcut.favicon = newFavicon;
						updated = true;
					}
				} catch (error) {
					console.warn(
						'Failed to reload favicon for',
						shortcut.url,
						error
					);
				}
			}
		}

		if (updated) {
			this.refreshShortcuts();
		}
	}

	private async createDefaultShortcuts() {
		const shortcutsFolderId = await this.getOrCreateShortcutsFolder();

		const existingBookmarks = this.bookmarkManager
			.getItemsByParent(shortcutsFolderId)
			.filter(item => isBookmark(item));

		if (existingBookmarks.length > 0) {
			return;
		}

		for (const defaultShortcut of this.defaultShortcuts) {
			try {
				await this.bookmarkManager.createBookmark({
					title: defaultShortcut.title,
					url: defaultShortcut.url,
					parentId: shortcutsFolderId
				});
			} catch (error) {
				console.error(
					`Failed to create shortcut for ${defaultShortcut.title}:`,
					error
				);
			}
		}
	}

	private async getOrCreateShortcutsFolder(): Promise<string> {
		const folders = this.bookmarkManager.getFolders();
		let shortcutsFolder = folders.find(
			f => f.title.toLowerCase() === 'shortcuts'
		);

		if (!shortcutsFolder) {
			shortcutsFolder = await this.bookmarkManager.createFolder({
				title: 'Shortcuts'
			});
		}

		return shortcutsFolder.id;
	}

	private createShortcutElement(shortcut: Shortcut): HTMLElement {
		return this.ui.createElement(
			'div',
			{
				class: 'shortcut-item relative group',
				component: `shortcut-${shortcut.id}`
			},
			[
				this.ui.createElement(
					'div',
					{
						class: 'shortcut-link block relative rounded-xl bg-[var(--bg-2)] backdrop-blur p-3 h-24 ring-1 ring-inset ring-[var(--white-08)] shadow-[0_0_1px_var(--shadow-outer)] hover:ring-[var(--main-35a)] transition group cursor-pointer',
						component: 'shortcut-link',
						onclick: (e: Event) => {
							e.preventDefault();
							this.handleShortcutNavigation(shortcut.url);
						}
					},
					[
						this.ui.createElement(
							'div',
							{
								class: 'flex flex-col items-center justify-center h-full text-center'
							},
							[
								this.ui.createElement(
									'div',
									{
										class: 'w-8 h-8 mb-2 flex items-center justify-center'
									},
									[
										this.ui.createElement('img', {
											src:
												shortcut.favicon ||
												this.getFallbackFavicon(),
											alt: shortcut.title,
											class: 'w-8 h-8 object-contain',
											onerror: `this.src='${this.getFallbackFavicon()}'`
										})
									]
								),
								this.ui.createElement(
									'span',
									{
										class: 'text-xs text-[var(--text)] font-medium truncate w-full'
									},
									[shortcut.title]
								)
							]
						)
					]
				),
				this.ui.createElement(
					'button',
					{
						class: 'edit-shortcut-btn absolute -top-1 -right-1 w-6 h-6 bg-[var(--bg-1)] border border-[var(--white-20)] rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-[var(--white-10)]',
						title: 'Edit shortcut',
						component: 'edit-button',
						onclick: (e: Event) => {
							e.stopPropagation();
							this.openEditShortcutModal(shortcut.id);
						}
					},
					[
						this.ui.createElement('i', {
							'data-lucide': 'edit',
							class: 'h-3 w-3 text-[var(--text-secondary)]'
						})
					]
				)
			]
		);
	}

	private handleShortcutNavigation(url: string): void {
		try {
			const ALLOWED_SCHEMES = [
				'http:',
				'https:',
				'mailto:',
				'tel:',
				'ftp:',
				'ddx:'
			];

			let parsedUrl: URL;
			try {
				parsedUrl = new URL(url, window.location.origin);
			} catch {
				console.warn('Invalid URL format:', url);
				return;
			}

			if (parsedUrl.protocol === 'javascript:') {
				console.warn(
					'Blocked javascript: URL for security reasons. ' +
						'Executing arbitrary JavaScript from shortcuts is not allowed to prevent XSS attacks.'
				);
				return;
			}

			if (!ALLOWED_SCHEMES.includes(parsedUrl.protocol)) {
				console.warn(
					`Blocked URL with unsupported scheme: ${parsedUrl.protocol}. ` +
						`Allowed schemes: ${ALLOWED_SCHEMES.join(', ')}`
				);
				return;
			}

			if (window.parent.protocols) {
				window.parent.protocols.navigate(url);
			}
		} catch (error) {
			console.error('Failed to navigate:', error);
		}
	}

	private createEmptySlot(): HTMLElement {
		return this.ui.createElement(
			'div',
			{
				class: 'empty-slot relative group cursor-pointer',
				component: 'empty-slot',
				onclick: () => this.openAddShortcutModal()
			},
			[
				this.ui.createElement(
					'div',
					{
						class: 'block relative rounded-xl bg-[var(--bg-2)] border-2 border-dashed border-[var(--white-20)] backdrop-blur p-3 h-24 hover:border-[var(--main-35a)] transition group'
					},
					[
						this.ui.createElement(
							'div',
							{
								class: 'flex flex-col items-center justify-center h-full text-center'
							},
							[
								this.ui.createElement(
									'div',
									{
										class: 'w-8 h-8 mb-2 flex items-center justify-center'
									},
									[
										this.ui.createElement('i', {
											'data-lucide': 'plus',
											class: 'w-6 h-6 text-[var(--white-50)]'
										})
									]
								),
								this.ui.createElement(
									'span',
									{
										class: 'text-xs text-[var(--white-50)] font-medium'
									},
									['Add shortcut']
								)
							]
						)
					]
				)
			]
		);
	}

	private setupEventListeners() {
		const modal = this.ui.queryComponent('shortcut-modal');
		const form = this.ui.queryComponent('shortcut-form');
		const cancelBtn = this.ui.queryComponent('cancel-button');

		if (cancelBtn) {
			cancelBtn.addEventListener('click', () => this.closeModal());
		}

		if (modal) {
			modal.addEventListener('click', e => {
				if (e.target === modal) {
					this.closeModal();
				}
			});
		}

		if (form) {
			form.addEventListener('submit', e => this.handleSubmit(e));
		}

		this.setupNightPlusButton();

		document.addEventListener('keydown', e => {
			if (e.key === 'Escape' && this.isModalOpen()) {
				this.closeModal();
			}
		});

		setTimeout(() => this.checkLatency(), 1000);
	}

	private async setupNightPlusButton() {
		const nightPlusBtn =
			this.ui.queryComponent('signin-button') ||
			document.getElementById('nightPlusSignIn');

		if (!nightPlusBtn) {
			console.warn('Night+ button not found');
			return;
		}

		let nightLoginPromise: Promise<{ show: () => void } | null> | null =
			null;
		const ensureNightLogin = () => {
			if (nightLoginPromise) return nightLoginPromise;
			nightLoginPromise = (async () => {
				try {
					const [
						{ default: NightLogin },
						{ setAccessToken, dumpNightPlusData }
					] = await Promise.all([
						import('@nightnetwork/night-auth'),
						import('@apis/nightplus')
					]);

					let plusClient: any;
					try {
						const plusBasePath = resolvePath('plus');
						const fileName = 'index.mjs';
						const mod = await import(
							`${plusBasePath}/${fileName}`
						);
						const PlusClient = mod.default;
						plusClient = new PlusClient();
					} catch (error) {
						console.error(
							'Failed to load plus client module:',
							error
						);
						return null;
					}

					return new NightLogin({
						service: 'DayDreamX',
						theme: 'system',
						backdropBlur: '8px',
						API_URL: resolvePath('api/plus'),
						assetUrl: '',
						onSuccess: async () => {
							let token: string | null = null;
							try {
								token = localStorage.getItem('access_token');
							} catch {
								/* private mode / disabled */
							}
							if (!token) {
								console.error(
									'Night+ login fired onSuccess but no access_token found in localStorage'
								);
								return;
							}
							console.log('Night+ login successful!');
							try {
								await setAccessToken(token);
								const authUrl =
									await window.parent.proxy.getAuthUrl();
								await plusClient.authenticate(token, authUrl);
								await dumpNightPlusData();
							} catch (error) {
								console.error(
									'Error storing Night+ token:',
									error
								);
								alert(
									'Login successful, but failed to store token. Please try again.'
								);
							}
						},
						onCancel: () => {
							console.log('Login cancelled');
						}
					});
				} catch (error) {
					console.error(
						'Failed to load Night+ libraries:',
						error
					);
					return null;
				}
			})();
			return nightLoginPromise;
		};

		nightPlusBtn.addEventListener('click', async () => {
			const nightLogin = await ensureNightLogin();
			if (nightLogin) nightLogin.show();
		});

		console.log('Night+ button event listener attached');
	}

	private openEditShortcutModal(shortcutId: string) {
		const shortcut = this.shortcuts.find(s => s.id === shortcutId);
		if (!shortcut) return;

		this.currentEditingId = shortcutId;

		const titleInput = this.ui.queryComponent(
			'title-input'
		) as HTMLInputElement;
		const urlInput = this.ui.queryComponent(
			'url-input'
		) as HTMLInputElement;

		if (titleInput) titleInput.value = shortcut.title;
		if (urlInput) urlInput.value = shortcut.url;

		this.showModal();
	}

	private openAddShortcutModal() {
		this.currentEditingId = null;

		const titleInput = this.ui.queryComponent(
			'title-input'
		) as HTMLInputElement;
		const urlInput = this.ui.queryComponent(
			'url-input'
		) as HTMLInputElement;

		if (titleInput) titleInput.value = '';
		if (urlInput) urlInput.value = '';

		this.showModal();
	}

	private showModal() {
		const modal = this.ui.queryComponent('shortcut-modal');
		if (modal) {
			modal.classList.remove('hidden');
			modal.classList.add('flex');

			const titleInput = this.ui.queryComponent(
				'title-input'
			) as HTMLInputElement;
			if (titleInput) {
				setTimeout(() => titleInput.focus(), 100);
			}
		}
	}

	private closeModal() {
		const modal = this.ui.queryComponent('shortcut-modal');
		if (modal) {
			modal.classList.add('hidden');
			modal.classList.remove('flex');
		}
		this.currentEditingId = null;
	}

	private isModalOpen(): boolean {
		const modal = this.ui.queryComponent('shortcut-modal');
		return modal ? !modal.classList.contains('hidden') : false;
	}

	private async handleSubmit(e: Event) {
		e.preventDefault();

		const titleInput = this.ui.queryComponent(
			'title-input'
		) as HTMLInputElement;
		const urlInput = this.ui.queryComponent(
			'url-input'
		) as HTMLInputElement;

		if (!titleInput || !urlInput) return;

		const title = titleInput.value.trim();
		const url = urlInput.value.trim();

		if (!title || !url) return;

		try {
			if (this.currentEditingId) {
				await this.bookmarkManager.updateBookmark(
					this.currentEditingId,
					{
						title,
						url
					}
				);

				await this.loadShortcuts();
				this.refreshShortcuts();
			} else {
				if (this.shortcuts.length >= 12) {
					alert('Maximum of 12 shortcuts allowed');
					return;
				}

				const shortcutsFolderId =
					await this.getOrCreateShortcutsFolder();
				await this.bookmarkManager.createBookmark({
					title,
					url,
					parentId: shortcutsFolderId
				});

				await this.loadShortcuts();
				this.refreshShortcuts();
			}

			this.closeModal();
		} catch (error) {
			console.error('Failed to save shortcut:', error);
			alert('Failed to save shortcut. Please try again.');
		}
	}

	private async refreshShortcuts() {
		const showShortcuts = await window.parent.settings?.getItem(
			'newtabShowShortcuts'
		);
		if (showShortcuts === 'false') {
			return;
		}

		const section = this.ui.queryComponent('shortcuts-section');
		if (!section) return;

		section.innerHTML = '';

		this.shortcuts.forEach(shortcut => {
			const shortcutElement = this.createShortcutElement(shortcut);
			section.appendChild(shortcutElement);
		});

		const remaining = 12 - this.shortcuts.length;
		for (let i = 0; i < remaining; i++) {
			const emptySlot = this.createEmptySlot();
			section.appendChild(emptySlot);
		}

		setTimeout(() => createIcons({ icons }), 0);
	}

	public async refresh() {
		await this.bookmarkManager.loadFromStorage();
		await this.loadShortcuts();
		this.refreshShortcuts();
	}
}

document.addEventListener('DOMContentLoaded', () => {
	createIcons({ icons });
	const shortcutsManager = new NewTabShortcuts();
	(window as any).shortcutsManager = shortcutsManager;
});
