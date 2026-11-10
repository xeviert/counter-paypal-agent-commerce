# Seed photos

One folder per product slug from `seed/catalog.ts`, e.g. `seed/photos/zapotec-fret-rug/1.jpg`.
Files are used in name order (first = cover). JPEG, PNG, WebP, HEIC or AVIF, up to 5 MB each.

`pnpm seed` runs every file through `lib/photos.ts` (EXIF/GPS stripped, longest side 1280px, WebP) and
replaces the product's photos. `pnpm seed --photos-only` refreshes photos without touching listings.

Only add photos we own or have a license for, and note the source below.

| Slug | Source / license |
|---|---|
| `zapotec-fret-rug` | [Friends of Oaxacan Folk Art](https://commons.wikimedia.org/wiki/File:Tapete_by_Bulmaro_P%C3%A9rez_Mendoza.jpg), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0), via Wikimedia Commons |
| `cochineal-red-large-rug` | [Unsplash photo P4KJTXiFUb4](https://unsplash.com/photos/a-close-up-of-a-multi-colored-blanket-P4KJTXiFUb4), [Unsplash License](https://unsplash.com/license) |
| `indigo-table-runner` | [Unknown author](https://commons.wikimedia.org/wiki/File:Table_runner,_tablecloth_and_curtain_(AM_3239-11).jpg), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0), via Wikimedia Commons |
| `diamond-cushion-cover` | [Pexels photo 32598665](https://www.pexels.com/photo/close-up-of-blue-patterned-throw-pillows-with-textures-32598665/), [Pexels License](https://www.pexels.com/license/) |
| `woven-wool-tote` | [Timco, via DPLA](https://commons.wikimedia.org/wiki/File:Wool_Embroidered_Burlap_Bag_-_DPLA_-_695ecec24500a1ae7d535b7a9789b0c2_(page_2).jpg), no known restrictions, via Wikimedia Commons |
| `wool-coaster-set` | [Unsplash photo pjMCvOSuVjk](https://unsplash.com/photos/crocheted-rainbow-doily-on-black-surface-pjMCvOSuVjk), [Unsplash License](https://unsplash.com/license) |
| `eye-of-god-rug` | [Pexels photo 29508174](https://www.pexels.com/photo/intricate-circular-mandala-design-on-dark-background-29508174/), [Pexels License](https://www.pexels.com/license/) |
| `wool-rebozo-shawl` | [AlejandroLinaresGarcia](https://commons.wikimedia.org/wiki/File:RebozosBeltsZaachila.JPG), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons |
| `mountain-wall-hanging` | [PAULIX04](https://commons.wikimedia.org/wiki/File:Purple_Woven_Mountain_Landscape.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons |
| `zapotec-wool-sarape` | 1: [Unsplash photo 0ohjyDUIUq0](https://unsplash.com/photos/multicolored-textiles-lot-0ohjyDUIUq0), [Unsplash License](https://unsplash.com/license). 2: [Cleveland Museum of Art 1921.569](https://commons.wikimedia.org/wiki/File:America,_Native_North_American,_Southwest,_Mexico,_Saltillo,_Post-Contact,_-_Sarape_-_1921.569_-_Cleveland_Museum_of_Art.tif), [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en), via Wikimedia Commons |
| `natural-wool-hallway-runner` | [Unknown author](https://commons.wikimedia.org/wiki/File:Runner_(AM_6816-2).jpg), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0), via Wikimedia Commons |
| `woven-wool-coin-purse` | [Pexels photo 27154401](https://www.pexels.com/photo/top-view-of-sunglasses-and-covers-27154401/), [Pexels License](https://www.pexels.com/license/) |
| `natural-dye-sampler` | [clickerhappy](https://www.pexels.com/photo/multi-colored-laces-1571577/), [Pexels License](https://www.pexels.com/license/) |
| `marigold-small-rug` | [Sajad Fi](https://unsplash.com/photos/xIuYJOynnQ4), [Unsplash License](https://unsplash.com/license) |
