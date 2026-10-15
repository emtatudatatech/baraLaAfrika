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
  map: {
    label: 'Map of Africa showing the 54 countries coloured by region',
    keyboardHint:
      'Tab into the map, then use the arrow keys to move between countries and Enter to open one.',
    zoomHint: 'Pinch or use the buttons to zoom. On a computer, hold Ctrl (or ⌘) and scroll.',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Reset the map',
    loading: 'Loading the map…',
    loadError: 'The map could not be loaded.',
    countriesError: 'Country details could not be loaded, so the map shows boundaries only.',
    retry: 'Retry',
    disputed: 'Western Sahara',
    disputedNote: 'Disputed territory (not one of the 54 states covered here)',
    somalilandNote:
      'Includes Somaliland, which declared independence in 1991 and governs itself but is not recognised as a state by the African Union or the United Nations.',
    boundariesNote:
      'Boundaries are shown as published by Natural Earth and do not imply endorsement of any border or territorial claim. Western Sahara (hatched) is a disputed territory. Somaliland is shown as part of Somalia.',
    tableLink: 'See all countries as a table',
    countryLabel: (name: string, region: string) => `${name}, ${region}`,
  },
  legend: {
    title: 'Regions',
    hint: 'Select a region to highlight it on the map.',
    countries: (count: number) => (count === 1 ? '1 country' : `${String(count)} countries`),
    viewInTable: 'View in table',
    showAll: 'Show all regions',
  },
  popover: {
    close: 'Close',
    meaning: 'Name means',
    animal: 'National animal',
    seeInTable: 'See in table',
  },
  animalStatus: {
    official: 'Official',
    de_facto: 'De facto',
    inferred: 'Inferred',
    sports_nickname: 'Sports nickname',
    contested: 'Contested',
  },
  animalStatusHint: {
    official: 'Designated by the state (law, constitution or coat of arms).',
    de_facto: 'Widely used as a national animal without a formal designation.',
    inferred: 'Inferred by the research document; no official designation was found.',
    sports_nickname: 'Taken from a national sports team’s nickname, not an official designation.',
    contested: 'Sources disagree on this animal.',
  },
  etymologyCategory: {
    geographic_feature: 'Geographic feature',
    ethnic_group: 'People or ethnic group',
    kingdom_or_ruler: 'Kingdom or ruler',
    colonial_or_translation: 'Colonial name or translation',
  },
  reliabilityTier: {
    primary: 'Primary source',
    reference: 'Reference work',
    secondary: 'Secondary source',
    low: 'Low reliability',
  },
  profileField: {
    etymology: 'Name meaning',
    flag_design: 'Flag design',
    national_symbol: 'National symbol',
    national_animal: 'National animal',
  },
  countries: {
    filtersLabel: 'Filter countries',
    regionGroup: 'Region',
    allRegions: 'All',
    searchLabel: 'Search countries',
    searchPlaceholder: 'Name, meaning, symbol or animal',
    sortLabel: 'Sort by',
    sortOptions: {
      name: 'Country',
      region: 'Region',
      etymology: 'Name meaning',
      symbol: 'National symbol',
      animal: 'National animal',
    },
    ascending: 'A to Z',
    descending: 'Z to A',
    resultCount: (shown: number, total: number) =>
      shown === total
        ? `Showing all ${String(total)} countries`
        : `Showing ${String(shown)} of ${String(total)} countries`,
    caption:
      'African countries with the meaning of their names, their flags, national symbols and national animals',
    columns: {
      flag: 'Flag design',
      name: 'Country',
      region: 'Region',
      etymology: 'Name meaning',
      symbol: 'National symbol',
      animal: 'National animal',
    },
    flagButton: (name: string) => `Flag of ${name}`,
    viewDetails: 'Full profile and sources',
    empty: 'No countries match',
    emptyHint: 'Try another search or region.',
    clearFilters: 'Clear filters',
    loadError: 'The countries could not be loaded.',
    retry: 'Retry',
  },
  drawer: {
    close: 'Close',
    officialName: 'Official name',
    meaning: 'Name meaning',
    category: 'Category',
    flag: 'Flag design',
    symbol: 'National symbol',
    animal: 'National animal',
    sources: 'Sources',
    sourcesNote:
      'Sources as cited by the research document, plus any added during review. Reliability tiers are this project’s assessment.',
    noSources: 'No sources are recorded for this country.',
    usedFor: 'Used for',
    newTab: '(opens in a new tab)',
    needsReview: 'Needs verification',
    needsReviewHint:
      'Some of this text relies on low-reliability sources or has open questions. Why?',
    noteKinds: {
      correction: 'Corrected',
      status: 'Status reviewed',
      issue: 'Open question',
      note: 'Note',
    },
    loading: 'Loading the full profile…',
    loadError: 'The full profile could not be loaded.',
    retry: 'Retry',
  },
  // Shown only in development builds (see lib/apiHint.ts). `code` spans are marked with backticks.
  devHints: {
    apiNotRunning:
      'Development: no API answered. `npm run dev` serves the site only. Run `npm run dev:local` (the committed seed data, no database needed) or `npm run dev:netlify` (your Neon database).',
    noDatabase:
      'Development: the API has no database. Set `DATABASE_URL_READ` in `.env` for `npm run dev:netlify`, or run `npm run dev:local`.',
  },
  footer: {
    creditsHeading: 'Data, credits and licences',
    disclaimer:
      'Boundaries are shown as published by Natural Earth and do not imply endorsement of any border or territorial claim.',
    notAdvice: 'Informational only. Nothing here is financial advice.',
  },
} as const;
