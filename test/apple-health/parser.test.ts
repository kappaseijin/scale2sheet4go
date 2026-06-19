import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseAppleHealthLatestMeasurements,
  parseAppleHealthMeasurements,
} from "../../src/sources/apple-health/index.js";

const tempDirs: string[] = [];

describe("Apple Health parser", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  it("extracts all supported measurements with timestamps from export.xml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-apple-health-"));
    tempDirs.push(dir);
    const exportPath = join(dir, "export.xml");

    await writeFile(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.1" startDate="2026-06-18 07:00:00 +0900" endDate="2026-06-18 07:00:00 +0900" creationDate="2026-06-18 07:00:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.3" startDate="2026-06-18 07:05:00 +0900" endDate="2026-06-18 07:05:00 +0900" creationDate="2026-06-18 07:05:01 +0900"/>
</HealthData>
`,
      "utf8",
    );

    const readings = await parseAppleHealthMeasurements(exportPath);

    expect(readings).toHaveLength(2);
    expect(readings.map((reading) => reading.value)).toEqual([70.1, 70.3]);
    expect(readings.map((reading) => reading.measuredAt)).toEqual([
      "2026-06-17T22:00:00.000Z",
      "2026-06-17T22:05:00.000Z",
    ]);
  });

  it("extracts the latest supported measurements from export.xml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-apple-health-"));
    tempDirs.push(dir);
    const exportPath = join(dir, "export.xml");

    await writeFile(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.1" startDate="2026-06-18 07:00:00 +0900" endDate="2026-06-18 07:00:00 +0900" creationDate="2026-06-18 07:00:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.3" startDate="2026-06-18 07:05:00 +0900" endDate="2026-06-18 07:05:00 +0900" creationDate="2026-06-18 07:05:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyTemperature" sourceName="Thermometer" unit="degF" value="98.6" startDate="2026-06-18 07:01:00 +0900" endDate="2026-06-18 07:01:00 +0900" creationDate="2026-06-18 07:01:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBloodPressureSystolic" sourceName="Cuff" unit="mmHg" value="121" startDate="2026-06-18 07:02:00 +0900" endDate="2026-06-18 07:02:00 +0900" creationDate="2026-06-18 07:02:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBloodPressureDiastolic" sourceName="Cuff" unit="mmHg" value="78" startDate="2026-06-18 07:02:00 +0900" endDate="2026-06-18 07:02:00 +0900" creationDate="2026-06-18 07:02:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" value="64" startDate="2026-06-18 07:03:00 +0900" endDate="2026-06-18 07:03:00 +0900" creationDate="2026-06-18 07:03:01 +0900"/>
</HealthData>
`,
      "utf8",
    );

    const readings = await parseAppleHealthLatestMeasurements(exportPath);
    const byKind = Object.fromEntries(
      readings.map((reading) => [reading.kind, reading]),
    );

    expect(byKind.weight?.value).toBe(70.3);
    expect(byKind.body_temperature?.value).toBeCloseTo(37);
    expect(byKind.blood_pressure_systolic?.value).toBe(121);
    expect(byKind.blood_pressure_diastolic?.value).toBe(78);
    expect(byKind.pulse?.value).toBe(64);
    expect(byKind.weight?.source).toBe("apple_health_export");
  });
});
