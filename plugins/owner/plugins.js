/**
 * `.plugins` — what is actually loaded right now.
 *
 * Reads the live registry (not the database), so it always reflects the truth
 * after a reload. File paths and load failures are only shown to the owner.
 */

import { categoryLabel } from '../../src/plugins/utils.js'

export default {
  name: 'plugins',
  command: ['plugins', 'plugin'],
  category: 'owner',
  description: 'List the loaded plugins by category',
  usage: '.plugins   |   .plugins <category>',

  async execute(ctx) {
    const registry = ctx.plugins
    if (!registry) {
      await ctx.reply('The plugin registry is not available.')
      return
    }

    const filter = (ctx.args[0] ?? '').toLowerCase()
    const groups = registry.byCategory({ includeHidden: ctx.isOwner })

    let categories = Object.keys(groups).sort()
    if (filter) categories = categories.filter(category => category.toLowerCase() === filter)

    if (categories.length === 0) {
      await ctx.reply(`No plugins found${filter ? ` in category *${filter}*` : ''}.`)
      return
    }

    const blocks = categories.map(category => {
      const lines = groups[category].map(record => {
        const triggers = record.triggers.join(', ')
        const state = record.enabled ? '' : ' _(disabled)_'
        return `- ${record.name} → ${triggers}${state}`
      })
      return `*${categoryLabel(category)}* (${groups[category].length})\n${lines.join('\n')}`
    })

    const header = [
      `*LOADED PLUGINS: ${registry.size}*`,
      `Triggers: ${registry.commandCount}`,
      '────────────────────────'
    ]

    const sections = [header.join('\n'), ...blocks]

    if (ctx.isOwner) {
      if (registry.conflicts.length) {
        sections.push(
          '*TRIGGER CONFLICTS*',
          ...registry.conflicts.map(item => `- ${item.trigger}: ${item.plugin} ignored, kept by ${item.keptBy}`)
        )
      }
      if (registry.failures.length) {
        sections.push(
          '*FAILED TO LOAD*',
          ...registry.failures.map(item => `- ${item.file.split(/[\\/]/).pop()}: ${item.error}`)
        )
      }
    }

    await ctx.reply(sections.join('\n\n'))
  }
}
