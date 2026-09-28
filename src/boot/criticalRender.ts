import varsCSS from '@css/vars.scss?inline';
import importsCSS from '@css/imports.scss?inline';
import tailwindCSS from '@css/tailwind.css?inline';
import globalCSS from '@css/global.scss?inline';
import { patchDocument } from '../utils/document';
import { Render } from '@browser/render';

export function criticalRender(container: HTMLDivElement): {
  shadowRoot: ShadowRoot;
  root: HTMLDivElement;
} {
  // Closed shadow root in production — external content scripts and page
  // code can't reach the shell subtree via `container.shadowRoot` (returns
  // null) or via `document.body.textContent` scrapes. In dev we use `open`
  // so Playwright / DevTools can pierce the tree for interactive debugging;
  // `patchDocument` redirects `document.querySelector`/`getElementById`
  // regardless of mode, so shell code is unaffected either way.
  const shadowMode = import.meta.env.DEV ? 'open' : 'closed';
  const shadowRoot = container.attachShadow({ mode: shadowMode });

  shadowRoot.append(
    Object.assign(document.createElement('style'), {
      textContent: varsCSS + importsCSS + tailwindCSS + globalCSS,
    }),
    Object.assign(document.createElement('div'), {
      id: 'root',
      style: 'width: 100%; height: 100%; position: fixed; inset: 0;',
    }),
  );

  const shadowDocument = document.implementation.createHTMLDocument('');
  patchDocument(shadowRoot, shadowDocument);

  // Expose the shadow root to shell-scope code (existing consumers use
  // `window.d.querySelector(...)` for shadow-scoped DOM access), but as a
  // non-enumerable, non-configurable property so `Object.keys(window)`
  // doesn't advertise a ShadowRoot handle.
  Object.defineProperty(window, 'd', {
    value: shadowRoot,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  const root = shadowRoot.getElementById('root') as HTMLDivElement;
  new Render(root);

  return { shadowRoot, root };
}
