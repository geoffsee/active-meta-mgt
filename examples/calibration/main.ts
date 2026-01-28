#!/usr/bin/env bun

import { Calibrator } from "./calibrator";

// CLI entry point
if (import.meta.main) {
    const file = process.argv[2];
    if (!file) {
        console.error("Usage: calibrate <scenario.yaml>");
        process.exit(1);
    }

    const raw = await Bun.file(file).text();
    console.log(Calibrator.fromYaml(raw).run());
}
