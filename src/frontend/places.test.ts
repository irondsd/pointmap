import { expect, test } from "bun:test";
import { category, decodeOrganicMaps, kmlColor, organicMapsUrl, otherNames, typeLabel, type Place } from "./places";
import { isZip, listEntries, readEntry } from "./zip";

const FIXTURES = new URL("../../test/fixtures/", import.meta.url);

test("reads the kml out of a .kmz", async () => {
  const bytes = await Bun.file(new URL("sample.kmz", FIXTURES)).bytes();
  expect(isZip(bytes)).toBe(true);
  const entries = listEntries(bytes);
  expect(entries.map((e) => e.name)).toEqual(["sample.kml"]);
  const xml = new TextDecoder().decode(await readEntry(bytes, entries[0]!));
  expect(xml).toBe(await Bun.file(new URL("sample.kml", FIXTURES)).text());
});

test("tells a .kml from a .kmz", async () => {
  expect(isZip(await Bun.file(new URL("sample.kml", FIXTURES)).bytes())).toBe(false);
});

test("labels feature types", () => {
  expect(typeLabel("tourism-viewpoint")).toBe("Viewpoint");
  expect(typeLabel("railway-station")).toBe("Railway station");
  expect(typeLabel("amenity-place_of_worship-christian")).toBe("Place of worship · Christian");
  expect(typeLabel("place-city-capital-4")).toBe("Capital city");
  expect(typeLabel("highway-residential")).toBe("Road");
  expect(typeLabel("building")).toBe("Building");
});

test("hides routing tags and pulls out accessibility", () => {
  expect(category(["building", "tourism-attraction", "wheelchair-yes", "psurface-paved_good"], "Sights")).toEqual({
    label: "Building",
    extras: ["Attraction"],
    access: "Wheelchair accessible",
  });
  expect(category([], "Viewpoint").label).toBe("Viewpoint");
  expect(category(["building-address"], null).label).toBe("Address");
  expect(category([], "None").label).toBe(null);
});

test("converts KML aabbggrr colors", () => {
  expect(kmlColor("ff0000ff")).toBe("#ff0000");
  expect(kmlColor("FF33CC00")).toBe("#00cc33");
  expect(kmlColor("nope")).toBe(null);
});

test("lists other names, reader's language first, without repeats", () => {
  const place = {
    name: "Eiffel Tower",
    names: { default: "Tour Eiffel", en: "Eiffel Tower", ja: "エッフェル塔", int_name: "Tour Eiffel" },
  } as unknown as Place;
  expect(otherNames(place, ["ja-JP"])).toEqual(["エッフェル塔", "Tour Eiffel"]);
  expect(otherNames(place, ["fr"])).toEqual(["Tour Eiffel"]);
});

test("Organic Maps links round-trip through the ge0 encoding", () => {
  // The example from Organic Maps' own API docs.
  const zoo = decodeOrganicMaps("o4B4pYZsRs");
  expect(zoo.lat).toBeCloseTo(47.3859, 3);
  expect(zoo.lon).toBeCloseTo(8.5767, 3);
  expect(zoo.zoom).toBe(14);
  expect(organicMapsUrl(zoo.lat, zoo.lon, 14, "Zoo Zürich")).toBe("https://omaps.app/o4B4pYZsRs/Zoo_Z%C3%BCrich");
  const back = decodeOrganicMaps(organicMapsUrl(-33.8568, 151.2153, 16, "").split("/").pop()!);
  expect(back.lat).toBeCloseTo(-33.8568, 4);
  expect(back.lon).toBeCloseTo(151.2153, 4);
});
