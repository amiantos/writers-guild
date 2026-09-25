/**
 * Chat Reply Splitting
 *
 * How a chat reply becomes text messages, shared so the server saves a reply and the client
 * previews one being written by the same rules.
 */

export const MESSAGE_SEPARATOR = '---';
export const MAX_REPLY_MESSAGES = 6;

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/m;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a reply into messages at separator lines. A leading "Name:" label the model adds is
 * dropped, and the reply is cut where the model starts writing someone else's messages.
 * Extra messages past the limit join the last one.
 *
 * @param {string} text
 * @param {string} [name] - The sender's name.
 * @param {string[]} [otherNames] - Everyone else in the chat.
 * @returns {string[]}
 */
export function splitReply(text, name = '', otherNames = []) {
  const variantsOf = (names) => names.flatMap((n) => [n, n.split(/\s+/)[0]]).filter(Boolean);
  const labelSource = (variants) =>
    variants.length > 0
      ? `[ \\t]*(?:${variants.map(escapeRegExp).join('|')})[ \\t]*:[ \\t]*`
      : null;
  // A name the sender shares, like another Layla's first name, is the sender's own label.
  const ownVariants = [...new Set(variantsOf([name]))];
  const ownKeys = new Set(ownVariants.map((variant) => variant.toLowerCase()));
  const otherVariants = [...new Set(variantsOf(otherNames))].filter(
    (variant) => !ownKeys.has(variant.toLowerCase()),
  );
  const own = labelSource(ownVariants);
  const others = labelSource(otherVariants);

  let body = text.replace(/\*/g, '');
  if (others) {
    // Someone else's lines at the start are the model echoing the conversation, and are
    // skipped; once the reply has begun, someone else's label ends it.
    const otherLabel = new RegExp(`^${others}`, 'i');
    const lines = body.split('\n');
    const start = lines.findIndex((line) => line.trim() && !otherLabel.test(line));
    if (start === -1) return [];
    const cut = lines.findIndex((line, index) => index > start && otherLabel.test(line));
    body = lines.slice(start, cut === -1 ? undefined : cut).join('\n');
  }

  // A line starting with the sender's own label starts another message, as a separator would.
  const ownLabel = own ? new RegExp(`^${own}`, 'i') : null;
  const ownLabelLine = own ? new RegExp(`\\n(?=${own})`, 'i') : null;
  const parts = body
    .split(SEPARATOR_LINE)
    .flatMap((part) => (ownLabelLine ? part.split(ownLabelLine) : [part]))
    .map((part) => (ownLabel ? part.trim().replace(ownLabel, '') : part).trim())
    .filter(Boolean);
  if (parts.length <= MAX_REPLY_MESSAGES) return parts;
  return [
    ...parts.slice(0, MAX_REPLY_MESSAGES - 1),
    parts.slice(MAX_REPLY_MESSAGES - 1).join('\n\n'),
  ];
}
