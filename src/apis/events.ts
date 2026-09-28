import { postEventToIframe } from "./eventsBridge";
import { trackEvent } from "./beacon";

class EventSystem {
  eventListeners: any;
  channel: any;
  senderId: string;

  constructor() {
    this.eventListeners = {};
    this.channel = new BroadcastChannel("global-events");
    this.senderId = `event-sender-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    window.addEventListener("message", this.handleMessage.bind(this));
    this.channel.addEventListener("message", this.handleBroadcast.bind(this));
  }

  emit(eventName: string, data: any) {
    this.dispatchEvent(eventName, data);

    const message = {
      eventName,
      data,
      __senderId: this.senderId,
    };

    const controller = (window as any).proxy?.controller ?? null;
    const iframes = document.querySelectorAll("iframe");
    iframes.forEach((iframe) => {
      postEventToIframe(iframe as HTMLIFrameElement, message, controller);
    });

    if (window.parent && window !== window.parent) {
      try {
        window.parent.postMessage(message, "*");
      } catch (error) {
        console.warn(
          "[EventSystem] postMessage to window.parent failed:",
          error,
        );
      }
    }

    this.channel.postMessage(message);

    try {
      trackEvent(eventName, {
        event_category: "app_events",
        event_label: eventName,
        value: typeof data === "object" ? JSON.stringify(data) : data,
      });
    } catch {
      /* telemetry must never break app */
    }
  }

  handleMessage(event: any) {
    const { eventName, data, __senderId } = event.data || {};

    if (__senderId && __senderId === this.senderId) {
      return;
    }

    if (eventName) {
      this.dispatchEvent(eventName, data);
    }
  }

  handleBroadcast(event: any) {
    const { eventName, data, __senderId } = event.data || {};

    if (__senderId && __senderId === this.senderId) {
      return;
    }

    if (eventName) {
      this.dispatchEvent(eventName, data);
    }
  }

  addEventListener(
    eventName: string,
    callback: EventListenerOrEventListenerObject,
  ) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(callback);
    document.addEventListener(eventName, callback);
  }

  removeEventListener(
    eventName: string,
    callback: EventListenerOrEventListenerObject,
  ) {
    if (this.eventListeners[eventName]) {
      this.eventListeners[eventName] = this.eventListeners[eventName].filter(
        (cb: any) => cb !== callback,
      );
      document.removeEventListener(eventName, callback);
    }
  }

  dispatchEvent(eventName: string, data: any) {
    if (this.eventListeners[eventName]) {
      this.eventListeners[eventName].forEach((callback: Function) =>
        callback(data),
      );
    }

    document.dispatchEvent(new CustomEvent(eventName, { detail: data || {} }));
  }
}

export { EventSystem };
