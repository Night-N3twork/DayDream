import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

it("seeds Daydream's default list with the requested services and 12-item cap", () => {
  const source = readFileSync(`${process.cwd()}/src/pages/newtab/index.tsx`, "utf8");
  const defaults = source.match(/private defaultShortcuts:[^{]*\[([\s\S]*?)\n\t\];/)?.[1] ?? "";
  const actual = [...defaults.matchAll(/title: '([^']+)', url: 'https:\/\/([^']+)'/g)].map(
    ([, title, hostname]) => [title, hostname],
  );
  expect(actual).toEqual([
    ["Google", "google.com"],
    ["YouTube", "youtube.com"],
    ["Twitter", "twitter.com"],
    ["Wikipedia", "wikipedia.org"],
    ["Stack Overflow", "stackoverflow.com"],
    ["Discord", "discord.com"],
    ["Netflix", "netflix.com"],
    ["Amazon", "amazon.com"],
    ["Spotify", "spotify.com"],
    ["Twitch", "twitch.tv"],
    ["Instagram", "instagram.com"],
    ["TikTok", "tiktok.com"],
  ]);
});
