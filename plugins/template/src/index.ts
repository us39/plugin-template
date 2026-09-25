import { findByProps } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";

const { FormSection, FormSwitchRow, FormRow } = Forms;

// emojicdn.elk.sh renders a requested unicode emoji in a chosen platform's
// style and serves it back as an image - no API key required.
// (https://github.com/lyqht/emojicdn)
const CDN_BASE = "https://emojicdn.elk.sh";
const STYLES = ["apple", "twitter", "google", "facebook", "samsung"];
const DEFAULT_STYLE = "apple";

// Discord's client requests unicode emoji art from a twemoji-style CDN whose
// filename is the emoji's Unicode codepoint sequence, e.g.:
//   .../svg/1f600.svg                 -> 😀
//   .../png/1f469-200d-1f4bb.png      -> 👩‍💻 (ZWJ sequence)
// This pulls that codepoint sequence back out of the request URL so it can
// be converted back into the literal emoji character.
const TWEMOJI_FILENAME = /\/([0-9a-fA-F]{2,8}(?:-[0-9a-fA-F]{2,8})*)\.(?:png|svg)(?:\?.*)?$/;

// Only ever touch Discord's own emoji-asset hosts - never rewrite arbitrary
// image URLs (avatars, attachments, stickers, etc).
const DISCORD_EMOJI_HOST = /(^|\.)(discordapp\.(com|net)|discord\.com)$/;

function codepointsToEmoji(codepoints: string): string {
  return codepoints
    .split("-")
    .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
    .join("");
}

function getReplacementURL(originalUri: string): string | null {
  if (storage.enabled === false) return null;

  let host: string;
  try {
    host = new URL(originalUri).hostname;
  } catch {
    return null;
  }
  if (!DISCORD_EMOJI_HOST.test(host)) return null;

  const match = originalUri.match(TWEMOJI_FILENAME);
  if (!match) return null;

  try {
    const emoji = codepointsToEmoji(match[1]);
    const style = storage.style ?? DEFAULT_STYLE;
    return `${CDN_BASE}/${encodeURIComponent(emoji)}?style=${style}`;
  } catch {
    // Malformed/unsupported codepoint sequence - leave the original alone.
    return null;
  }
}

let unpatch: (() => void) | undefined;

export const onLoad = () => {
  storage.enabled ??= true;
  storage.style ??= DEFAULT_STYLE;

  // Image is a class component in React Native; patching its render lets us
  // rewrite props.source.uri right before anything hits the network/cache.
  const { Image } = findByProps("Image", "Text", "View") ?? ReactNative;

  unpatch = before("render", Image.prototype, ([], self: any) => {
    const source = self?.props?.source;
    const uri = source?.uri;
    if (!uri || typeof uri !== "string") return;

    const replaced = getReplacementURL(uri);
    if (replaced) {
      self.props = {
        ...self.props,
        source: { ...source, uri: replaced },
      };
    }
  });
};

export const onUnload = () => {
  unpatch?.();
};

export const settings = () => (
  <FormSection title="Apple Emojis">
    <FormSwitchRow
      label="Enabled"
      subLabel="Turn off to restore Discord's default Twemoji"
      value={storage.enabled ?? true}
      onValueChange={(value: boolean) => {
        storage.enabled = value;
      }}
    />
    <FormRow
      label="Emoji style"
      subLabel={`Currently: ${storage.style ?? DEFAULT_STYLE} - tap to cycle`}
      onPress={() => {
        const i = STYLES.indexOf(storage.style ?? DEFAULT_STYLE);
        storage.style = STYLES[(i + 1) % STYLES.length];
      }}
    />
  </FormSection>
);
