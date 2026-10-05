/**
 * KURO — permissions.
 *
 * Every privileged decision is computed here, from the JIDs WhatsApp actually
 * delivered and from configuration. Nothing is read out of the message text, so
 * a user cannot type their way into owner access:
 *
 *   ✗  if (text.includes('owner')) grant()
 *   ✓  compare the sender's PN against config.owner, or resolve LID → PN
 *
 * A LID never becomes a phone number by string manipulation. If no mapping is
 * known, the answer is "not the owner" — fail closed.
 */

import { isLidUser, isPnUser } from '@rexxhayanasi/elaina-baileys'
import { digitsOf, resolvePN } from '../lib/lid.js'

/** Owner numbers as a `Set` of digit strings. */
export const ownerNumberSet = config => new Set((config?.owner ?? []).map(digitsOf).filter(Boolean))

/** Compare any address form against a set of owner phone numbers. */
const matchesOwnerNumber = (jidOrNumber, numbers) => {
  if (!jidOrNumber || numbers.size === 0) return false
  const digits = digitsOf(jidOrNumber)
  return Boolean(digits) && numbers.has(digits)
}

/**
 * Is this sender an owner?
 *
 * @param {object} options
 * @param {object} options.sock     Live socket, used for LID → PN resolution
 * @param {object} options.config
 * @param {object} [options.db]
 * @param {object} options.message  The serialized message (`m`)
 * @returns {Promise<boolean>}
 */
export const checkOwner = async ({ sock, config, db = null, message }) => {
  const numbers = ownerNumberSet(config)
  if (numbers.size === 0) return false

  // 1. Whatever phone-number form WhatsApp gave us for this sender.
  if (matchesOwnerNumber(message?.senderPn, numbers)) return true
  if (matchesOwnerNumber(message?.senderNumber, numbers)) return true
  if (isPnUser(message?.sender) && matchesOwnerNumber(message.sender, numbers)) return true

  // 2. A LID sender: resolve through the mapping store, never arithmetically.
  const lid = message?.senderLid ?? (isLidUser(message?.sender) ? message.sender : null)
  if (lid) {
    const pn = await resolvePN(sock, lid, { db })
    if (matchesOwnerNumber(pn, numbers)) return true

    // 3. A previously recorded owner flag for this LID.
    const row = db?.getUser(lid)
    if (row?.isOwner) return true
  }

  // 4. A previously recorded owner flag keyed by the sender JID itself.
  const stored = db?.getUser(message?.sender)
  return Boolean(stored?.isOwner)
}

/** Is the sender banned? */
export const checkBanned = ({ db, message }) => {
  if (!db || !message) return false
  const row =
    db.getUser(message.sender) ||
    (message.senderLid ? db.getUser(message.senderLid) : null) ||
    (message.senderPn ? db.getUser(message.senderPn) : null)
  return Boolean(row?.isBanned)
}

/** Is the sender premium? */
export const checkPremium = ({ db, message }) => {
  if (!db || !message) return false
  const row = db.getUser(message.sender) || (message.senderLid ? db.getUser(message.senderLid) : null)
  if (!row?.isPremium) return false
  if (!row.premiumUntil) return true
  return new Date(row.premiumUntil).getTime() > Date.now()
}

/** Find a participant entry in group metadata by any of its address forms. */
export const findParticipant = (groupMetadata, jid) => {
  if (!groupMetadata?.participants?.length || !jid) return null
  const target = String(jid)
  const targetDigits = digitsOf(target)
  return (
    groupMetadata.participants.find(participant => {
      if (!participant) return false
      const candidates = [participant.id, participant.lid, participant.phoneNumber].filter(Boolean).map(String)
      return candidates.some(candidate => candidate === target || digitsOf(candidate) === targetDigits)
    }) ?? null
  )
}

/** Is this person an admin (or the group creator) of the group? */
export const isGroupAdmin = (groupMetadata, jid) => {
  const participant = findParticipant(groupMetadata, jid)
  if (!participant) return false
  return participant.admin === 'admin' || participant.admin === 'superadmin'
}

/** Is the bot itself an admin of the group? */
export const isBotGroupAdmin = (groupMetadata, botJid, botLid = null) =>
  isGroupAdmin(groupMetadata, botJid) || (botLid ? isGroupAdmin(groupMetadata, botLid) : false)

/** Does this chat count as a group for the `groupOnly` plugin flag? */
export const isGroupChat = message => Boolean(message?.isGroup)

export default {
  ownerNumberSet,
  checkOwner,
  checkBanned,
  checkPremium,
  findParticipant,
  isGroupAdmin,
  isBotGroupAdmin,
  isGroupChat
}
