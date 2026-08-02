import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Agent-facing usage guide, served at /api/instructions and /llms.txt. */
export const INSTRUCTIONS_MARKDOWN = readFileSync(
  fileURLToPath(new URL('./instructions.md', import.meta.url)),
  'utf8',
);

/**
 * A compact machine-readable form of the same guide, for agents that would
 * rather branch on structured data than parse prose.
 */
export const INSTRUCTIONS_JSON = {
  name: 'objdiff-web API',
  purpose:
    'Reports how closely a compiled function matches the original, and which instructions differ.',
  concepts: {
    unit: 'One translation unit (.c file and its .o), named in objdiff.json.',
    target:
      'The original object being reproduced. Also called left or expected.',
    base: 'The object built from the current source. Also called right or current.',
    matchPercent:
      '0-100, how much of the target the base reproduces. Always measured from the target side.',
  },
  workflow: [
    'Edit the source.',
    'Rebuild: POST /api/build?unit=… if health reports buildEnabled, otherwise run the project build yourself.',
    'GET /api/match to check the percentage.',
    'If below 100, GET /api/diff.txt to see which rows differ.',
    'Repeat.',
  ],
  chooseEndpoint: {
    'Does function X match?': 'GET /api/match?unit=…&symbol=X',
    "Why doesn't it match?": 'GET /api/diff.txt?unit=…&symbol=X (cheapest)',
    'Reason about rows programmatically': 'GET /api/diff.json?unit=…&symbol=X',
    'Show a human': 'GET /api/diff.html?unit=…&symbol=X',
    'Unknown symbol name': 'GET /api/symbols?unit=…&q=partial',
    "What's left in this file?": 'GET /api/unit?unit=…',
    'What files exist?': 'GET /api/units',
  },
  endpoints: [
    {
      path: '/api/match',
      required: ['unit', 'symbol'],
      returns: 'json',
      description:
        'Match percentage and per-diff-kind instruction counts for one symbol.',
      example: '/api/match?unit=src/math.c&symbol=compute',
    },
    {
      path: '/api/diff.txt',
      required: ['unit', 'symbol'],
      returns: 'text/plain',
      description:
        'Two-column plain-text diff with a gutter: ! opcode, ~ argument, | replaced, + inserted, - deleted.',
      example: '/api/diff.txt?unit=src/math.c&symbol=compute',
    },
    {
      path: '/api/diff.json',
      required: ['unit', 'symbol'],
      returns: 'json',
      description: 'Per-row text and diffKind for both sides. Functions only.',
      example: '/api/diff.json?unit=src/math.c&symbol=compute',
    },
    {
      path: '/api/diff.html',
      required: ['unit', 'symbol'],
      optional: ['theme=auto|light|dark', 'embed=1'],
      returns: 'text/html',
      description:
        'Self-contained colored diff page for human viewing. Larger than diff.txt.',
      example: '/api/diff.html?unit=src/math.c&symbol=compute',
    },
    {
      path: '/api/symbols',
      optional: [
        'unit (omit or * for the whole project, which is slow)',
        'q',
        'mode=fuzzy|substring|regex',
        'caseSensitive',
        'section',
        'minPercent',
        'maxPercent (use 99.99 to find unfinished work)',
        'limit',
        'offset',
      ],
      returns: 'json',
      description: 'Search symbols by name and filter by match percentage.',
      example: '/api/symbols?unit=src/math.c&q=comp&maxPercent=99.99&limit=10',
    },
    {
      path: '/api/unit',
      required: ['unit'],
      returns: 'json',
      description:
        'Size-weighted overall percentage plus every section and symbol. Can be large.',
      example: '/api/unit?unit=src/math.c',
    },
    {
      path: '/api/units',
      returns: 'json',
      description: 'All units from objdiff.json.',
      example: '/api/units',
    },
    {
      path: '/api/build',
      method: 'POST',
      required: ['unit'],
      returns: 'json',
      description:
        "Runs the project's own build command from objdiff.json for this unit. Disabled unless the server was started with OBJDIFF_ALLOW_BUILD=1; check buildEnabled in /api/health. On failure returns 422 with the failing step's stderr.",
      example: 'POST /api/build?unit=src/math.c',
    },
    {
      path: '/api/health',
      returns: 'json',
      description:
        'Server status, objdiff version, project root and whether building is enabled.',
      example: '/api/health',
    },
  ],
  configOverrides:
    'Any objdiff config property may be passed as a query parameter, e.g. x86.formatter=gas, functionRelocDiffs=all, demangler=none. Defaults match the UI.',
  errorShape: {
    error: { code: 'SYMBOL_NOT_FOUND', message: 'string', hint: 'string?' },
  },
  errorCodes: {
    MISSING_PARAMETER: 'Add the named query parameter.',
    INVALID_PARAMETER: 'Fix the value; the message says what is accepted.',
    INVALID_MODE: 'Use fuzzy, substring or regex.',
    INVALID_REGEX: 'Use mode=substring or mode=fuzzy for literal text.',
    INVALID_CONFIG: 'Unknown value for an objdiff config property.',
    NOT_A_FUNCTION: 'Use /api/diff.txt or /api/diff.html for data symbols.',
    PATH_OUTSIDE_PROJECT: 'The path escaped the project root.',
    UNIT_NOT_FOUND: 'Call /api/units and use one of those names.',
    SYMBOL_NOT_FOUND: 'Call /api/symbols?q=… to find the real name.',
    NO_OBJECTS: 'Neither object is built — run the project build.',
    NO_PROJECT_CONFIG: 'OBJDIFF_PROJECT_ROOT has no objdiff.json.',
    PARSE_FAILED: 'Both object files are unreadable or corrupt.',
    BUILD_DISABLED:
      'Start the server with OBJDIFF_ALLOW_BUILD=1, or run the build yourself.',
    BUILD_FAILED: "Read the failing step's stderr for the compiler output.",
    BUILD_SPAWN_FAILED:
      'The build command in objdiff.json could not be started.',
    NOTHING_TO_BUILD: 'build_target and build_base are both disabled.',
  },
  cost: {
    cheap: ['/api/match', '/api/units', '/api/health'],
    moderate: ['/api/diff.txt', '/api/diff.json'],
    expensive: [
      '/api/diff.html',
      '/api/unit on large objects',
      '/api/symbols without unit',
    ],
  },
} as const;
