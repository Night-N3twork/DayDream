const TAG = '[terbium/mediaIsland]';

interface MediaMetadata {
  title: string;
  artist?: string;
  artwork?: string;
}

function metadataFor(doc: Document): MediaMetadata {
  const youtubeTitle = doc.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim();
  if (youtubeTitle) {
    return {
      title: youtubeTitle,
      artist: doc.querySelector('#channel-name a')?.textContent?.trim(),
      artwork: doc.querySelector('link[rel="image_src"]')?.getAttribute('href') || undefined,
    };
  }

  return {
    title: doc.title || doc.URL || 'Unknown',
    artist: doc.querySelector('meta[name="author"]')?.getAttribute('content') || undefined,
    artwork: doc.querySelector('link[rel="icon"]')?.getAttribute('href') || undefined,
  };
}

export class MediaIslandMonitor {
  private currentFrame: HTMLIFrameElement | null = null;

  constructor(private readonly tb: any) {}

  monitorFrame = (iframe: HTMLIFrameElement): void => {
    const sync = (): void => this.syncFrame(iframe);
    iframe.addEventListener('load', sync);
    sync();
  };

  cleanupFrame = (iframe: HTMLIFrameElement): void => {
    if (this.currentFrame === iframe) this.cleanup();
  };

  cleanup = (): void => {
    this.currentFrame = null;
    try { this.tb.mediaplayer.hide?.(); } catch {}
  };

  private syncFrame(iframe: HTMLIFrameElement): void {
    const doc = iframe.contentDocument;
    const media = doc?.querySelector('audio, video') as HTMLMediaElement | null;
    if (!doc || !media) return;

    this.currentFrame = iframe;
    const metadata = metadataFor(doc);
    const config = {
      ...(media.tagName === 'VIDEO'
        ? { video_name: metadata.title, creator: metadata.artist || 'Unknown' }
        : { track_name: metadata.title, artist: metadata.artist || 'Unknown' }),
      background: metadata.artwork || '',
      time: media.currentTime,
      endtime: Number.isFinite(media.duration) ? media.duration : 0,
      onPausePlay: () => {
        if (media.paused) void media.play().catch(() => {});
        else media.pause();
      },
      onSeek: (time: number) => { media.currentTime = time; },
    };

    if (media.tagName === 'VIDEO') this.tb.mediaplayer.video?.(config);
    else this.tb.mediaplayer.music?.(config);
  }
}

export function installMediaIsland(tb: any): void {
  if (!tb?.mediaplayer) {
    console.warn(TAG, 'tb.mediaplayer not available — skipping install');
    return;
  }

  (globalThis as any).__ddxMediaMonitor = new MediaIslandMonitor(tb);
  console.log(TAG, 'media island integration installed');
}
