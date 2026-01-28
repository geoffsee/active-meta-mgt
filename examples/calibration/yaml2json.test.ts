import { describe, test, expect } from "vitest";
import { yamlToJson } from "./yaml2json";

const parse = (yaml: string) => JSON.parse(yamlToJson(yaml));

describe("yamlToJson", () => {
  test("simple key-value scalars", () => {
    expect(parse("name: alice\nage: 30")).toEqual({ name: "alice", age: 30 });
  });

  test("boolean and null scalars", () => {
    expect(parse("a: true\nb: false\nc: null")).toEqual({
      a: true,
      b: false,
      c: null,
    });
  });

  test("quoted strings are unquoted", () => {
    expect(parse(`a: "hello"\nb: '42'`)).toEqual({ a: "hello", b: "42" });
  });

  test("numeric strings stay numeric when unquoted", () => {
    expect(parse("x: 3.14\ny: 0")).toEqual({ x: 3.14, y: 0 });
  });

  test("nested objects", () => {
    const yaml = `
parent:
  child: 1
  child2: 2
`;
    expect(parse(yaml)).toEqual({ parent: { child: 1, child2: 2 } });
  });

  test("arrays", () => {
    const yaml = `
items:
  - a
  - b
  - c
`;
    expect(parse(yaml)).toEqual({ items: ["a", "b", "c"] });
  });

  test("comments are ignored", () => {
    const yaml = `
# this is a comment
key: value
  # indented comment
`;
    expect(parse(yaml)).toEqual({ key: "value" });
  });

  test("tabs are treated as spaces", () => {
    const yaml = "parent:\n\tchild: ok";
    expect(parse(yaml)).toEqual({ parent: { child: "ok" } });
  });

  test("value containing colon", () => {
    expect(parse("url: http://example.com")).toEqual({
      url: "http://example.com",
    });
  });

  test("empty input returns empty object", () => {
    expect(parse("")).toEqual({});
    expect(parse("# only comments")).toEqual({});
  });

  test("array item without array parent throws", () => {
    expect(() => parse("- orphan")).toThrow(
      "Invalid YAML: array item without array parent"
    );
  });

  test("returns valid JSON string", () => {
    const result = yamlToJson("a: 1");
    expect(result).toBe('{\n  "a": 1\n}');
  });

  test("array of objects", () => {
    const yaml = `
goals:
  - id: g1
    title: Ship feature
  - id: g2
    title: Fix bug
`;
    expect(parse(yaml)).toEqual({
      goals: [
        { id: "g1", title: "Ship feature" },
        { id: "g2", title: "Fix bug" },
      ],
    });
  });

  test("array of objects with nested arrays", () => {
    const yaml = `
evidence:
  - id: e1
    summary: Found issue
    tags:
      - lane
      - security
`;
    expect(parse(yaml)).toEqual({
      evidence: [
        { id: "e1", summary: "Found issue", tags: ["lane", "security"] },
      ],
    });
  });

  test("array of objects with nested objects", () => {
    const yaml = `
lanes:
  - id: task
    config:
      maxItems: 20
      enabled: true
`;
    expect(parse(yaml)).toEqual({
      lanes: [
        { id: "task", config: { maxItems: 20, enabled: true } },
      ],
    });
  });
});
