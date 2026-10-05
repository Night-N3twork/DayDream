import { afterEach, expect, it, vi } from 'vitest';
import { ExtensionBridgeChannel } from './channel';
import { dispatchOnMessage } from '../host/runtime/dispatch';

let channels: ExtensionBridgeChannel[] = [];
afterEach(() => {
  for (const channel of channels) channel.close();
  channels = [];
  vi.useRealTimers();
});

it('round-trips an asynchronous runtime message over the real MessageChannel ports', async () => {
  const ports = new MessageChannel();
  const popup = new ExtensionBridgeChannel(ports.port1);
  const background = new ExtensionBridgeChannel(ports.port2);
  channels = [popup, background];
  background.registerEventHandler('chrome.runtime.onMessage', async ([message, sender]) => {
    const result = await dispatchOnMessage([
      (received, source, sendResponse) => {
        expect(received).toEqual(message);
        expect(source).toEqual(sender);
        setTimeout(() => sendResponse({ ok: true }), 0);
        return true;
      },
    ], message, sender, 100);
    return result.response;
  });
  await expect(popup.requestEvent('chrome.runtime.onMessage', [
    { type: 'popup-ready' }, { id: 'sample-extension' },
  ], { timeoutMs: 1000 })).resolves.toEqual({ ok: true });
});

it('routes a named runtime port message and response back to the popup channel', async () => {
  const ports = new MessageChannel();
  const popup = new ExtensionBridgeChannel(ports.port1);
  const background = new ExtensionBridgeChannel(ports.port2);
  channels = [popup, background];
  let received: unknown;
  popup.setEventHandler((method, args) => {
    if (method === 'chrome.runtime.port-msg-bg-to-cs') received = args[0];
  });
  background.sendEvent('chrome.runtime.port-msg-bg-to-cs', [{ portId: 7, message: { title: 'Popup data' } }]);
  await vi.waitFor(() => expect(received).toEqual({ portId: 7, message: { title: 'Popup data' } }));
});
