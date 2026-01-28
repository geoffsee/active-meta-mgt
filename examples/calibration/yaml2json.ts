/** Internal stack frame tracking indentation depth and the current container being populated. */
interface StackEntry {
    indent: number;
    value: Record<string, unknown> | unknown[];
}

/**
 * Converts a simple YAML string to a pretty-printed JSON string.
 *
 * Supports scalar values (strings, numbers, booleans, null), nested objects,
 * and arrays denoted by `- ` prefixes. Comments and blank lines are stripped.
 *
 * @param yaml - Raw YAML text to parse.
 * @returns A JSON string with 2-space indentation.
 * @throws {Error} If an array item appears outside an array context.
 */
export function yamlToJson(yaml: string): string {
    const lines = yaml
        .replace(/\t/g, "  ")
        .split("\n")
        .filter((l: string) => l.trim() && !l.trim().startsWith("#"));

    const root: Record<string, unknown> = {};
    const stack: StackEntry[] = [{ indent: -1, value: root }];

    const parseScalar = (val: string): unknown => {
        if (val === "null") return null;
        if (val === "true") return true;
        if (val === "false") return false;
        if (!isNaN(Number(val))) return Number(val);
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            return val.slice(1, -1);
        }
        return val;
    };

    for (const line of lines) {
        const indent = line.match(/^ */)![0].length;
        const trimmed = line.trim();

        while (stack[stack.length - 1]!.indent >= indent) {
            stack.pop();
        }

        const parent = stack[stack.length - 1]!.value;

        if (trimmed.startsWith("- ")) {
            const val = parseScalar(trimmed.slice(2));
            if (!Array.isArray(parent)) {
                throw new Error("Invalid YAML: array item without array parent");
            }
            parent.push(val);
            continue;
        }

        const [key, ...rest] = trimmed.split(":") as [string, ...string[]];
        const rawValue = rest.join(":").trim();

        if (rawValue === "") {
            // nested object or array
            const nextIsArray = lines.some((l: string) =>
                l.startsWith(" ".repeat(indent + 2) + "- ")
            );

            const child: Record<string, unknown> | unknown[] = nextIsArray ? [] : {};
            (parent as Record<string, unknown>)[key] = child;
            stack.push({ indent, value: child });
        } else {
            (parent as Record<string, unknown>)[key] = parseScalar(rawValue);
        }
    }

    return JSON.stringify(root, null, 2);
}
