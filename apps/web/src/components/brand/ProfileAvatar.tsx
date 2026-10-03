import { useId } from "react";
import { cn } from "@/lib/utils";
import type { ProfileId } from "@/services/api/profiles";

/**
 * The two account mascots, drawn as original flat vector art on a 120x120 canvas.
 *
 * The illustrations are the one place raw colors are allowed: they are artwork, not interface
 * chrome, so they look the same in every theme. Gold is a distinct yellow, never the amber the
 * UI reserves for near-deadline. The art is decorative (the account name is always printed
 * beside it), so it is `aria-hidden`.
 */
type Props = { profile: ProfileId; className?: string };

function Hamster() {
  return (
    <>
      <circle cx="60" cy="60" r="60" fill="#dde5ff" />
      <circle cx="98" cy="22" r="24" fill="#c9d6ff" />
      <g transform="translate(6 7) scale(0.9)">
        <path d="M26 124 C26 100 42 92 60 92 C78 92 94 100 94 124Z" fill="#5b5bd6" />
        <path d="M44 94 Q60 104 76 94 L73 89 Q60 96 47 89Z" fill="#aebbd3" />
        <circle cx="27" cy="50" r="11" fill="#e9b27c" />
        <circle cx="27" cy="50" r="6" fill="#f3a6a6" />
        <circle cx="93" cy="50" r="11" fill="#e9b27c" />
        <circle cx="93" cy="50" r="6" fill="#f3a6a6" />
        <ellipse cx="60" cy="72" rx="37" ry="30" fill="#f0bc86" />
        <ellipse cx="36" cy="82" rx="11" ry="9" fill="#fbe6cc" />
        <ellipse cx="84" cy="82" rx="11" ry="9" fill="#fbe6cc" />
        <ellipse cx="60" cy="83" rx="17" ry="12" fill="#fbe6cc" />
        <circle cx="37" cy="80" r="4" fill="#f3a6a6" opacity=".6" />
        <circle cx="83" cy="80" r="4" fill="#f3a6a6" opacity=".6" />
        <circle cx="46" cy="70" r="4.5" fill="#2b2540" />
        <circle cx="74" cy="70" r="4.5" fill="#2b2540" />
        <circle cx="47.6" cy="68.4" r="1.5" fill="#fff" />
        <circle cx="75.6" cy="68.4" r="1.5" fill="#fff" />
        <ellipse cx="60" cy="78" rx="4" ry="3" fill="#e58a8a" />
        <path
          d="M60 81 V84 M60 84 Q55 89 51 85 M60 84 Q65 89 69 85"
          stroke="#7a4a2b"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="57.5" y="84" width="5" height="5" rx="1.2" fill="#fff" />
        <g data-part="helmet">
          <path d="M60 22 C58 8 74 2 90 8 C81 10 77 17 72 26Z" fill="#2bb6a8" />
          <path d="M24 62 C22 32 40 20 60 20 C80 20 98 32 96 62Z" fill="#b7c3da" />
          <path d="M60 20 C80 20 98 32 96 56 H60Z" fill="#9aa9c6" opacity=".55" />
          <rect x="57" y="20" width="6" height="36" rx="3" fill="#8e9dbb" />
          <circle cx="60" cy="20" r="5" fill="#8e9dbb" />
          <rect x="21" y="53" width="78" height="9" rx="4.5" fill="#8e9dbb" />
          <path
            d="M34 36 Q40 27 50 24"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            opacity=".6"
          />
        </g>
        <g data-part="shield">
          <path
            d="M8 84 H42 V100 C42 110 25 120 25 120 C25 120 8 110 8 100Z"
            fill="#5b5bd6"
            stroke="#8e9dbb"
            strokeWidth="3"
          />
          <path d="M25 88 V113 M12 98 H38" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="42" cy="98" r="5" fill="#f0bc86" />
        </g>
        <g data-part="sword" transform="rotate(22 98 92)">
          <path
            d="M98 50 L101.5 56 V92 H94.5 V56Z"
            fill="#e4eaf5"
            stroke="#8e9dbb"
            strokeWidth="1.2"
          />
          <rect x="88" y="92" width="20" height="4.5" rx="2.2" fill="#5b5bd6" />
          <rect x="95.5" y="96" width="5" height="10" rx="2.5" fill="#7a4a2b" />
          <circle cx="98" cy="108" r="3.2" fill="#5b5bd6" />
          <circle cx="98" cy="99" r="5" fill="#f0bc86" />
        </g>
      </g>
    </>
  );
}

function Frog() {
  return (
    <>
      <circle cx="60" cy="60" r="60" fill="#f9ddf0" />
      <circle cx="22" cy="26" r="22" fill="#f3c9e6" />
      <g transform="translate(6 8) scale(0.9)">
        <ellipse cx="60" cy="118" rx="38" ry="22" fill="#58bf5e" />
        <path d="M28 124 C30 102 44 96 60 96 C76 96 90 102 92 124Z" fill="#e86bae" />
        <path
          d="M40 99 Q50 108 60 99 Q70 108 80 99"
          stroke="#fff"
          strokeWidth="4.5"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="60" cy="74" rx="40" ry="29" fill="#6ccb6a" />
        <ellipse cx="60" cy="88" rx="28" ry="13" fill="#58bf5e" opacity=".3" />
        <circle cx="36" cy="50" r="15" fill="#6ccb6a" />
        <circle cx="84" cy="50" r="15" fill="#6ccb6a" />
        <circle cx="36" cy="50" r="10.5" fill="#fff" />
        <circle cx="84" cy="50" r="10.5" fill="#fff" />
        <circle cx="38" cy="51" r="5.5" fill="#2b2540" />
        <circle cx="82" cy="51" r="5.5" fill="#2b2540" />
        <circle cx="40" cy="48.6" r="1.9" fill="#fff" />
        <circle cx="84" cy="48.6" r="1.9" fill="#fff" />
        <ellipse cx="29" cy="84" rx="7" ry="4.5" fill="#f58fb8" opacity=".7" />
        <ellipse cx="91" cy="84" rx="7" ry="4.5" fill="#f58fb8" opacity=".7" />
        <circle cx="54" cy="68" r="1.4" fill="#3e9a48" />
        <circle cx="66" cy="68" r="1.4" fill="#3e9a48" />
        <path
          d="M38 80 Q60 99 82 80"
          stroke="#2f7d3a"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <g data-part="crown" transform="rotate(-6 60 36)">
          <path
            d="M40 36 L44 14 L54 26 L60 10 L66 26 L76 14 L80 36 Q60 42 40 36Z"
            fill="#f6c945"
            stroke="#d9a21b"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M40 36 Q60 42 80 36 V40 Q60 46 40 40Z" fill="#e0a91e" />
          <circle cx="44" cy="14" r="2.6" fill="#fff3c4" />
          <circle cx="60" cy="10" r="2.6" fill="#fff3c4" />
          <circle cx="76" cy="14" r="2.6" fill="#fff3c4" />
          <circle cx="60" cy="29" r="3.4" fill="#e8508f" />
          <circle cx="49" cy="32" r="2.2" fill="#4f8bff" />
          <circle cx="71" cy="32" r="2.2" fill="#4f8bff" />
        </g>
      </g>
    </>
  );
}

export function ProfileAvatar({ profile, className }: Props) {
  // useId output contains colons, which are legal in an id but awkward inside url(#...).
  const clipId = `avatar-${useId().replace(/:/g, "")}`;
  const frog = profile === "ech_princess";
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      data-mascot={frog ? "frog" : "hamster"}
      className={cn("shrink-0", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{frog ? <Frog /> : <Hamster />}</g>
    </svg>
  );
}
