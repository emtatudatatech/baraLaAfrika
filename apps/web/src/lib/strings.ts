/**
 * All user-facing UI strings (English only in v1). Components import from here rather than
 * hard-coding copy, so a translation layer can replace this module later. Country names keep
 * their proper diacritics (Côte d'Ivoire, São Tomé and Príncipe).
 */
export const strings = {
  site: {
    name: 'Bara La Afrika',
    tagline: 'Uncovering, learning and understanding Africa.',
    description:
      'An interactive explorer of the 54 African states: what their names mean, what their flags and national symbols say, how high their mountains rise and where their gold is found.',
  },
  a11y: {
    skipToContent: 'Skip to main content',
    primaryNav: 'Primary',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    externalLink: '(opens in a new tab)',
  },
  nav: {
    home: 'Home',
    countries: 'Countries',
    harim: 'Harim',
    dhahabu: 'Dhahabu',
    history: 'History',
    contemporary: 'Contemporary Africa',
    comingSoon: 'Coming soon',
  },
  theme: {
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
  },
  ribbon: {
    label: 'Data behind this view',
    referenceData: 'Reference data',
    timeSeries: 'Time series',
    notTimeDependent: 'Not time-dependent',
    notTimeDependentHint: "This page's data is not time-dependent",
    noDatasets: 'No external datasets on this page',
    datasetCount: (count: number) => (count === 1 ? '1 dataset' : `${count} datasets`),
    dateRange: 'Date range',
    showDetails: 'Show data details',
    hideDetails: 'Hide data details',
  },
  datasets: {
    'symbology-pdf': 'State symbology research',
    'flags-flagpedia': 'Flags: Flagpedia',
    'boundaries-natural-earth': 'Boundaries: Natural Earth',
    'mountains-baseline': 'Harim baseline',
    'mountains-wikidata': 'Wikidata',
    'mountains-geonames': 'GeoNames',
    'gold-price': 'Gold price',
    'gold-production': 'Mine production',
    'gold-official-reserves': 'Central bank reserves',
    'gold-trade': 'Gold trade',
  },
  pages: {
    home: {
      title: 'Bara La Afrika',
      kicker: 'Fifty-four states, one continent',
      lead: 'Explore what Africa’s country names mean, what their flags and national animals symbolise, how high their mountains rise and where their gold is found.',
      explore: 'Start exploring',
    },
    countries: {
      title: 'Countries',
      description:
        'All 54 African states: the meaning of their names, their flags, national symbols and national animals.',
    },
    harim: {
      title: 'Harim · Mountains of Africa',
      description: 'Africa’s mountains and their heights, country by country.',
    },
    dhahabu: {
      title: 'Dhahabu · Gold in Africa',
      description:
        'Where gold is found in Africa, how much is mined and traded, and how much central banks hold.',
    },
    underConstruction:
      'This section is being built. Its data pipeline and views arrive in the next milestones.',
    notFound: {
      title: 'Page not found',
      body: 'We could not find that page. It may have moved, or the link may be mistyped.',
      home: 'Back to the map',
    },
    error: {
      title: 'Something went wrong',
      body: 'This part of the page failed to load. You can try again, or go back to the home page.',
      retry: 'Try again',
      home: 'Go home',
    },
  },
  footer: {
    creditsHeading: 'Data, credits and licences',
    disclaimer:
      'Boundaries are shown as published by Natural Earth and do not imply endorsement of any border or territorial claim.',
    notAdvice: 'Informational only. Nothing here is financial advice.',
  },
} as const;
