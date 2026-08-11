import assert from "node:assert/strict";
import test from "node:test";

import { collectionItemMatchesGroup } from "../src/lib/collection-filter.js";

test("archive groups filter by directory section instead of frontmatter type or status", () => {
  const item = {
    section: "system_design",
    type: "technical-design",
    status: "active",
  };

  assert.equal(collectionItemMatchesGroup("archive", item, "system_design"), true);
  assert.equal(collectionItemMatchesGroup("archive", item, "technical-design"), false);
  assert.equal(collectionItemMatchesGroup("archive", item, "active"), false);
});

test("archive root group uses the same root fallback as server aggregation", () => {
  assert.equal(collectionItemMatchesGroup("archive", { section: null }, "root"), true);
  assert.equal(collectionItemMatchesGroup("archive", {}, "root"), true);
});

test("other collection kinds retain their existing group contracts", () => {
  assert.equal(collectionItemMatchesGroup("materials", { group: "articles" }, "articles"), true);
  assert.equal(collectionItemMatchesGroup("wiki", { type: "framework" }, "framework"), true);
  assert.equal(collectionItemMatchesGroup("content", { status: "selected" }, "selected"), true);
});
