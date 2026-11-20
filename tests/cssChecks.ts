import assert from "node:assert/strict";

const comments = /\/\*[\s\S]*?\*\//g;

/** The block has no motion: no keyframes or animation (or whatever `forbid` names). */
export const noMotion = (css: string, forbid = /@keyframes|animation/) => assert.doesNotMatch(css.replace(comments, ""), forbid);

/** The block uses tokens only: no hex, oklch, rgb or hsl colour literals. */
export const noHexColour = (css: string) => assert.doesNotMatch(css.replace(comments, ""), /#[0-9a-f]{3,8}\b|oklch\(|rgb\(|hsl\(/i);
