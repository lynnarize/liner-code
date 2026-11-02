/*
  The parts of Windows support that read text and so run anywhere: what netstat says listens,
  a path relative() gives for somewhere outside a folder, and PATH under either spelling. Run
  with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { outside, pathOf, withPath } from "../src/exec.ts";
import { parseNetstat } from "../src/surfaces.ts";

test("ports on Windows: netstat's listening sockets, by their foreign address, named from tasklist", () => {
  const out = [
    "",
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012",
    "  TCP    127.0.0.1:5173         0.0.0.0:0              ABHÖREN         4242",
    "  TCP    127.0.0.1:50123        127.0.0.1:5173         ESTABLISHED     4243",
    "  TCP    [::1]:3000             [::]:0                 LISTENING       4300",
    "",
  ].join("\r\n");
  const l = parseNetstat(out, new Map([[4242, "node.exe"], [4300, "bun.exe"]]));
  assert.deepEqual(l.get(5173), { pid: 4242, process: "node" }, "in any language");
  assert.deepEqual(l.get(3000), { pid: 4300, process: "bun" });
  assert.deepEqual(l.get(135), { pid: 1012, process: "" });
  assert.equal(l.has(50123), false, "a connection isn't a listener");
});

test("outside: up out of the folder, or somewhere absolute", () => {
  assert.equal(outside(".."), true);
  assert.equal(outside("../x"), true);
  assert.equal(outside("/etc/passwd"), true);
  assert.equal(outside("a/b"), false);
  assert.equal(outside("..a"), false, "a name that starts with two dots is inside");
});

test("PATH: read and set under one spelling", () => {
  assert.equal(pathOf({ PATH: "/a:/b" }), "/a:/b");
  assert.equal(withPath({ PATH: "/a", HOME: "/h" }, "/c").PATH, "/c");
  assert.equal(withPath({ PATH: "/a", HOME: "/h" }, "/c").HOME, "/h");
});
