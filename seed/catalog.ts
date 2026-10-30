import type { Category, Language, SellerCountry, WeightClass } from "@/lib/schemas/common";
import type { ListingContent } from "@/lib/schemas/listing";

// Demo makers and their products (BUILDOUT §5.7). Fictional people; native-language text still
// needs a native speaker's check before the video. Photos: seed/photos/<slug>/ (see README there).

export type SeedProduct = {
  slug: string;
  category: Category;
  weightClass: WeightClass;
  /** USD cents. Floor defaults to 85% of list (the review screen's default, §6.1). */
  listPrice: number;
  floorPrice?: number;
  stock: number;
  listing: ListingContent;
};

export type SeedPersona = {
  /** Fixed so re-seeding is idempotent and `pnpm onboard --seller <id>` can attach PayPal. Also PayPal's `tracking_id`. */
  id: string;
  name: string;
  country: SellerCountry;
  language: Language;
  locality: string;
  /** Already linked in sandbox; `pnpm onboard --seller <id> --merchant-id <this>` imports it. */
  sandboxMerchantId?: string;
  products: SeedProduct[];
};

const usd = (dollars: number) => Math.round(dollars * 100);

// ── Oaxaca weaver (MX, demo hero) ────────────────────────────────────────

const lucia = "Lucía Hernández weaves on a pedal loom in Teotitlán del Valle, Oaxaca, as her family has for four generations. She cards and spins the wool herself and dyes it with cochineal, indigo and wild marigold.";
const luciaEs = "Lucía Hernández teje en telar de pedal en Teotitlán del Valle, Oaxaca, como su familia desde hace cuatro generaciones. Ella misma carda e hila la lana y la tiñe con grana cochinilla, añil y pericón.";
const rugCare = "Shake out or vacuum on low. Spot clean with cold water; no machine washing.";
const rugCareEs = "Sacudir o aspirar suave. Limpiar manchas con agua fría; no lavar en lavadora.";

const mx: SeedPersona = {
  id: "5eed0001-0000-4000-8000-000000000001",
  name: "Lucía Hernández",
  country: "MX",
  language: "es",
  locality: "Teotitlán del Valle, Oaxaca",
  products: [
    {
      slug: "zapotec-fret-rug",
      category: "textiles",
      weightClass: "medium",
      listPrice: usd(145),
      stock: 3,
      listing: {
        language: "es",
        en: {
          title: "Zapotec fret wool rug, natural dyes",
          description: "A flat-woven rug with the stepped fret (greca) pattern of Mitla's stone walls, in cochineal red, indigo and undyed cream.",
          materials: "Hand-spun sheep's wool, cotton warp, cochineal and indigo dyes",
          care: rugCare,
          provenance: `${lucia} This design takes her about two weeks on the loom.`,
        },
        native: {
          title: "Tapete zapoteco de grecas, tintes naturales",
          description: "Tapete tejido plano con las grecas escalonadas de los muros de Mitla, en rojo de cochinilla, añil y crudo natural.",
          materials: "Lana de borrego hilada a mano, urdimbre de algodón, tintes de cochinilla y añil",
          care: rugCareEs,
          provenance: `${luciaEs} Este diseño le lleva unas dos semanas en el telar.`,
        },
        dimensions: { lengthCm: 90, widthCm: 60 },
      },
    },
    {
      slug: "cochineal-red-large-rug",
      category: "textiles",
      weightClass: "large",
      listPrice: usd(420),
      stock: 1,
      listing: {
        language: "es",
        en: {
          title: "Large cochineal red rug with diamond medallion",
          description: "A large living-room rug dyed deep red with cochineal, with a central diamond medallion and a double border.",
          materials: "Hand-spun sheep's wool, cotton warp, cochineal dye",
          care: rugCare,
          provenance: `${lucia} A rug this size is about six weeks of work.`,
        },
        native: {
          title: "Tapete grande rojo cochinilla con rombo central",
          description: "Tapete grande de sala teñido de rojo intenso con cochinilla, con un rombo central y doble cenefa.",
          materials: "Lana de borrego hilada a mano, urdimbre de algodón, tinte de cochinilla",
          care: rugCareEs,
          provenance: `${luciaEs} Un tapete de este tamaño son unas seis semanas de trabajo.`,
        },
        dimensions: { lengthCm: 180, widthCm: 120 },
      },
    },
    {
      slug: "indigo-table-runner",
      category: "textiles",
      weightClass: "small",
      listPrice: usd(68),
      stock: 4,
      listing: {
        language: "es",
        en: {
          title: "Indigo wool table runner",
          description: "A narrow runner in shades of indigo, from pale sky to almost black, with a simple zigzag band at each end.",
          materials: "Hand-spun sheep's wool, cotton warp, indigo dye",
          care: rugCare,
          provenance: lucia,
        },
        native: {
          title: "Camino de mesa de lana color añil",
          description: "Camino de mesa angosto en tonos de añil, del azul cielo al casi negro, con una franja en zigzag en cada extremo.",
          materials: "Lana de borrego hilada a mano, urdimbre de algodón, tinte de añil",
          care: rugCareEs,
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 150, widthCm: 35 },
      },
    },
    {
      slug: "diamond-cushion-cover",
      category: "home_decor",
      weightClass: "small",
      listPrice: usd(48),
      stock: 6,
      listing: {
        language: "es",
        en: {
          title: "Woven wool cushion cover, diamond pattern",
          description: "A cushion cover woven on the same loom as Lucía's rugs, with a red and cream diamond on a natural grey ground. Zip closure; insert not included.",
          materials: "Hand-spun sheep's wool, cotton back and zip",
          care: "Spot clean or hand wash cold; dry flat.",
          provenance: lucia,
        },
        native: {
          title: "Funda de cojín de lana, diseño de rombo",
          description: "Funda de cojín tejida en el mismo telar que los tapetes de Lucía, con un rombo rojo y crudo sobre fondo gris natural. Cierre de cremallera; sin relleno.",
          materials: "Lana de borrego hilada a mano, reverso y cierre de algodón",
          care: "Limpiar manchas o lavar a mano en agua fría; secar extendida.",
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 45, widthCm: 45 },
      },
    },
    {
      slug: "woven-wool-tote",
      category: "accessories",
      weightClass: "medium",
      listPrice: usd(62),
      stock: 3,
      listing: {
        language: "es",
        en: {
          title: "Woven wool tote bag with leather handles",
          description: "A sturdy tote with a woven wool front in marigold yellow and indigo, lined in cotton, with leather handles made by a neighbour in the village.",
          materials: "Hand-spun wool, cotton lining, cow leather handles",
          care: "Spot clean only.",
          provenance: lucia,
        },
        native: {
          title: "Bolsa tejida de lana con asas de piel",
          description: "Bolsa resistente con frente de lana tejida en amarillo pericón y añil, forrada de algodón, con asas de piel hechas por un vecino del pueblo.",
          materials: "Lana hilada a mano, forro de algodón, asas de piel de res",
          care: "Solo limpiar manchas.",
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 40, widthCm: 12, heightCm: 35 },
      },
    },
    {
      slug: "marigold-small-rug",
      category: "textiles",
      weightClass: "medium",
      listPrice: usd(78),
      stock: 2,
      listing: {
        language: "es",
        en: {
          title: "Small marigold-yellow wool rug",
          description: "A bright doormat-size rug dyed with pericón, the wild marigold that grows on the hills above the village, with a cream border.",
          materials: "Hand-spun sheep's wool, cotton warp, pericón dye",
          care: rugCare,
          provenance: lucia,
        },
        native: {
          title: "Tapete pequeño de lana amarillo pericón",
          description: "Tapete brillante tamaño tapete de entrada, teñido con pericón, la flor silvestre que crece en los cerros del pueblo, con cenefa color crudo.",
          materials: "Lana de borrego hilada a mano, urdimbre de algodón, tinte de pericón",
          care: rugCareEs,
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 60, widthCm: 40 },
      },
    },
    {
      slug: "wool-coaster-set",
      category: "home_decor",
      weightClass: "small",
      listPrice: usd(24),
      stock: 10,
      listing: {
        language: "es",
        en: {
          title: "Set of 4 woven wool coasters",
          description: "Four coasters woven from the ends of rug warps, each in a different natural dye colour.",
          materials: "Hand-spun sheep's wool, natural dyes",
          care: "Hand wash cold; dry flat.",
          provenance: lucia,
        },
        native: {
          title: "Juego de 4 posavasos de lana tejida",
          description: "Cuatro posavasos tejidos con los sobrantes de urdimbre de los tapetes, cada uno de un color de tinte natural distinto.",
          materials: "Lana de borrego hilada a mano, tintes naturales",
          care: "Lavar a mano en agua fría; secar extendidos.",
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 10, widthCm: 10, note: "each coaster" },
      },
    },
    {
      slug: "eye-of-god-rug",
      category: "textiles",
      weightClass: "large",
      listPrice: usd(230),
      stock: 1,
      listing: {
        language: "es",
        en: {
          title: "Eye of God wool rug",
          description: "A rug built around the Ojo de Dios motif, nested diamonds in red, gold and indigo on a natural brown ground.",
          materials: "Hand-spun sheep's wool, cotton warp, natural dyes",
          care: rugCare,
          provenance: lucia,
        },
        native: {
          title: "Tapete de lana Ojo de Dios",
          description: "Tapete con el motivo del Ojo de Dios: rombos concéntricos en rojo, dorado y añil sobre fondo café natural.",
          materials: "Lana de borrego hilada a mano, urdimbre de algodón, tintes naturales",
          care: rugCareEs,
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 120, widthCm: 80 },
      },
    },
    {
      slug: "wool-rebozo-shawl",
      category: "accessories",
      weightClass: "small",
      listPrice: usd(95),
      stock: 2,
      listing: {
        language: "es",
        en: {
          title: "Soft wool rebozo shawl",
          description: "A light shawl woven from finely spun wool, in undyed grey with cochineal-pink stripes and knotted fringes.",
          materials: "Finely hand-spun sheep's wool, cochineal dye",
          care: "Hand wash cold with mild soap; dry flat in the shade.",
          provenance: lucia,
        },
        native: {
          title: "Rebozo suave de lana",
          description: "Rebozo ligero tejido con lana hilada fina, en gris natural con rayas rosa cochinilla y flecos anudados.",
          materials: "Lana de borrego hilada fina a mano, tinte de cochinilla",
          care: "Lavar a mano en agua fría con jabón suave; secar extendido a la sombra.",
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 190, widthCm: 60 },
      },
    },
    {
      slug: "mountain-wall-hanging",
      category: "art",
      weightClass: "medium",
      listPrice: usd(110),
      stock: 1,
      listing: {
        language: "es",
        en: {
          title: "Woven wall hanging, Oaxaca hills at dusk",
          description: "A small tapestry of the hills behind Teotitlán at sunset, in indigo, rose and gold, mounted on a carved wooden rod.",
          materials: "Hand-spun sheep's wool, natural dyes, pine rod",
          care: "Dust gently; keep out of direct sun.",
          provenance: lucia,
        },
        native: {
          title: "Tapiz de pared, cerros de Oaxaca al atardecer",
          description: "Tapiz pequeño de los cerros detrás de Teotitlán al atardecer, en añil, rosa y dorado, montado en una vara de madera tallada.",
          materials: "Lana de borrego hilada a mano, tintes naturales, vara de pino",
          care: "Sacudir suavemente; evitar el sol directo.",
          provenance: luciaEs,
        },
        dimensions: { lengthCm: 70, widthCm: 50 },
      },
    },
  ],
};

// ── Manila basket maker (PH) ─────────────────────────────────────────────

const rosa = "Rosa Villanueva and the women of her cooperative in Manila weave baskets from rattan, buri palm, abacá and pandan sourced from family farms in Quezon and Bicol.";
const rosaFil = "Si Rosa Villanueva at ang mga kababaihan ng kanilang kooperatiba sa Maynila ay humahabi ng mga basket mula sa rattan, buri, abaka at pandan na galing sa mga sakahan ng pamilya sa Quezon at Bicol.";
const basketCare = "Wipe with a damp cloth and let dry in the air. Keep away from long soaking.";
const basketCareFil = "Punasan ng basang tela at patuyuin sa hangin. Huwag ibabad nang matagal.";

const ph: SeedPersona = {
  id: "5eed0002-0000-4000-8000-000000000002",
  name: "Rosa Villanueva",
  country: "PH",
  language: "fil",
  locality: "Manila",
  sandboxMerchantId: "MPMWEFYQWQYUA",
  products: [
    {
      slug: "lidded-rattan-basket",
      category: "baskets",
      weightClass: "medium",
      listPrice: usd(55),
      stock: 4,
      listing: {
        language: "fil",
        en: {
          title: "Lidded rattan storage basket",
          description: "A round storage basket with a fitted lid, woven tight from split rattan in a natural honey colour.",
          materials: "Split rattan",
          care: basketCare,
          provenance: rosa,
        },
        native: {
          title: "Basket na rattan na may takip",
          description: "Bilog na basket na lalagyan na may takip, mahigpit na hinabi mula sa hinating rattan sa natural na kulay pulot.",
          materials: "Hinating rattan",
          care: basketCareFil,
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 30, widthCm: 30, heightCm: 28 },
      },
    },
    {
      slug: "buri-palm-bayong",
      category: "accessories",
      weightClass: "medium",
      listPrice: usd(38),
      stock: 6,
      listing: {
        language: "fil",
        en: {
          title: "Buri palm bayong market bag",
          description: "The classic Filipino market bag, woven from buri palm with a red and green stripe and rope handles.",
          materials: "Buri palm, abacá rope handles",
          care: basketCare,
          provenance: rosa,
        },
        native: {
          title: "Bayong na buri",
          description: "Ang klasikong bayong na pampalengke, hinabi mula sa buri na may guhit na pula at berde at hawakang lubid.",
          materials: "Buri, hawakang lubid na abaka",
          care: basketCareFil,
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 38, widthCm: 18, heightCm: 35 },
      },
    },
    {
      slug: "pandan-placemat-set",
      category: "home_decor",
      weightClass: "small",
      listPrice: usd(32),
      stock: 5,
      listing: {
        language: "fil",
        en: {
          title: "Set of 4 woven pandan placemats",
          description: "Four flat-woven placemats in dried pandan leaf, soft and lightly fragrant, with a dyed border.",
          materials: "Pandan leaf",
          care: basketCare,
          provenance: rosa,
        },
        native: {
          title: "Apat na placemat na hinabing pandan",
          description: "Apat na patag na placemat na gawa sa tuyong dahon ng pandan, malambot at bahagyang mabango, na may kulay na gilid.",
          materials: "Dahon ng pandan",
          care: basketCareFil,
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 45, widthCm: 30, note: "each placemat" },
      },
    },
    {
      slug: "abaca-planter-basket",
      category: "baskets",
      weightClass: "small",
      listPrice: usd(29),
      stock: 8,
      listing: {
        language: "fil",
        en: {
          title: "Abacá planter basket",
          description: "A soft, sturdy basket to hold a potted plant, coiled from abacá fibre in natural and charcoal.",
          materials: "Abacá fibre",
          care: "Use with a plastic pot inside; wipe dry.",
          provenance: rosa,
        },
        native: {
          title: "Basket na abaka para sa halaman",
          description: "Malambot pero matibay na basket para sa paso ng halaman, inikid mula sa hibla ng abaka sa natural at abuhing kulay.",
          materials: "Hibla ng abaka",
          care: "Lagyan ng plastik na paso sa loob; punasan nang tuyo.",
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 24, widthCm: 24, heightCm: 22 },
      },
    },
    {
      slug: "rattan-fruit-bowl",
      category: "baskets",
      weightClass: "small",
      listPrice: usd(26),
      stock: 6,
      listing: {
        language: "fil",
        en: {
          title: "Open-weave rattan fruit bowl",
          description: "A shallow bowl in open-weave rattan so fruit can breathe, with a wrapped rim.",
          materials: "Rattan",
          care: basketCare,
          provenance: rosa,
        },
        native: {
          title: "Mangkok na rattan para sa prutas",
          description: "Mababaw na mangkok na maluwag ang habi para makahinga ang prutas, na may balot na gilid.",
          materials: "Rattan",
          care: basketCareFil,
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 32, widthCm: 32, heightCm: 10 },
      },
    },
    {
      slug: "rattan-laundry-hamper",
      category: "baskets",
      weightClass: "large",
      listPrice: usd(98),
      stock: 2,
      listing: {
        language: "fil",
        en: {
          title: "Tall rattan laundry hamper",
          description: "A tall hamper with a hinged lid and two side handles, woven on a rattan pole frame.",
          materials: "Rattan, rattan pole frame",
          care: basketCare,
          provenance: rosa,
        },
        native: {
          title: "Mataas na basket na rattan para sa labahin",
          description: "Mataas na lalagyan ng labahin na may takip at dalawang hawakan sa gilid, hinabi sa balangkas na rattan.",
          materials: "Rattan, balangkas na rattan",
          care: basketCareFil,
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 45, widthCm: 35, heightCm: 60 },
      },
    },
    {
      slug: "buri-coaster-set",
      category: "home_decor",
      weightClass: "small",
      listPrice: usd(14),
      stock: 12,
      listing: {
        language: "fil",
        en: {
          title: "Set of 6 buri palm coasters",
          description: "Six round coasters coiled from buri palm, in a cotton-lined holder.",
          materials: "Buri palm, cotton",
          care: basketCare,
          provenance: rosa,
        },
        native: {
          title: "Anim na coaster na buri",
          description: "Anim na bilog na coaster na inikid mula sa buri, sa lalagyang may lining na koton.",
          materials: "Buri, koton",
          care: basketCareFil,
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 10, widthCm: 10, note: "each coaster" },
      },
    },
    {
      slug: "abaca-wall-plate",
      category: "home_decor",
      weightClass: "small",
      listPrice: usd(34),
      stock: 4,
      listing: {
        language: "fil",
        en: {
          title: "Woven abacá wall plate",
          description: "A flat round wall piece woven in a sunburst pattern from abacá, ready to hang.",
          materials: "Abacá fibre",
          care: "Dust gently.",
          provenance: rosa,
        },
        native: {
          title: "Pandekorasyong plato na hinabing abaka",
          description: "Patag at bilog na palamuti sa dingding na hinabi sa disenyong sinag ng araw mula sa abaka, handa nang isabit.",
          materials: "Hibla ng abaka",
          care: "Pagpagin nang marahan.",
          provenance: rosaFil,
        },
        dimensions: { lengthCm: 40, widthCm: 40 },
      },
    },
  ],
};

// ── Nairobi beadwork (KE) ────────────────────────────────────────────────

const wanjiru = "Wanjiru Kamau runs a small beadwork studio in Nairobi with three other women. They string glass beads by hand on wire and leather, mixing classic Kenyan colour blocks with their own patterns.";
const wanjiruSw = "Wanjiru Kamau anaendesha karakana ndogo ya ushanga jijini Nairobi pamoja na wanawake wengine watatu. Wanatunga shanga za kioo kwa mkono kwenye waya na ngozi, wakichanganya rangi za kawaida za Kenya na mitindo yao wenyewe.";
const beadCare = "Keep dry. Store flat so the beadwork keeps its shape.";
const beadCareSw = "Weka pakavu. Hifadhi ukiwa umelaza ili ushanga ubaki na umbo lake.";

const ke: SeedPersona = {
  id: "5eed0003-0000-4000-8000-000000000003",
  name: "Wanjiru Kamau",
  country: "KE",
  language: "sw",
  locality: "Nairobi",
  products: [
    {
      slug: "beaded-collar-necklace",
      category: "jewelry",
      weightClass: "small",
      listPrice: usd(58),
      stock: 3,
      listing: {
        language: "sw",
        en: {
          title: "Wide beaded collar necklace",
          description: "A flat, wide collar of glass beads in red, white, blue and orange bands, closing with a leather tie.",
          materials: "Glass seed beads, wire, leather tie",
          care: beadCare,
          provenance: wanjiru,
        },
        native: {
          title: "Mkufu mpana wa shanga",
          description: "Mkufu mpana na bapa wa shanga za kioo kwa mistari ya rangi nyekundu, nyeupe, buluu na chungwa, unaofungwa kwa kamba ya ngozi.",
          materials: "Shanga ndogo za kioo, waya, kamba ya ngozi",
          care: beadCareSw,
          provenance: wanjiruSw,
        },
        dimensions: { lengthCm: 30, widthCm: 28 },
      },
    },
    {
      slug: "beaded-bracelet-trio",
      category: "jewelry",
      weightClass: "small",
      listPrice: usd(22),
      stock: 10,
      listing: {
        language: "sw",
        en: {
          title: "Set of 3 beaded bracelets",
          description: "Three stretchy stacking bracelets in matching colours, each with a different pattern.",
          materials: "Glass seed beads, elastic cord",
          care: beadCare,
          provenance: wanjiru,
        },
        native: {
          title: "Bangili tatu za shanga",
          description: "Bangili tatu zinazovutika zenye rangi zinazolingana, kila moja ikiwa na mtindo tofauti.",
          materials: "Shanga ndogo za kioo, uzi wa mpira",
          care: beadCareSw,
          provenance: wanjiruSw,
        },
      },
    },
    {
      slug: "beaded-leather-sandals",
      category: "accessories",
      weightClass: "medium",
      listPrice: usd(45),
      stock: 4,
      listing: {
        language: "sw",
        en: {
          title: "Leather sandals with beaded straps",
          description: "Flat leather sandals with hand-beaded straps on a tyre-rubber sole. Message the maker with your size after ordering.",
          materials: "Cow leather, glass seed beads, recycled tyre sole",
          care: "Wipe the leather with a damp cloth; don't soak.",
          provenance: wanjiru,
        },
        native: {
          title: "Viatu vya ngozi vyenye kamba za shanga",
          description: "Viatu bapa vya ngozi vyenye kamba zilizopambwa kwa shanga kwa mkono, na soli ya mpira wa tairi. Mtumie fundi ukubwa wako baada ya kuagiza.",
          materials: "Ngozi ya ng'ombe, shanga ndogo za kioo, soli ya tairi iliyotumika upya",
          care: "Pangusa ngozi kwa kitambaa chenye unyevu; usiloweke.",
          provenance: wanjiruSw,
        },
      },
    },
    {
      slug: "beaded-drop-earrings",
      category: "jewelry",
      weightClass: "small",
      listPrice: usd(18),
      stock: 12,
      listing: {
        language: "sw",
        en: {
          title: "Beaded drop earrings",
          description: "Light triangular drop earrings in turquoise and gold beads on brass hooks.",
          materials: "Glass seed beads, brass hooks",
          care: beadCare,
          provenance: wanjiru,
        },
        native: {
          title: "Hereni za shanga zinazoning'inia",
          description: "Hereni nyepesi za pembetatu zenye shanga za rangi ya feruzi na dhahabu kwenye ndoano za shaba.",
          materials: "Shanga ndogo za kioo, ndoano za shaba",
          care: beadCareSw,
          provenance: wanjiruSw,
        },
        dimensions: { lengthCm: 6, widthCm: 3 },
      },
    },
    {
      slug: "beaded-leather-belt",
      category: "accessories",
      weightClass: "small",
      listPrice: usd(40),
      stock: 3,
      listing: {
        language: "sw",
        en: {
          title: "Beaded leather belt",
          description: "A leather belt with a full-length beaded band in a geometric pattern and a brass buckle.",
          materials: "Cow leather, glass seed beads, brass buckle",
          care: beadCare,
          provenance: wanjiru,
        },
        native: {
          title: "Mkanda wa ngozi wenye shanga",
          description: "Mkanda wa ngozi wenye mstari wa shanga urefu wote kwa mtindo wa maumbo, na bizimu ya shaba.",
          materials: "Ngozi ya ng'ombe, shanga ndogo za kioo, bizimu ya shaba",
          care: beadCareSw,
          provenance: wanjiruSw,
        },
        dimensions: { lengthCm: 110, widthCm: 4 },
      },
    },
    {
      slug: "beaded-keyring-set",
      category: "accessories",
      weightClass: "small",
      listPrice: usd(12),
      stock: 15,
      listing: {
        language: "sw",
        en: {
          title: "Set of 3 beaded keyrings",
          description: "Three small keyrings shaped like a giraffe, an elephant and a lion, beaded on wire.",
          materials: "Glass seed beads, wire, steel rings",
          care: beadCare,
          provenance: wanjiru,
        },
        native: {
          title: "Vishikio vitatu vya funguo vya shanga",
          description: "Vishikio vidogo vitatu vya funguo vyenye umbo la twiga, tembo na simba, vilivyotengenezwa kwa shanga kwenye waya.",
          materials: "Shanga ndogo za kioo, waya, pete za chuma",
          care: beadCareSw,
          provenance: wanjiruSw,
        },
      },
    },
    {
      slug: "wire-and-bead-bowl",
      category: "home_decor",
      weightClass: "small",
      listPrice: usd(36),
      stock: 3,
      listing: {
        language: "sw",
        en: {
          title: "Wire and bead decorative bowl",
          description: "A small bowl coiled from wire and glass beads in a spiral of sunset colours, for keys or jewellery.",
          materials: "Galvanised wire, glass beads",
          care: "Dust gently; not for food.",
          provenance: wanjiru,
        },
        native: {
          title: "Bakuli la mapambo la waya na shanga",
          description: "Bakuli dogo lililozungushwa kwa waya na shanga za kioo kwa mzunguko wa rangi za machweo, kwa funguo au vito.",
          materials: "Waya wa mabati, shanga za kioo",
          care: "Pangusa vumbi taratibu; si kwa chakula.",
          provenance: wanjiruSw,
        },
        dimensions: { lengthCm: 18, widthCm: 18, heightCm: 6 },
      },
    },
    {
      slug: "beaded-dog-collar",
      category: "accessories",
      weightClass: "small",
      listPrice: usd(28),
      stock: 5,
      listing: {
        language: "sw",
        en: {
          title: "Beaded leather dog collar",
          description: "A soft leather dog collar with a beaded band and a steel D-ring for the lead. Medium size, fits 35 to 45 cm necks.",
          materials: "Cow leather, glass seed beads, steel buckle and D-ring",
          care: beadCare,
          provenance: wanjiru,
        },
        native: {
          title: "Mkanda wa shingo wa mbwa wa ngozi wenye shanga",
          description: "Mkanda laini wa ngozi wa shingo ya mbwa wenye mstari wa shanga na pete ya chuma ya kufungia kamba. Saizi ya kati, shingo ya sentimita 35 hadi 45.",
          materials: "Ngozi ya ng'ombe, shanga ndogo za kioo, bizimu na pete ya chuma",
          care: beadCareSw,
          provenance: wanjiruSw,
        },
        dimensions: { lengthCm: 45, widthCm: 2.5 },
      },
    },
  ],
};

export const PERSONAS: readonly SeedPersona[] = [mx, ph, ke];

export function floorFor(product: SeedProduct): number {
  return product.floorPrice ?? Math.round(product.listPrice * 0.85);
}
