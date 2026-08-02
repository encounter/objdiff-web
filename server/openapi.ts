const unitParam = {
  name: 'unit',
  in: 'query',
  required: true,
  schema: { type: 'string' },
  description: 'Unit name from objdiff.json, e.g. "src/math.c".',
} as const;

const symbolParam = {
  name: 'symbol',
  in: 'query',
  required: true,
  schema: { type: 'string' },
  description: 'Symbol name, mangled or demangled.',
} as const;

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
} as const;

/** OpenAPI 3.1 description, served at /api/openapi.json for tool-calling agents. */
export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'objdiff API',
    version: '1.0.0',
    description:
      'Reports how closely a compiled function matches the original, and which instructions differ. See /api/instructions for agent-oriented usage notes.',
  },
  servers: [{ url: 'http://localhost:3001' }],
  paths: {
    '/api/match': {
      get: {
        operationId: 'getMatch',
        summary: 'Match percentage for one symbol',
        parameters: [unitParam, symbolParam],
        responses: {
          '200': {
            description: 'Match summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Match' },
              },
            },
          },
          '404': errorResponse,
        },
      },
    },
    '/api/diff.txt': {
      get: {
        operationId: 'getDiffText',
        summary: 'Two-column plain-text diff (cheapest for agents)',
        parameters: [unitParam, symbolParam],
        responses: {
          '200': {
            description: 'Plain-text diff',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          '404': errorResponse,
        },
      },
    },
    '/api/diff.json': {
      get: {
        operationId: 'getDiffJson',
        summary: 'Per-row diff data (functions only)',
        parameters: [unitParam, symbolParam],
        responses: {
          '200': {
            description: 'Row data',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DiffRows' },
              },
            },
          },
          '400': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/api/diff.html': {
      get: {
        operationId: 'getDiffHtml',
        summary: 'Self-contained colored diff page for human viewing',
        parameters: [
          unitParam,
          symbolParam,
          {
            name: 'theme',
            in: 'query',
            schema: { type: 'string', enum: ['auto', 'light', 'dark'] },
          },
          {
            name: 'embed',
            in: 'query',
            schema: { type: 'string', enum: ['0', '1'] },
            description: 'Return only the fragment and its <style>.',
          },
        ],
        responses: {
          '200': {
            description: 'HTML page',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
          '404': errorResponse,
        },
      },
    },
    '/api/symbols': {
      get: {
        operationId: 'searchSymbols',
        summary: 'Search symbols by name and match percentage',
        parameters: [
          {
            name: 'unit',
            in: 'query',
            schema: { type: 'string' },
            description: 'Omit or pass * to search every unit (slow).',
          },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          {
            name: 'mode',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['fuzzy', 'substring', 'regex'],
              default: 'fuzzy',
            },
          },
          {
            name: 'caseSensitive',
            in: 'query',
            schema: { type: 'boolean', default: false },
          },
          { name: 'section', in: 'query', schema: { type: 'string' } },
          { name: 'minPercent', in: 'query', schema: { type: 'number' } },
          {
            name: 'maxPercent',
            in: 'query',
            schema: { type: 'number' },
            description: 'Use 99.99 to list unfinished symbols.',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SymbolSearch' },
              },
            },
          },
          '400': errorResponse,
        },
      },
    },
    '/api/unit': {
      get: {
        operationId: 'getUnit',
        summary: 'Overall progress for one unit, with sections and symbols',
        parameters: [unitParam],
        responses: {
          '200': { description: 'Unit summary' },
          '404': errorResponse,
        },
      },
    },
    '/api/units': {
      get: {
        operationId: 'listUnits',
        summary: 'List units from objdiff.json',
        responses: { '200': { description: 'Unit list' } },
      },
    },
    '/api/build': {
      post: {
        operationId: 'buildUnit',
        summary:
          "Run the project's own build command for a unit (requires OBJDIFF_ALLOW_BUILD=1)",
        parameters: [unitParam],
        responses: {
          '200': { description: 'Build succeeded' },
          '403': errorResponse,
          '422': { description: 'Build failed; see steps[].stderr' },
        },
      },
    },
    '/api/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Server status',
        responses: { '200': { description: 'Status' } },
      },
    },
    '/api/instructions': {
      get: {
        operationId: 'getInstructions',
        summary: 'Agent-oriented usage guide',
        parameters: [
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['markdown', 'json'] },
          },
        ],
        responses: { '200': { description: 'Usage guide' } },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              hint: { type: 'string' },
            },
          },
        },
      },
      InstructionStats: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          matching: { type: 'integer' },
          opMismatch: { type: 'integer' },
          argMismatch: { type: 'integer' },
          replaced: { type: 'integer' },
          inserted: { type: 'integer' },
          deleted: { type: 'integer' },
        },
      },
      SymbolSide: {
        type: 'object',
        properties: {
          found: { type: 'boolean' },
          rowCount: { type: 'integer' },
          size: { type: ['integer', 'null'] },
          address: { type: ['string', 'null'] },
        },
      },
      Match: {
        type: 'object',
        properties: {
          unit: { type: 'string' },
          symbol: { type: 'string' },
          demangledName: { type: ['string', 'null'] },
          section: { type: ['string', 'null'] },
          kind: {
            type: 'string',
            enum: ['unknown', 'function', 'object', 'section'],
          },
          matchPercent: {
            type: ['number', 'null'],
            description:
              'null when the symbol has no counterpart on the target side.',
          },
          isMatch: { type: 'boolean' },
          target: { $ref: '#/components/schemas/SymbolSide' },
          base: { $ref: '#/components/schemas/SymbolSide' },
          instructions: {
            oneOf: [
              { $ref: '#/components/schemas/InstructionStats' },
              { type: 'null' },
            ],
          },
          warnings: { type: 'array', items: { type: 'string' } },
          links: { type: 'object' },
        },
      },
      DiffRows: {
        type: 'object',
        properties: {
          unit: { type: 'string' },
          symbol: { type: 'string' },
          matchPercent: { type: ['number', 'null'] },
          instructions: { $ref: '#/components/schemas/InstructionStats' },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                left: { $ref: '#/components/schemas/DiffSide' },
                right: { $ref: '#/components/schemas/DiffSide' },
              },
            },
          },
        },
      },
      DiffSide: {
        oneOf: [
          {
            type: 'object',
            properties: {
              text: { type: 'string' },
              diffKind: {
                type: 'string',
                enum: [
                  'none',
                  'op-mismatch',
                  'arg-mismatch',
                  'replace',
                  'insert',
                  'delete',
                ],
              },
            },
          },
          { type: 'null' },
        ],
      },
      SymbolSearch: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          mode: { type: 'string' },
          scope: { type: 'string' },
          total: { type: 'integer' },
          offset: { type: 'integer' },
          limit: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                unit: { type: 'string' },
                name: { type: 'string' },
                demangledName: { type: ['string', 'null'] },
                section: { type: 'string' },
                kind: { type: 'string' },
                address: { type: 'string' },
                size: { type: 'integer' },
                matchPercent: { type: ['number', 'null'] },
                score: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
} as const;
