// Sample Kyclius third-party plugin.
//
// A plugin is plain CommonJS exporting a function that receives the sandboxed
// SDK. Registering a tool requires a name, description, JSON-schema parameters,
// an explicit permissionTier ('auto' | 'confirm_required'), and a handler that
// resolves to { success: true, result } or { success: false, error }.
//
// No core changes are required to install this plugin — it is just a folder
// that is picked in Settings → Integrations → Plugins.

module.exports = function (sdk) {
  sdk.registerTool({
    name: 'reverse_text',
    description: 'Reverses a piece of text.',
    permissionTier: 'auto',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to reverse.' },
      },
      required: ['text'],
    },
    async handler(params) {
      return {
        success: true,
        result: String(params.text || '').split('').reverse().join(''),
      };
    },
  });

  sdk.registerTool({
    name: 'character_count',
    description: 'Counts characters (and non-space characters) in a piece of text.',
    permissionTier: 'confirm_required',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to measure.' },
      },
      required: ['text'],
    },
    async handler(params) {
      const text = String(params.text || '');
      const all = text.length;
      const meaningful = text.replace(/\s+/g, '').length;
      return {
        success: true,
        result: JSON.stringify({ characters: all, nonWhitespace: meaningful }),
      };
    },
  });
};