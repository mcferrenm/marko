import path from "path";
import { createHash } from "crypto";
import { types as t } from "@marko/babel-types";
import { getLoc, ___setTaglibLookup } from "@marko/babel-utils";
import { buildLookup } from "../taglib";
import { parseMarko } from "./parser";
import { visitor as migrate } from "./plugins/migrate";
import { visitor as transform } from "./plugins/transform";
import traverse, { visitors } from "@babel/traverse";
import { getRootDir } from "lasso-package-root";
import markoModules from "../../modules";
import { MarkoFile } from "./file";

let translatorIndex = 0;
const TRANSLATOR_IDS = new WeakMap();
let ROOT = process.cwd();
try {
  ROOT = getRootDir(ROOT);
  // eslint-disable-next-line no-empty
} catch {}

export default (api, markoOpts) => {
  api.assertVersion(7);
  const cache = markoOpts.cache;
  const fs = markoOpts.fileSystem;
  const translator = markoOpts.translator;
  const canCache = !(markoOpts._parseOnly || markoOpts._migrateOnly);
  const translatorId =
    TRANSLATOR_IDS.get(translator) ||
    (TRANSLATOR_IDS.set(translator, ++translatorIndex + ""),
    translatorIndex + "");

  const optimize =
    markoOpts.optimize === undefined
      ? (markoOpts.optimize = api.env("production"))
      : markoOpts.optimize;
  markoOpts.output = markoOpts.output || "html";

  if (!translator || !translator.visitor) {
    throw new Error(
      "@marko/compiler: translator must provide a visitor object"
    );
  }

  return {
    name: "marko",
    parserOverride(code, jsParseOptions) {
      const filename = jsParseOptions.sourceFileName;
      const componentId = path.relative(ROOT, filename);
      const contentHash =
        canCache &&
        createHash("MD5")
          .update(code)
          .digest("hex");
      const cacheKey =
        canCache &&
        createHash("MD5")
          .update(componentId)
          .update("\0")
          .update(translatorId)
          .digest("hex");

      let cached = canCache && cache.get(cacheKey);
      let ast;
      let meta;

      if (cached) {
        if (cached.contentHash !== contentHash) {
          // File content changed, invalidate the cache.
          cached = undefined;
        } else {
          for (const watchFile of cached.meta.watchFiles) {
            let mtime = Infinity;
            // eslint-disable-next-line no-empty
            try {
              mtime = fs.statSync(watchFile).mtime;
            } catch {}

            if (mtime > cached.meta.time) {
              // Some dependency changed, invalidate the cache.
              cached = undefined;
              break;
            }
          }
        }

        if (cached) {
          ast = cached.ast;
          meta = cached.meta;
        }
      }

      const isNew = !cached;
      if (isNew) {
        ast = {
          type: "File",
          program: {
            type: "Program",
            sourceType: "module",
            body: [],
            directives: []
          }
        };

        meta = {
          id: optimize
            ? createHash("MD5")
                .update(componentId)
                .digest("base64")
                .slice(0, 8)
            : componentId,
          macros: {},
          deps: [],
          tags: [],
          watchFiles: new Set()
        };
      }

      const file = new MarkoFile(jsParseOptions, { code, ast });

      if (isNew) {
        file.ast.start = file.ast.program.start = 0;
        file.ast.end = file.ast.program.end = code.length - 1;
        file.ast.loc = file.ast.program.loc = {
          start: { line: 0, column: 0 },
          end: getLoc(file, file.ast.end)
        };
      }

      file.metadata.marko = meta;
      file.markoOpts = markoOpts;

      const taglibLookup = buildLookup(
        path.dirname(filename),
        markoOpts.translator
      );
      ___setTaglibLookup(file, taglibLookup);

      if (isNew) {
        parseMarko(file);
      }

      if (!markoOpts._parseOnly) {
        file.path.scope.crawl(); // Initialize bindings.

        if (isNew) {
          const rootMigrators = Object.values(taglibLookup.taglibsById)
            .map(({ migratorPath }) => {
              if (migratorPath) {
                const mod = markoModules.require(migratorPath);
                meta.watchFiles.add(migratorPath);
                return (mod.default || mod)(api, markoOpts);
              }
            })
            .filter(Boolean);
          traverse(
            file.ast,
            rootMigrators.length
              ? visitors.merge(rootMigrators.concat(migrate))
              : migrate,
            file.scope
          );
          if (!markoOpts._migrateOnly) {
            const rootTransformers = taglibLookup.merged.transformers.map(
              ({ path: transformerPath }) => {
                const mod = markoModules.require(transformerPath);
                meta.watchFiles.add(transformerPath);
                return (mod.default || mod)(api, markoOpts);
              }
            );
            traverse(
              file.ast,
              rootTransformers.length
                ? visitors.merge(rootTransformers.concat(transform))
                : transform,
              file.scope
            );
          }

          cache.set(cacheKey, {
            ast: t.cloneDeep(file.ast),
            meta: cloneMeta(meta),
            contentHash,
            time: Date.now()
          });
        }

        if (!markoOpts._migrateOnly) {
          traverse(file.ast, translator.visitor, file.scope);
        }
      }

      const result = t.cloneDeep(file.ast);

      for (const taglibId in taglibLookup.taglibsById) {
        const { filePath } = taglibLookup.taglibsById[taglibId];

        if (
          filePath[filePath.length - 5] === "." &&
          filePath.endsWith("marko.json")
        ) {
          meta.watchFiles.add(filePath);
        }
      }

      file.metadata.marko.watchFiles = Array.from(
        file.metadata.marko.watchFiles
      );

      result._markoMeta = file.metadata.marko;

      return result;
    },
    pre(file) {
      // Copy over the Marko specific metadata.
      file.metadata.marko = file.ast._markoMeta;
      delete file.ast._markoMeta;
    }
  };
};

function cloneMeta(meta) {
  return {
    id: meta.id,
    macros: { ...meta.macros },
    deps: meta.deps.slice(),
    tags: meta.tags.slice(),
    watchFiles: new Set(meta.watchFiles)
  };
}
