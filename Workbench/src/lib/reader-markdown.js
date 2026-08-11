import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

const readerSanitizeSchema = {
  ...defaultSchema,
  // React Markdown already namespaces generated footnote ids. A second prefix
  // breaks the generated href/id pair after rehype-raw reparses the document.
  clobberPrefix: "",
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes["*"] || []),
      "dataReaderBlock",
      "dataReaderCanonicalText",
    ],
    a: [
      ...(defaultSchema.attributes.a || []),
      ["className", /^wikilink(?:--(?:embed|unresolved))?$/],
      "dataVaultLink",
      "dataVaultTarget",
      "dataVaultHeading",
      "dataVaultId",
      "dataVaultEmbed",
    ],
  },
  strip: [
    ...new Set([
      ...(defaultSchema.strip || []),
      "style",
      "iframe",
      "object",
      "embed",
      "form",
    ]),
  ],
};

/**
 * Parse Obsidian-compatible inline HTML, then sanitize the complete HAST before
 * React receives it. This supports common reading tags such as sup/sub/span,
 * details and tables without granting Raw material executable HTML.
 */
export const readerRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, readerSanitizeSchema],
];
