/**
 * KURO — contact / vCard helper.
 *
 * WhatsApp contact messages ride on `contactMessage`, which carries a vCard as
 * plain text (verified in the library: `sock.sendMessage(jid, { contacts: … })`
 * builds one through `Utils/messages.js` — one contact becomes `contactMessage`,
 * several become `contactsArrayMessage`; the proto fields are
 * `displayName` + `vcard`).
 *
 * Owner data always comes from `settings.js` — nothing here is hardcoded.
 */

/** Escape per RFC 6350: backslash, comma and semicolon inside values. */
export const escapeVCardValue = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;')

/**
 * Build a vCard 3.0 text block for one contact.
 *
 * @param {object} options
 * @param {string} options.name    Display name (FN / N).
 * @param {string} options.number  Phone number, digits or `+…` — international format.
 * @param {string} [options.organisation] Optional ORG line.
 * @returns {string}
 */
export const buildVCard = ({ name, number, organisation = '' } = {}) => {
  const displayName = String(name ?? '').trim() || 'Contact'
  const digits = String(number ?? '').replace(/[^\d+]/g, '')
  const tel = digits.startsWith('+') ? digits : `+${digits}`

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCardValue(displayName)}`,
    `N:${escapeVCardValue(displayName)};;;;`,
    `TEL;TYPE=CELL:${tel}`,
    ...(organisation ? [`ORG:${escapeVCardValue(organisation)}`] : []),
    'END:VCARD'
  ]
  return lines.join('\n')
}

/**
 * Send one contact as a vCard. `sendContact()` routes through the ordinary
 * send path, so a `@newsletter` destination works the same way.
 *
 * @param {object} sock
 * @param {string} jid
 * @param {object} options
 * @param {string} options.name     Display name shown above the card.
 * @param {string} options.number   Phone number.
 * @param {string} [options.organisation]
 * @param {object} [options.quoted] Message to quote.
 * @returns {Promise<object>} the sent WAMessage
 */
export const sendContact = async (sock, jid, { name, number, organisation = '', quoted = undefined } = {}) => {
  const displayName = String(name ?? '').trim() || 'Contact'
  const vcard = buildVCard({ name: displayName, number, organisation })

  return sock.sendMessage(jid, { contacts: { displayName, contacts: [{ displayName, vcard }] } }, { quoted })
}

/**
 * Send the owner card. Data must come from the central config:
 *
 *   await sendOwnerContact(sock, jid, config, { quoted: m })
 *
 * @param {object} sock
 * @param {string} jid
 * @param {object} config       Central KURO config (`ownerName`, `owner[]`)
 * @param {object} [options]    `{ quoted, organisation }`
 * @returns {Promise<object>} the sent message, or `null` with no owner configured
 */
export const sendOwnerContact = async (sock, jid, config, { quoted = undefined, organisation = '' } = {}) => {
  const name = config?.ownerName ?? 'Owner'
  const number = (config?.owner ?? [])[0]
  if (!number) throw new Error('No owner number is configured — set the owner array in settings.js.')

  return sendContact(sock, jid, { name, number, organisation, quoted })
}

export default { buildVCard, sendContact, sendOwnerContact, escapeVCardValue }
