"use strict";

var marko_template = module.exports = require("marko/src/html").t(__filename),
    marko_componentType = "/marko-test$1.0.0/compiler/fixtures-html/custom-tag-template/template.marko",
    marko_renderer = require("marko/src/runtime/components/renderer"),
    marko_loadTemplate = require("marko/src/runtime/helpers/load-template"),
    hello_template = marko_loadTemplate(require.resolve("./hello.marko")),
    marko_loadTag = require("marko/src/runtime/helpers/load-tag"),
    hello_tag = marko_loadTag(hello_template);

function render(input, out, __component, component, state) {
  var data = input;

  hello_tag({
      name: "Frank"
    }, out, __component, "0");
}

marko_template._ = marko_renderer(render, {
    ___implicit: true,
    ___type: marko_componentType
  });

marko_template.meta = {
    id: "/marko-test$1.0.0/compiler/fixtures-html/custom-tag-template/template.marko",
    tags: [
      "./hello.marko"
    ]
  };
