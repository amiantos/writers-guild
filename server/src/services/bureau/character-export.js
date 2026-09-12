/**
 * Character Export
 *
 * Builds the library card for a cast member who has developed in a Bureau (see
 * "Character development" in docs/bureau-design.md): a copy of their seed card
 * with accepted arc notes added to its description. The seed card is copied,
 * never changed, and the export is saved as a new library character.
 */

/**
 * @param {Object} member - A cast member with its seed card.
 * @param {Array<{content: string}>} acceptedNotes - Oldest first.
 * @param {Object} options
 * @param {string} options.bureauName
 * @param {Date} [options.exportedAt]
 * @returns {Object} A V2 character card.
 */
export function exportedCard(member, acceptedNotes, { bureauName, exportedAt = new Date() }) {
  const card = structuredClone(member.seedCard ?? {});
  card.spec ??= 'chara_card_v2';
  card.spec_version ??= '2.0';
  card.data ??= {};
  const { data } = card;
  data.name ||= member.name;

  if (acceptedNotes.length > 0) {
    const changes = acceptedNotes.map((note) => `- ${note.content}`).join('\n');
    data.description = [data.description?.trim(), `How ${data.name} has changed:\n${changes}`]
      .filter(Boolean)
      .join('\n\n');
  }

  const exportNote = `Exported from the Bureau "${bureauName}" on ${exportedAt.toISOString().slice(0, 10)}.`;
  data.creator_notes = [data.creator_notes?.trim(), exportNote].filter(Boolean).join('\n\n');
  data.tags = [...new Set([...(Array.isArray(data.tags) ? data.tags : []), 'bureau'])];
  return card;
}
