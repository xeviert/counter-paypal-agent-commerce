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
| `lidded-rattan-basket` | [Unsplash photo uRCrdEiiVPU](https://unsplash.com/photos/brown-woven-baskets-on-white-table-uRCrdEiiVPU), [Unsplash License](https://unsplash.com/license) |
| `buri-palm-bayong` | [Pexels photo 32128851](https://www.pexels.com/photo/stylish-woman-holding-woven-tote-in-blooming-garden-32128851/), [Pexels License](https://www.pexels.com/license/) |
| `pandan-placemat-set` | [Pexels photo 28572213](https://www.pexels.com/photo/rustic-table-setting-with-bread-and-pastries-28572213/), [Pexels License](https://www.pexels.com/license/) |
| `abaca-planter-basket` | [Pexels photo 9336332](https://www.pexels.com/photo/woven-baskets-on-black-metal-stand-9336332/), [Pexels License](https://www.pexels.com/license/) |
| `rattan-fruit-bowl` | [Pexels photo 5945946](https://www.pexels.com/photo/delicious-fresh-berries-in-bowls-5945946/), [Pexels License](https://www.pexels.com/license/) |
| `rattan-laundry-hamper` | [Pexels photo 31390651](https://www.pexels.com/photo/stylish-woven-laundry-basket-in-modern-bathroom-31390651/), [Pexels License](https://www.pexels.com/license/) |
| `buri-coaster-set` | [Pexels photo 9173943](https://www.pexels.com/photo/abundance-of-wicker-accessories-9173943/), [Pexels License](https://www.pexels.com/license/) |
| `abaca-wall-plate` | [Unsplash photo Zd1fsUrpH3I](https://unsplash.com/photos/wooden-window-and-decorative-plate-on-a-sunlit-beige-wall-Zd1fsUrpH3I), [Unsplash License](https://unsplash.com/license) |
| `beaded-collar-necklace` | [Unsplash photo lDsQ7qAvunw](https://unsplash.com/photos/a-woman-in-a-yellow-dress-with-a-bunch-of-necklaces-on-her-neck-lDsQ7qAvunw), [Unsplash License](https://unsplash.com/license) |
| `beaded-bracelet-trio` | [Pexels photo 40241513](https://www.pexels.com/photo/colorful-eswatini-beaded-bracelets-display-40241513/), [Pexels License](https://www.pexels.com/license/) |
| `beaded-leather-sandals` | [Pexels photo 38263762](https://www.pexels.com/photo/candid-capture-of-beaded-sandals-and-feet-38263762/), [Pexels License](https://www.pexels.com/license/) |
| `beaded-drop-earrings` | [Unsplash photo kDbC60FPigU](https://unsplash.com/photos/man-in-blue-shirt-with-white-scarf-kDbC60FPigU), [Unsplash License](https://unsplash.com/license) |
| `beaded-leather-belt` | [FawziaAbdurRahman](https://commons.wikimedia.org/wiki/File:Old_maasai_woman_making_a_beaded_leather_belt_on_a_bowed_stick_%27frame%27.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons |
| `beaded-keyring-set` | [Pixabay photo 348960](https://pixabay.com/photos/bunch-of-keys-key-ring-keys-green-348960/), [Pixabay Content License](https://pixabay.com/service/license-summary/) |
| `wire-and-bead-bowl` | [Pixabay photo 1575171](https://pixabay.com/photos/beaded-gourd-bowl-old-mexico-beads-1575171/), [Pixabay Content License](https://pixabay.com/service/license-summary/) |
| `beaded-dog-collar` | [Pexels photo 11865890](https://www.pexels.com/photo/close-up-shot-of-a-dog-11865890/), [Pexels License](https://www.pexels.com/license/) |
