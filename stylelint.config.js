/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // CSS Modules class names are camelCase (accessed as styles.fooBar).
    'selector-class-pattern': [
      '^(?:[a-z][a-zA-Z0-9]*|glass(?:--[a-z]+)?|visually-hidden|tabular|theme-transition)$',
      { message: 'Use camelCase class names (CSS Modules)' },
    ],
    // Safari < 18 still needs the prefixed backdrop-filter.
    'property-no-vendor-prefix': [
      true,
      { ignoreProperties: ['-webkit-backdrop-filter', '-webkit-text-size-adjust'] },
    ],
    'custom-media-pattern': '^(?:bp-[a-z0-9]+|below-[a-z]+|[a-z]+(?:-[a-z]+)*)$',
    'value-keyword-case': ['lower', { camelCaseSvgKeywords: true, ignoreKeywords: [/^[A-Z]/] }],
    'import-notation': 'string',
  },
};
