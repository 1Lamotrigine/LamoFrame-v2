export default {
  trailingSlash: true,
  serverExternalPackages: ["@electric-sql/pglite", "nunjucks", "sharp"],
  outputFileTracingIncludes: { "/*": ["./templates/**/*", "./data/*.json"] },
};
