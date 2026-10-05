export function patchDocument(root: ShadowRoot, doc: Document): void {
	const originalDocumentOpen = document.open.bind(document);
	const originalDocumentWrite = document.write.bind(document);
	const originalDocumentWriteln = document.writeln.bind(document);
	const originalDocumentClose = document.close.bind(document);
	const originalDocumentQuerySelector = document.querySelector.bind(document);
	const originalDocumentQuerySelectorAll =
		document.querySelectorAll.bind(document);
	const originalDocumentGetElementById =
		document.getElementById.bind(document);
	Object.defineProperty(document, 'open', {
		value: (...args: Parameters<typeof document.open>) => {
			if (doc) {
				return doc;
			}
			return originalDocumentOpen(...args);
		},
		writable: true,
		configurable: true
	});

	// Keep SVG writes on the outer document.
	if (
		document.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg'
	) {
		Object.defineProperty(document, 'write', {
			value: (text: string) => {
				if (root) {
					const temp = document.createElement('div');
					temp.innerHTML = text;
					while (temp.firstChild) {
						root.appendChild(temp.firstChild);
					}
					return;
				}
				return originalDocumentWrite(text);
			},
			writable: true,
			configurable: true
		});

		Object.defineProperty(document, 'writeln', {
			value: (text: string) => {
				if (root) {
					const temp = document.createElement('div');
					temp.innerHTML = text + '\n';
					while (temp.firstChild) {
						root.appendChild(temp.firstChild);
					}
					return;
				}
				return originalDocumentWriteln(text);
			},
			writable: true,
			configurable: true
		});
	}

	Object.defineProperty(document, 'close', {
		value: () => {
			if (root) {
				return;
			}
			return originalDocumentClose();
		},
		writable: true,
		configurable: true
	});
	Object.defineProperty(document, 'querySelector', {
		value: (selector: string) => {
			if (root) {
				return root.querySelector(selector);
			}
			return originalDocumentQuerySelector(selector);
		},
		writable: true,
		configurable: true
	});
	Object.defineProperty(document, 'querySelectorAll', {
		value: (selector: string) => {
			if (root) {
				return root.querySelectorAll(selector);
			}
			return originalDocumentQuerySelectorAll(selector);
		},
		writable: true,
		configurable: true
	});
	Object.defineProperty(document, 'getElementById', {
		value: (id: string) => {
			if (root) {
				return root.getElementById(id);
			}
			return originalDocumentGetElementById(id);
		},
		writable: true,
		configurable: true
	});
}
