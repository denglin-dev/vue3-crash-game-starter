export interface GameSeoConfig {
  id: string | number
  name: string
  description: string
  keywords: string[]
  image: string
  minPrice?: number
  maxPrice?: number
}

export function useGameSeo(config: GameSeoConfig) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Game",
    name: config.name,
    url: `${process.env.NUXT_PUBLIC_SITE_URL}/newGame/${config.id}`,
    description: config.description,
    keywords: config.keywords,
    genre: ["Casino Game", "Game of Chance", "Online Game"],
    publisher: {
      "@type": "Organization",
      name: "Cybet",
      url: process.env.NUXT_PUBLIC_SITE_URL
    },
    producer: {
      "@type": "Organization",
      name: "Cybet",
      url: process.env.NUXT_PUBLIC_SITE_URL
    },
    audience: {
      "@type": "PeopleAudience",
      suggestedMinAge: 18
    },
    isAccessibleForFree: false,
    image: config.image,
    thumbnailUrl: config.image,
    offers: {
      "@type": "Offer",
      itemOffered: {
        "@type": "Game",
        name: config.name
      },
      name: `Bet on ${config.name} with Cryptocurrency`,
      priceCurrency: "BTC",
      category: "BettingOffer",
      description: config.description,
      priceSpecification: {
        "@type": "PriceSpecification",
        minPrice: config.minPrice || 0.00001,
        maxPrice: config.maxPrice || 1.0,
        priceCurrency: "BTC"
      }
    },
    award: ["Provably Fair Game (Independently Verified)"]
  }

  const setSeoMeta = (title: string, description: string) => {
    useSeoMeta({ title, description })
    useHead({
      script: [
        {
          type: "application/ld+json",
          innerHTML: JSON.stringify(schema)
        }
      ]
    })
  }

  return {
    schema,
    setSeoMeta
  }
}
