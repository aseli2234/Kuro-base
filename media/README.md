# media/

Static assets for KURO.

## Menu thumbnail

Drop the cover used by the menu's large link preview here and point
`menu.thumbnail` at it in `settings.js`:

```js
menu: {
  url: 'https://example.com',
  thumbnail: './media/menu.jpg',
  title: 'KURO WhatsApp Bot',
  description: 'Modern modular WhatsApp bot'
}
```

Paths are relative to the project root. A remote URL works too:
`thumbnail: 'https://example.com/menu.jpg'`.

How it is rendered depends on what is installed (see `src/lib/preview.js`):

| Condition | Result |
|---|---|
| `menu.url` + a reachable thumbnail + an image library (`jimp`, `sharp`, `@napi-rs/image`) | Large `richLink` card: the cover is uploaded as a `thumbnail-link` blob and WhatsApp draws it full size |
| `menu.url` + a local thumbnail, no image library | `externalAdReply` card with a large inline thumbnail |
| No thumbnail, or the file is missing | Plain text with the URL appended, letting WhatsApp build its own preview |

Notes:

- A **portrait or square** cover is downgraded to the small card in status
  posts; landscape covers always render large. Aim for something wider than it
  is tall (`menu.thumbnailWidth` defaults to 640).
- `jimp` ships as a dependency so the large card works out of the box.
- KURO warns at boot when `menu.thumbnail` points at a file that does not
  exist, and then falls back to plain text.
