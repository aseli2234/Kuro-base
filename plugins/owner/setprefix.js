/**
 * `.setprefix` — change the command prefixes at runtime.
 *
 * The change is applied to the live config and persisted in the `settings`
 * table, so it survives a restart without editing settings.js.
 */

export default {
  name: 'setprefix',
  command: ['setprefix', 'prefix'],
  category: 'owner',
  description: 'Show or change the command prefixes',
  usage: '.setprefix . ! /',
  ownerOnly: true,

  async execute(ctx) {
    const raw = (ctx.argText ?? '').trim()

    if (!raw) {
      await ctx.reply(
        [
          '*PREFIX*',
          '────────────────────────',
          `› Current : ${ctx.config.prefix.map(value => `\`${value}\``).join('  ')}`,
          '',
          `Send \`${ctx.prefix}setprefix . !\` to change them.`,
          'Separate each prefix with a space or a comma.'
        ].join('\n')
      )
      return
    }

    const prefixes = [...new Set(raw.split(/[\s,]+/).filter(Boolean))]

    if (prefixes.length === 0 || prefixes.length > 6) {
      await ctx.reply('Provide between 1 and 6 prefixes.')
      return
    }
    if (prefixes.some(value => value.length > 3)) {
      await ctx.reply('Each prefix must be at most 3 characters.')
      return
    }

    ctx.config.prefix = prefixes.sort((a, b) => b.length - a.length)
    try {
      ctx.db?.setSetting('prefix', ctx.config.prefix)
    } catch (error) {
      ctx.logger?.warn?.(`Could not persist the prefix: ${error.message}`)
    }

    await ctx.react('✅').catch(() => {})
    await ctx.reply(
      [
        '*PREFIX UPDATED*',
        '────────────────────────',
        `› Active : ${ctx.config.prefix.map(value => `\`${value}\``).join('  ')}`,
        '',
        `Try \`${ctx.config.prefix[0]}menu\`.`
      ].join('\n')
    )
  }
}
